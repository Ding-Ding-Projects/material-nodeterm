import { requiresDestructiveGate } from '@shared/kids-mode-policy'
import type { DestructiveAuthorization } from './destructiveAuthorization'

export type AccountRemovalConfirmation = 'destructive-gate' | 'plain-confirm'

export interface AccountRemovalPlan {
  confirmation: AccountRemovalConfirmation
  title: string
  description: string
  message: string
  affected: string[]
}

export interface PlanAccountRemovalInput {
  label: string
  affectedNodeCount: number
  kidsModeOn: boolean
}

/**
 * Decide the confirmation before any credential, transcript, account record, or login node moves.
 *
 * Account removal is its own destructive action even when no login node is open: the credentials
 * and transcript directory are still deleted. The active login-node closure is disclosed here as
 * part of the same transaction and therefore must not open a second confirmation afterward.
 */
export function planAccountRemoval({
  label,
  affectedNodeCount,
  kidsModeOn
}: PlanAccountRemovalInput): AccountRemovalPlan {
  const account = label.trim() || 'Account'
  const nodeSummary = `${affectedNodeCount} node${affectedNodeCount === 1 ? '' : 's'}`
  return {
    confirmation: requiresDestructiveGate('remove-account', kidsModeOn).required
      ? 'destructive-gate'
      : 'plain-confirm',
    title: `Remove account “${account}”`,
    description:
      `Its stored credentials and Claude transcripts are deleted. Its open login sessions close, ` +
      `and its other nodes fall back to the system account. This cannot be undone.`,
    message:
      `Remove account "${account}"? Its stored credentials and Claude transcripts will be ` +
      `deleted. Open login sessions close; other affected nodes fall back to the system account. ` +
      `${nodeSummary} currently use this account.`,
    affected: [account, nodeSummary]
  }
}

export interface AccountRemovalDispatchDeps {
  perform(authorization: DestructiveAuthorization): void
  cancel?(): void
  openGate(request: {
    title: string
    description: string
    affected: string[]
    confirmLabel: string
    onConfirm: () => void
    onCancel?: () => void
  }): boolean
  openConfirm(request: {
    message: string
    onConfirm: () => void
    onCancel?: () => void
  }): boolean
}

/** Execute only from the callback owned by the selected confirmation surface. */
export function dispatchAccountRemoval(
  plan: AccountRemovalPlan,
  deps: AccountRemovalDispatchDeps
): boolean {
  if (plan.confirmation === 'destructive-gate') {
    return deps.openGate({
      title: plan.title,
      description: plan.description,
      affected: plan.affected,
      confirmLabel: 'Remove',
      onConfirm: () => deps.perform('two-key'),
      onCancel: deps.cancel
    })
  }

  return deps.openConfirm({
    message: plan.message,
    onConfirm: () => deps.perform('ordinary'),
    onCancel: deps.cancel
  })
}

/** Exact non-secret account metadata disclosed by the removal dialog. */
export function accountRemovalTargetIdentity(
  account: ClaudeAccount,
  affectedNodeIdentities: readonly string[] = []
): string {
  return destructiveTargetIdentity([
    account.id,
    account.label,
    account.email,
    account.host,
    account.pending,
    account.createdAt,
    ...[...affectedNodeIdentities].sort()
  ])
}

/**
 * Synchronous handshake between Settings (which owns the account transaction) and Canvas (which
 * owns live terminal teardown). `handled` is deliberately mutable: `dispatchEvent` invokes every
 * listener before it returns, so Settings can refuse to delete credentials when no live-canvas
 * owner accepted the request. `continueRemoval` is once-only because a second listener must never
 * run the irreversible account transaction twice.
 */
export interface AccountRemovalTeardownDetail {
  accountId: string
  /** Exact strength of the account confirmation already spent by Settings. */
  authorization: DestructiveAuthorization
  handled: boolean
  continueRemoval(): void
}

export const ACCOUNT_REMOVAL_TEARDOWN_EVENT = 'nodeterm:account-removal-approved'
export const ACCOUNT_REMOVAL_COMMITTED_EVENT = 'nodeterm:account-removal-committed'
export const ACCOUNT_REMOVAL_SCOPE_EVENT = 'nodeterm:account-removal-scope'

export interface AccountRemovalScopeDetail {
  accountId: string
  handled: boolean
  identities: string[]
}

