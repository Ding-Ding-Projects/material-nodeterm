import { requiresDestructiveGate } from '@shared/kids-mode-policy'
import {
  createDestructiveCommitBarrier,
  destructiveTargetIdentity,
  type DestructiveAuthorization,
  type DestructiveCommitRefusal,
  type DestructiveCommitResult
} from './destructiveAuthorization'

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
  'agent-control',
  'account-removal'
] as const

export type NodeDeleteSurface = (typeof NODE_DELETE_SURFACES)[number]

export type NodeDeletionConfirmation = 'destructive-gate' | 'plain-confirm' | 'immediate'

export interface NodeDeletionPlan {
  confirmation: NodeDeletionConfirmation
  /** Strength inherited from an already-approved enclosing account removal, when supplied. */
  inheritedAuthorization?: DestructiveAuthorization
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
  /** The account-removal gate already disclosed and authorized closing its login nodes. */
  authorizedBy?:
    | 'remove-account'
    | { action: 'remove-account'; authorization: DestructiveAuthorization }
}

/** Ordinary-mode behaviour that predates Kids mode. Kids mode overrides every row to the gate. */
const ORDINARY_CONFIRMATION: Record<NodeDeleteSurface, NodeDeletionConfirmation> = {
  canvas: 'destructive-gate',
  kanban: 'plain-confirm',
  'window-shortcut': 'immediate',
  'sessions-sidebar': 'plain-confirm',
  'agent-control': 'plain-confirm',
  'account-removal': 'plain-confirm'
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
  removesNode = true,
  authorizedBy
}: PlanNodeDeletionInput): NodeDeletionPlan {
  const named = titles.length ? titles.map((title) => title.trim() || 'node') : ['node']
  const count = named.length
  const one = named[0]
  const confirmation =
    surface === 'account-removal' &&
    (authorizedBy === 'remove-account' ||
      (typeof authorizedBy === 'object' && authorizedBy.action === 'remove-account'))
      ? 'immediate'
      : requiresDestructiveGate('delete-node', kidsModeOn).required
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
    // The string shape is retained only for the pre-barrier account caller. It cannot prove a
    // two-key approval, so the commit boundary treats it as ordinary and upgrades if policy is now
    // strict. New callers carry the exact authorization strength in the object shape.
    inheritedAuthorization:
      typeof authorizedBy === 'object' ? authorizedBy.authorization : authorizedBy ? 'ordinary' : undefined,
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
  perform(authorization: DestructiveAuthorization): void
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
  // Consume either decision once. Dialog callback delivery is outside this module and can be
  // duplicated or re-entered; a cancellation is also final for the disclosed authorization.
  let settled = false
  const perform = (authorization: DestructiveAuthorization): void => {
    if (settled) return
    settled = true
    deps.perform(authorization)
  }
  const cancel = (): void => {
    if (settled) return
    settled = true
    deps.cancel?.()
  }

  if (plan.confirmation === 'immediate') {
    perform(plan.inheritedAuthorization ?? 'ordinary')
    return true
  }

  if (plan.confirmation === 'destructive-gate') {
    return deps.openGate({
      title: plan.title,
      description: plan.description,
      affected: plan.affected,
      onConfirm: () => perform('two-key'),
      onCancel: cancel
    })
  }

  return deps.openConfirm({
    message: plan.message,
    onConfirm: () => perform('ordinary'),
    onCancel: cancel
  })
}

/** Exact target facts which make one node/session incarnation distinguishable from another. */
export interface NodeDeletionTarget {
  projectId: string
  id: string
  type?: string
  title?: string
  accountId?: string
  parentId?: string
  /** Object-generation token: a same-id replacement must never inherit an old approval. */
  incarnation?: number
  /** Owning session/core generation, or exact external-session identity for an orphan. */
  runtimeIdentity: string
}

const nodeTargetIncarnations = new WeakMap<object, number>()
let nextNodeTargetIncarnation = 1

/** Stable for one live object, distinct for every replacement object even when labels are reused. */
export function nodeDeletionTargetIncarnation(target: object): number {
  const existing = nodeTargetIncarnations.get(target)
  if (existing !== undefined) return existing
  const created = nextNodeTargetIncarnation++
  nodeTargetIncarnations.set(target, created)
  return created
}

export function nodeDeletionTargetIdentity(targets: readonly NodeDeletionTarget[]): string {
  const ordered = [...targets].sort((a, b) =>
    `${a.projectId}\u0000${a.id}`.localeCompare(`${b.projectId}\u0000${b.id}`)
  )
  return destructiveTargetIdentity(
    ordered.flatMap((target) => [
      target.projectId,
      target.id,
      target.type,
      target.title,
      target.accountId,
      target.parentId,
      target.incarnation,
      target.runtimeIdentity
    ])
  )
}

export function orphanSessionRuntimeIdentity(row: {
  session: string
  nodeId: string
  panePid?: number
  command?: string
}): string {
  return destructiveTargetIdentity([row.session, row.nodeId, row.panePid, row.command])
}

export interface NodeDeletionCommitBarrierOptions {
  disclosedTargets: readonly NodeDeletionTarget[]
  authorization: DestructiveAuthorization
  readCurrent(): NodeDeletionTarget[] | null
  kidsGateRequired(): boolean
  perform(targets: NodeDeletionTarget[]): void
  upgradeToTwoKey(targets: NodeDeletionTarget[]): void
  refuse?(reason: DestructiveCommitRefusal): void
}

/** Behavior-level target/policy barrier used by every node/session confirmation surface. */
export function createNodeDeletionCommitBarrier(
  options: NodeDeletionCommitBarrierOptions
): () => DestructiveCommitResult {
  return createDestructiveCommitBarrier({
    disclosedIdentity: nodeDeletionTargetIdentity(options.disclosedTargets),
    authorization: options.authorization,
    readCurrent: () => {
      const current = options.readCurrent()
      return current
        ? {
            identity: nodeDeletionTargetIdentity(current),
            target: current,
            kidsGateRequired: options.kidsGateRequired()
          }
        : null
    },
    perform: options.perform,
    upgradeToTwoKey: options.upgradeToTwoKey,
    refuse: options.refuse
  })
}

export interface ProjectOwnedNodeDeletionDeps {
  /** Read at commit time; a confirmation may outlive a project switch. */
  readActiveProjectId(): string | null
  deleteFromActiveProject(): void
  deleteFromStoredProject(): void
}

/**
 * Commit a sidebar deletion against the project that still owns the disclosed node.
 *
 * The active project is deliberately re-read here. Capturing it when the dialog opens lets a
 * later project switch route the approved deletion into the replacement canvas instead.
 */
export function performProjectOwnedNodeDeletion(
  projectId: string,
  deps: ProjectOwnedNodeDeletionDeps
): 'active-project' | 'stored-project' {
  if (deps.readActiveProjectId() === projectId) {
    deps.deleteFromActiveProject()
    return 'active-project'
  }
  deps.deleteFromStoredProject()
  return 'stored-project'
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
  kidsGateRequired: boolean
): boolean {
  return createdByApp && !kidsGateRequired
}

/**
 * Reconcile an already-open removal dialog with a live Kids-mode change.
 *
 * Only the OFF→ON edge clears the choice. Re-running this on every enabled render would make the
 * checkbox impossible to opt into deliberately while Kids mode is on.
 */
export function worktreeDeleteFromDiskAfterModeChange(
  current: boolean,
  wasKidsGateRequired: boolean,
  kidsGateRequired: boolean
): boolean {
  return !wasKidsGateRequired && kidsGateRequired ? false : current
}
