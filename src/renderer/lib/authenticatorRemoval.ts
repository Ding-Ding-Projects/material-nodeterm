import type { AuthenticatorEntry } from '@shared/authenticator'
import { requiresDestructiveGate } from '@shared/kids-mode-policy'
import {
  destructiveTargetIdentity,
  type DestructiveAuthorization
} from './destructiveAuthorization'

export type AuthenticatorRemovalConfirmation = 'destructive-gate' | 'plain-confirm'

export interface AuthenticatorRemovalPlan {
  confirmation: AuthenticatorRemovalConfirmation
  title: string
  description: string
  message: string
  affected: string[]
}

export function authenticatorRemovalTargetIdentity(entry: AuthenticatorEntry): string {
  return destructiveTargetIdentity([
    entry.id,
    entry.issuer,
    entry.account,
    entry.algorithm,
    entry.digits,
    entry.period,
    entry.createdAt,
    entry.updatedAt,
    entry.revision,
    entry.linkedToyLockId
  ])
}

export function planAuthenticatorRemoval(
  entry: AuthenticatorEntry,
  kidsGateRequired: boolean
): AuthenticatorRemovalPlan {
  const label = `${entry.issuer} — ${entry.account}`
  const linked = entry.linkedToyLockId
    ? ' This seed is also linked to a toy lock; removing this copy does not remove that lock.'
    : ''
  return {
    confirmation: requiresDestructiveGate('remove-authenticator', kidsGateRequired).required
      ? 'destructive-gate'
      : 'plain-confirm',
    title: `Remove authenticator seed for “${label}”`,
    description:
      `This app’s sealed copy of the TOTP seed is deleted. Live and future codes for this entry ` +
      `disappear from nodeterm. This does not change the other service’s account.${linked}`,
    message:
      `Remove the authenticator entry for "${label}"? This app’s sealed TOTP seed and its live ` +
      `codes are deleted. The other service’s account is not changed.${linked}`,
    affected: [label]
  }
}

export interface AuthenticatorRemovalDispatchDeps {
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

export function dispatchAuthenticatorRemoval(
  plan: AuthenticatorRemovalPlan,
  deps: AuthenticatorRemovalDispatchDeps
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
