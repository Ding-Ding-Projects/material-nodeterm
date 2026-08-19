import type { TrustedNodeLaunchLookup } from '../core/workspace-store'
import { BUILTIN_AGENT_IDS } from '../shared/agents/config'
import type { LocalNodeExec } from '../shared/node-exec'
import type { CanvasNodeState, Project, PtyCreateOptions } from '../shared/types'

/** Facts held by one mutually-approved relay session, never supplied by its RPC payload. */
export interface RelayPtyCreateSource {
  sharedProjectId?: string
  introducedNode?: { projectId: string; node: CanvasNodeState }
  /** Once this session removes an id, it cannot recycle that identity into a fresh launch. */
  retiredPersistKey?: boolean
  /** Task-owned Docker container selected by the mutually approved host session. */
  docker?: { context: string; containerName: string }
}

export type RelayPtyCreateDecision =
  | { ok: true; options: PtyCreateOptions }
  | { ok: false; message: string }

export interface TrustedProjectLaunchContext {
  projectId: string
  cwd?: string
  ssh?: Project['ssh']
}

export interface RelayPtyCreateAuthority {
  node(persistKey: string): TrustedNodeLaunchLookup
  project(projectId: string): TrustedProjectLaunchContext | null
  defaultTerminalProfileId(): string
  /** Resolve a project binding through the host's live ControlMaster, or null when unavailable. */
  sshRemote(
    projectId: string,
    ssh: NonNullable<Project['ssh']>,
    remoteCwd: string
  ): NonNullable<PtyCreateOptions['sshRemote']> | null
}

const deny = (message: string): RelayPtyCreateDecision => ({ ok: false, message })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const safeOpaque = (value: unknown, max = 512): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0')