/** Synchronously read the active Canvas facts which are newer than its serialized project copy. */
export function requestAccountRemovalScope(
  accountId: string,
  dispatch: (detail: AccountRemovalScopeDetail) => void
): string[] | null {
  const detail: AccountRemovalScopeDetail = { accountId, handled: false, identities: [] }
  dispatch(detail)
  return detail.handled ? [...detail.identities].sort() : null
}

export function accountRemovalNodeTargetIdentity(input: {
  projectId: string
  id: string
  type?: string
  title?: string
  accountId?: string
  accountLogin?: boolean
  incarnation?: number
}): string {
  return destructiveTargetIdentity([
    input.projectId,
    input.id,
    input.type,
    input.title,
    input.accountId,
    input.accountLogin,
    input.incarnation
  ])
}

export function requestAccountRemovalTeardown(
  accountId: string,
  authorization: DestructiveAuthorization,
  continueRemoval: () => void,
  dispatch: (detail: AccountRemovalTeardownDetail) => void
): boolean {
  let continued = false
  const detail: AccountRemovalTeardownDetail = {
    accountId,
    authorization,
    handled: false,
    continueRemoval() {
      if (continued) return
      continued = true
      continueRemoval()
    }
  }
  dispatch(detail)
  return detail.handled
}

export interface AccountRemovalCanvasNode {
  id: string
  data: {
    accountId?: string
    accountLogin?: boolean
    title?: string
    initialCommand?: string
  }
}

export interface AuthorizedAccountLoginDeletion {
  surface: 'account-removal'
  authorizedBy: { action: 'remove-account'; authorization: DestructiveAuthorization }
  perform(): void
}

export interface AccountRemovalTeardownDeps {
  isLoginNode(node: AccountRemovalCanvasNode): boolean
  requestDeleteNodes(ids: string[], request: AuthorizedAccountLoginDeletion): boolean
  deleteNodes(ids: string[]): Promise<{
    confirmed: string[]
    failed: Array<{ nodeId: string; message: string }>
  }>
}

/**
 * Accept an approved account transaction on the active Canvas.
 *
 * Login terminals close through the same `requestDeleteNodes` funnel as every other session. The
 * account gate's authorization is valid only for this account-removal surface; the funnel's
 * `perform` callback closes/reconciles live nodes before allowing Settings to touch credentials or
 * persisted account state. A rejected/unhandled close therefore leaves the account transaction
 * untouched instead of deleting the account out from under a still-running login process.
 */
export function handleAccountRemovalTeardown(
  detail: AccountRemovalTeardownDetail,
  nodes: readonly AccountRemovalCanvasNode[],
  deps: AccountRemovalTeardownDeps
): boolean {
  if (!detail.accountId || detail.handled) return false

  const loginIds = nodes
    .filter((node) => node.data.accountId === detail.accountId && deps.isLoginNode(node))
    .map((node) => node.id)
  let completed = false
  let deletionStarted = false
  const complete = (): void => {
    if (completed) return
    completed = true
    detail.continueRemoval()
  }

  detail.handled = true
  if (!loginIds.length) {
    complete()
    return true
  }

  const accepted = deps.requestDeleteNodes(loginIds, {
    surface: 'account-removal',
    authorizedBy: { action: 'remove-account', authorization: detail.authorization },
    perform: () => {
      if (completed || deletionStarted) return
      deletionStarted = true
      // Account credentials may be removed only after every disclosed login session has a
      // confirmed backing-host acknowledgement. A disconnected kill is an unknown outcome, not
      // permission to delete the account from under a possibly still-running login process.
      void deps
        .deleteNodes(loginIds)
        .then((outcome) => {
          if (
            outcome.failed.length > 0 ||
            loginIds.some((id) => !outcome.confirmed.includes(id))
          )
            return
          complete()
        })
        .catch(() => {
          // The Canvas teardown path owns the visible error. Keep the account untouched.
        })
    }
  })
  if (!accepted) detail.handled = false
  return accepted
}

/** Notification emitted only after the credential/API removal and persisted-store transforms. */
export interface AccountRemovalCommittedDetail {
  accountId: string
}

export interface AccountRemovalCommittedDeps {
  clearLiveBindings(accountId: string): void
  markDirty(): void
}

/** Apply the successful transaction to whichever project is live when the async removal lands. */
export function handleAccountRemovalCommitted(
  detail: AccountRemovalCommittedDetail,
  deps: AccountRemovalCommittedDeps
): boolean {
  if (!detail.accountId) return false
  deps.clearLiveBindings(detail.accountId)
  deps.markDirty()
  return true
}
