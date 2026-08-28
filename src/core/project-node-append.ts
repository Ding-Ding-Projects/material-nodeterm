// Pure append of a PHONE-REGISTERED terminal node into a project.json's raw text — the host side
// of the relay `projects.registerNode` verb (the phone's twin of this logic lives in
// nodeterm-ios ProjectNodeRegistrar and writes over direct SSH; both converge on one node shape).
//
// Works on the RAW parsed object, not the typed mirrors, so every field this version does not
// know (bridges, dino scores, future schema) round-trips untouched — the file is rewritten whole.
// Returns null whenever nothing must be written: unparsable/wrong-shape text (a file we couldn't
// parse must never be invented or overwritten), a duplicate id (a retry must not churn rev), or
// an unsafe id (it becomes a tmux session name).

import { agentConfig } from '../shared/agents/config'
import { boundAccountId } from '../shared/agents/account-binding'
import { isSafeAccountId } from './claude-accounts-core'

/** What the phone is allowed to choose; everything else is host-derived. */
export interface RemoteNodeInput {
  id: string
  title?: string
  agentId?: string
  accountId?: string
  /** Host-resolved default color for the account, never a phone-selected presentation value. */
  accountColor?: string
}

/** The desktop id shape (`term-<base36 ms>-<token>`). Anything else is refused — the id is
 *  interpolated into tmux session names, so the alphabet stays strictly boring.
 *
 *  The tail was `\d{1,6}` while the desktop minted a monotonic counter. That counter restarted at
 *  zero on every renderer start (and every HMR reload), so it was a collision generator and is now
 *  a random hex token — and this guard, which is what the PHONE's ids are checked against, would
 *  have refused every id the phone mints once nodeterm-ios adopts the same shape. Widened to the
 *  same boring alphabet; an empty tail (`term-abc-`) is still refused. */
const SAFE_NODE_ID = /^term-[a-z0-9]+-[a-z0-9]{1,16}$/

const TITLE_MAX = 120

/**
 * This writer deliberately preserves fields it does not understand, but execution authority is
 * the exception: project.json is shared and may have been hand-edited since the desktop last
 * wrote it. Scrub every known machine-local execution field whenever this raw rewrite lands.
 */
function stripRawNodeExec(node: Record<string, unknown>): Record<string, unknown> {
  const {
    shell: _shell,
    terminalProfileId: _terminalProfileId,
    namedTerminalProfileId: _namedTerminalProfileId,
    pendingLaunch: _pendingLaunch,
    ...portable
  } = node
  if (_namedTerminalProfileId !== undefined) delete portable.cwd
  const ssh = portable.ssh
  if (!ssh || typeof ssh !== 'object' || Array.isArray(ssh)) return portable
  const {
    extraArgs: _extraArgs,
    execTrusted: _execTrusted,
    ...connection
  } = ssh as Record<string, unknown>
  return { ...portable, ssh: connection }
}

export function appendProjectNode(raw: string, input: RemoteNodeInput, now: Date): string | null {
  if (!SAFE_NODE_ID.test(input.id)) return null
  if (
    input.accountId !== undefined &&
    (typeof input.accountId !== 'string' || !isSafeAccountId(input.accountId))
  ) return null
  let root: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    root = parsed as Record<string, unknown>
  } catch {
    return null
  }
  if (root.version !== 1 || typeof root.rev !== 'number' || !Array.isArray(root.nodes)) return null
  const nodes = (root.nodes as Array<Record<string, unknown>>).map(stripRawNodeExec)
  if (nodes.some((n) => n?.id === input.id)) return null

  const isTerminal = (n: Record<string, unknown>): boolean =>
    ((n.kind as string | undefined) ?? 'terminal') === 'terminal'
  const sibling = nodes.find(isTerminal)

  // Place the new node just below the lowest existing node (canvas y grows downward), aligned to
  // its x; an empty canvas starts at 100/100.
  let x = 100
  let y = 100
  let lowest: { node: Record<string, unknown>; y: number } | null = null
  for (const n of nodes) {
    const ny = (n.position as { y?: unknown } | undefined)?.y
    if (typeof ny !== 'number') continue
    if (!lowest || ny > lowest.y) lowest = { node: n, y: ny }
  }
  if (lowest) {
    const lx = (lowest.node.position as { x?: unknown }).x
    x = typeof lx === 'number' ? lx : 100
    const lh = (lowest.node.size as { height?: unknown } | undefined)?.height
    y = lowest.y + (typeof lh === 'number' ? lh : 560) + 40
  }

  // An agent node looks exactly like one minted by the canvas (createAgentNode): the agent's
  // label as the starting title and the agent's color — titleAuto then lets the agent's own
  // session name take over, same as desktop. A plain terminal keeps the mobile defaults.
  const agentId = typeof input.agentId === 'string' ? input.agentId : undefined
  const bound = boundAccountId(input.accountId, agentId)
  const agent = agentId !== undefined ? agentConfig(agentId) : undefined
  const accountColor =
    bound && typeof input.accountColor === 'string' ? input.accountColor.trim() || undefined : undefined
  const node: Record<string, unknown> = {
    id: input.id,
    kind: 'terminal',
    position: { x, y },
    size: { width: 900, height: 560 },
    title:
      typeof input.title === 'string'
        ? input.title.slice(0, TITLE_MAX)
        : (agent?.label ?? 'Mobile session'),
    titleAuto: true,
    color: accountColor ?? agent?.color ?? '#7aa2f7',
    group: null,
    tags: [],
    collapsed: false,
    // Sibling nodes carry the project's portable cwd (usually "./…").
    cwd: typeof sibling?.cwd === 'string' ? sibling.cwd : '.'
  }
  if (agentId !== undefined) node.agentId = agentId
  if (bound) node.accountId = bound
  // Desktop remote nodes carry the connection spec PER NODE — a sibling terminal in the same
  // project has the right portable connection values. Machine-local execution fields were
  // stripped above and therefore cannot be copied onto the new node.
  const sshDonor = nodes.find((n) => {
    if (!isTerminal(n) || n.sshRemoteTmux !== true) return false
    const value = n.ssh
    return !!value && typeof value === 'object' && !Array.isArray(value) &&
      typeof (value as { host?: unknown }).host === 'string' &&
      (value as { host: string }).host !== '' &&
      typeof (value as { user?: unknown }).user === 'string' &&
      (value as { user: string }).user !== ''
  })
  if (sshDonor) {
    node.ssh = sshDonor.ssh
    node.sshRemoteTmux = true
  }

  root.nodes = [...nodes, node]
  root.rev = (root.rev as number) + 1
  root.savedAt = now.toISOString()
  return JSON.stringify(root, null, 2)
}

/** Remove one node without rewriting fields owned by other project features. */
export function removeProjectNode(raw: string, nodeId: string, now: Date): string | null {
  if (typeof nodeId !== 'string' || !nodeId) return null
  let root: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    root = parsed as Record<string, unknown>
  } catch {
    return null
  }
  if (root.version !== 1 || typeof root.rev !== 'number' || !Array.isArray(root.nodes)) return null
  const nodes = root.nodes as Array<Record<string, unknown>>
  if (!nodes.some((node) => node?.id === nodeId)) return null
  root.nodes = nodes.filter((node) => node?.id !== nodeId)
  root.rev = (root.rev as number) + 1
  root.savedAt = now.toISOString()
  return JSON.stringify(root, null, 2)
}