const BUILTIN_AGENTS = new Set<string>(BUILTIN_AGENT_IDS)
const SAFE_CUSTOM_AGENT = /^custom:[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/
const SAFE_ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/

/**
 * Keep only view geometry/identity from a relay request. Everything that can select a program,
 * argv, profile, cwd, account environment, launch intent, or SSH transport is reconstructed below
 * from host state. An allowlist is intentional: a future executable field must default to stripped.
 */
function viewOptions(raw: unknown): PtyCreateOptions | null {
  if (!isRecord(raw)) return null
  const { cols, rows, persistKey, viewerId } = raw
  if (
    typeof cols !== 'number' ||
    !Number.isInteger(cols) ||
    cols < 1 ||
    cols > 10_000 ||
    typeof rows !== 'number' ||
    !Number.isInteger(rows) ||
    rows < 1 ||
    rows > 10_000 ||
    !safeOpaque(persistKey)
  ) {
    return null
  }
  if (viewerId !== undefined && !safeOpaque(viewerId)) return null
  return {
    cols,
    rows,
    persistKey,
    ...(viewerId !== undefined ? { viewerId } : {})
  }
}

function addNodeMetadata(options: PtyCreateOptions, node: CanvasNodeState): void {
  // Both values affect host process state, so they come from the authoritative host node rather
  // than the peer's create payload. Keep malformed hand-edited values out of the spawn entirely.
  if (
    typeof node.agentId === 'string' &&
    (BUILTIN_AGENTS.has(node.agentId) || SAFE_CUSTOM_AGENT.test(node.agentId))
  ) {
    options.agentId = node.agentId
  }
  if (typeof node.accountId === 'string' && SAFE_ACCOUNT.test(node.accountId)) {
    options.accountId = node.accountId
  }
}

function addLocalExecution(
  options: PtyCreateOptions,
  localExec: LocalNodeExec | undefined,
  defaultTerminalProfileId: string
): void {
  if (localExec?.shell !== undefined) {
    // A legacy machine-local per-node program predates profiles. Preserve it exactly; setting a
    // profile too would replace it in PtyManager and silently change the node's behavior.
    options.shell = localExec.shell
  } else if (localExec?.terminalProfileId !== undefined) {
    options.profileId = localExec.terminalProfileId
  } else {
    options.profileId = defaultTerminalProfileId
  }
}

function addRemoteExecution(
  authority: RelayPtyCreateAuthority,
  options: PtyCreateOptions,
  projectId: string,
  ssh: NonNullable<Project['ssh']>,
  nodeCwd: string | undefined
): RelayPtyCreateDecision {
  const remoteCwd = nodeCwd || ssh.remoteCwd || '~'
  const remote = authority.sshRemote(projectId, ssh, remoteCwd)
  if (!remote) {
    // Do not hand requireRemote-without-sshRemote to the generic handler here. This path is a
    // security classification failure (there is no trusted host binding), so the handler must not
    // run at all; a peer-supplied fallback could otherwise become a local shell under a remote id.
    return deny('the terminal belongs to an SSH project whose trusted host binding is unavailable')
  }
  options.sshRemote = remote
  options.requireRemote = true
  return { ok: true, options }
}

/**
 * Rebuild a relay `pty:create` from host authority. Request execution fields are never merged.
 * Existing nodes bind to their machine-local snapshot; a session-introduced, proven-new local
 * node receives the host's current default. Unknown, ambiguous, reused, or unbound SSH identities
 * fail closed before PtyManager (and therefore before node-pty/session-host) is reached.
 */
export function authorizeRelayPtyCreate(
  authority: RelayPtyCreateAuthority,
  raw: unknown,
  source: RelayPtyCreateSource
): RelayPtyCreateDecision {
  const options = viewOptions(raw)
  if (!options?.persistKey) return deny('relay terminal creation requires valid persistent node options')
  const docker = source.docker
  if (source.retiredPersistKey) return deny('this relay session already removed that terminal identity')

  const lookup = authority.node(options.persistKey)
  if (lookup.status === 'unavailable') {
    return deny(`the host could not establish authoritative terminal state (${lookup.reason})`)
  }

  if (lookup.status === 'found') {
    if (source.sharedProjectId !== undefined && lookup.projectId !== source.sharedProjectId) {
      return deny('the terminal is outside this relay session project')
    }
    if (
      source.introducedNode &&
      (source.introducedNode.projectId !== lookup.projectId ||
        source.introducedNode.node.id !== options.persistKey)
    ) {
      return deny('the terminal identity was introduced for a different project')
    }
    if (lookup.node.kind !== 'terminal') return deny('the persistent id does not name a terminal')

    options.cwd = lookup.node.cwd || lookup.projectCwd
    if (options.cwd === undefined) delete options.cwd
    addNodeMetadata(options, lookup.node)

    if (lookup.projectSsh) {
      return addRemoteExecution(
        authority,
        options,
        lookup.projectId,
        lookup.projectSsh,
        lookup.node.cwd
      )
    }
    // A plain SSH terminal would require synthesising local ssh argv from shared connection data.
    // Only project-level bindings have a host-owned live authority in this relay path.
    if (lookup.node.ssh || lookup.node.sshRemoteTmux) {
      return deny('the terminal has no trusted project SSH binding')
    }

    if (docker) {
      options.shell = 'docker'
      options.shellArgs = [
        ...(docker.context ? ['--context', docker.context] : []),
        'exec', '-i', docker.containerName, '/bin/sh'
      ]
      delete options.cwd
      delete options.profileId
    } else {
      addLocalExecution(options, lookup.localExec, authority.defaultTerminalProfileId())
    }
    return { ok: true, options }
  }

  const introduced = source.introducedNode
  if (!introduced || introduced.node.id !== options.persistKey) {
    return deny('the terminal is not present in authoritative host state')
  }
  if (
    source.sharedProjectId !== undefined &&
    introduced.projectId !== source.sharedProjectId
  ) {
    return deny('the introduced terminal is outside this relay session project')
  }
  if (introduced.node.kind !== 'terminal') return deny('the introduced id does not name a terminal')

  const project = authority.project(introduced.projectId)
  if (!project) return deny('the introduced terminal project is not authoritative on this host')
  options.cwd = project.cwd
  if (options.cwd === undefined) delete options.cwd
  addNodeMetadata(options, introduced.node)

  if (project.ssh) {
    return addRemoteExecution(
      authority,
      options,
      project.projectId,
      project.ssh,
      project.cwd
    )
  }
  if (introduced.node.ssh || introduced.node.sshRemoteTmux) {
    return deny('a newly introduced SSH terminal has no trusted project binding')
  }

  if (docker) {
    options.shell = 'docker'
    options.shellArgs = [
      ...(docker.context ? ['--context', docker.context] : []),
      'exec', '-i', docker.containerName, '/bin/sh'
    ]
    delete options.cwd
  } else {
    options.profileId = authority.defaultTerminalProfileId()
  }
  return { ok: true, options }
}
