import { requiresDestructiveGate } from '@shared/kids-mode-policy'

/**
 * Every user-reachable way to end a node/session.
 *
 * Keeping this as a closed list is deliberate: a new surface has to choose its ordinary-mode
 * behaviour here, while Kids mode gets the same two-key gate without another call-site branch.
 */
export const NODE_DELETE_SURFACES = [
  'canvas',
  'kanban',
  'window-shortcut',
  'sessions-sidebar',
  'agent-control'
] as const

export type NodeDeleteSurface = (typeof NODE_DELETE_SURFACES)[number]

export type NodeDeletionConfirmation = 'destructive-gate' | 'plain-confirm' | 'immediate'

export interface NodeDeletionPlan {
  confirmation: NodeDeletionConfirmation
  title: string
  description: string
  message: string
  affected?: string[]
}

export interface PlanNodeDeletionInput {
  surface: NodeDeleteSurface
  kidsModeOn: boolean
  titles: string[]
  requestedBy?: string
  /** False only for a session-memory orphan: there is no canvas node to remove. */
  removesNode?: boolean
}

/** Ordinary-mode behaviour that predates Kids mode. Kids mode overrides every row to the gate. */
const ORDINARY_CONFIRMATION: Record<NodeDeleteSurface, NodeDeletionConfirmation> = {
  canvas: 'destructive-gate',
  kanban: 'plain-confirm',
  'window-shortcut': 'immediate',
  'sessions-sidebar': 'plain-confirm',
  'agent-control': 'plain-confirm'
}

/**
 * The single policy decision for every node/session close surface.
 *
 * The action is always `delete-node`: ending a session also removes its canvas node, whether the
 * request came from the canvas, board, sidebar, desktop menu accelerator, or an agent. Keeping the
 * surface only decides the historical Kids-mode-OFF behaviour; it never weakens Kids mode.
 */
export function planNodeDeletion({
  surface,
  kidsModeOn,
  titles,
  requestedBy,
  removesNode = true
}: PlanNodeDeletionInput): NodeDeletionPlan {
  const named = titles.length ? titles.map((title) => title.trim() || 'node') : ['node']
  const count = named.length
  const one = named[0]
  const confirmation = requiresDestructiveGate('delete-node', kidsModeOn).required
    ? 'destructive-gate'
    : ORDINARY_CONFIRMATION[surface]
  const requester = requestedBy ? `Agent “${requestedBy}” requested this. ` : ''
  const consequence = removesNode
    ? count > 1
      ? 'The selected nodes are removed. Any terminal sessions they own end immediately, including anything still running inside them. This cannot be undone.'
      : 'The canvas node is removed. If it owns a terminal session, that session ends immediately, including anything still running inside it. This cannot be undone.'
    : 'The terminal session ends immediately, including anything still running inside it. This cannot be undone.'
  const question = removesNode
    ? count > 1
      ? `Delete ${count} nodes? Any terminal sessions they own will end.`
      : `Delete ${one}? Its canvas node will be removed and any terminal session it owns will end.`
    : `End ${one}? Its terminal session will end.`

  return {
    confirmation,
    title: removesNode
      ? count > 1
        ? `Delete ${count} nodes`
        : `Delete “${one}”`
      : `End “${one}”`,
    description: requester + consequence,
    message: requester + question,
    affected: named
  }
}

export interface NodeDeletionDispatchDeps {
  perform(): void
  cancel?(): void
  openGate(request: {
    title: string
    description: string
    affected?: string[]
    onConfirm: () => void
    onCancel?: () => void
  }): boolean
  openConfirm(request: {
    message: string
    onConfirm: () => void
    onCancel?: () => void
  }): boolean
}

/**
 * Execute a deletion plan without letting a caller hand-roll its confirmation branch.
 *
 * `perform` is never called before the chosen confirmation authorizes it. The boolean reports
 * whether the request was accepted; a refused second dialog therefore cannot be reported as a
 * deletion by an agent-control caller.
 */
export function dispatchNodeDeletion(
  plan: NodeDeletionPlan,
  deps: NodeDeletionDispatchDeps
): boolean {
  if (plan.confirmation === 'immediate') {
    deps.perform()
    return true
  }

  if (plan.confirmation === 'destructive-gate') {
    return deps.openGate({
      title: plan.title,
      description: plan.description,
      affected: plan.affected,
      onConfirm: deps.perform,
      onCancel: deps.cancel
    })
  }

  return deps.openConfirm({
    message: plan.message,
    onConfirm: deps.perform,
    onCancel: deps.cancel
  })
}

/**
 * Convert React Flow's expanded deletion set back to the managed roots the user asked to remove.
 *
 * React Flow includes every descendant when a parent is passed to `deleteElements`. nodeterm's
 * canonical group deletion instead frees those descendants onto the parent canvas, so forwarding
 * the expanded set would silently turn "delete frame" into "delete everything in frame".
 */
export function managedDeletionRoots(
  pending: ReadonlyArray<{ id: string; parentId?: string }>,
  liveIds: ReadonlySet<string>
): string[] {
  const managed = pending.filter((node) => liveIds.has(node.id))
  const pendingIds = new Set(managed.map((node) => node.id))
  return managed
    .filter((node) => !node.parentId || !pendingIds.has(node.parentId))
    .map((node) => node.id)
}

/**
 * Seed the removal checkbox when a worktree dialog opens.
 *
 * Outside Kids mode an app-created directory retains the historical delete default. Under Kids
 * mode deletion is always an explicit opt-in, including when the app created the directory.
 */
export function initialWorktreeDeleteFromDisk(
  createdByApp: boolean,
  kidsModeOn: boolean
): boolean {
  return createdByApp && !kidsModeOn
}

/**
 * Reconcile an already-open removal dialog with a live Kids-mode change.
 *
 * Only the OFF→ON edge clears the choice. Re-running this on every enabled render would make the
 * checkbox impossible to opt into deliberately while Kids mode is on.
 */
export function worktreeDeleteFromDiskAfterModeChange(
  current: boolean,
  wasKidsModeOn: boolean,
  kidsModeOn: boolean
): boolean {
  return !wasKidsModeOn && kidsModeOn ? false : current
}
