/**
 * The strength of the confirmation which disclosed and approved a destructive target.
 *
 * `ordinary` includes both the historical one-button dialog and an immediate ordinary-mode
 * action. Neither may be spent after the authoritative Kids policy tightens. A completed
 * `two-key` authorization remains the stronger approval if the policy later relaxes.
 */
export type DestructiveAuthorization = 'ordinary' | 'two-key'

export interface LiveDestructiveTarget<T> {
  /** Exact, non-secret identity of the target which would be passed to the mutation helper. */
  identity: string
  target: T
  /** True when Kids mode is enabled OR its authoritative policy record is not ready. */
  kidsGateRequired: boolean
}

export type DestructiveCommitRefusal = 'target-changed' | 'target-unavailable'
export type DestructiveCommitResult =
  | 'performed'
  | 'upgraded-to-two-key'
  | DestructiveCommitRefusal
  | 'already-settled'

export interface DestructiveCommitBarrierOptions<T> {
  /** Identity disclosed by the confirmation whose callback owns this barrier. */
  disclosedIdentity: string
  authorization: DestructiveAuthorization
  /** Re-read from the owning live store at the last synchronous boundary before mutation. */
  readCurrent(): LiveDestructiveTarget<T> | null
  perform(target: T): void
  /** Start a fresh two-key request from the just-read target; do not reuse stale dialog copy. */
  upgradeToTwoKey(target: T): void
  refuse?(reason: DestructiveCommitRefusal): void
}

/**
 * Create a once-only destructive commit callback.
 *
 * A dialog approves one disclosed incarnation, not whichever object later reuses its id. The live
 * target and authoritative Kids verdict are therefore read again when the callback fires. Missing
 * or unreadable proof performs nothing. An ordinary approval is upgraded, never spent, when policy
 * readiness changes while the dialog is open.
 *
 * `settled` flips before any caller-controlled callback. That ordering closes both double delivery
 * and synchronous re-entry through `readCurrent`, `refuse`, `upgradeToTwoKey`, or `perform`.
 */
export function createDestructiveCommitBarrier<T>(
  options: DestructiveCommitBarrierOptions<T>
): () => DestructiveCommitResult {
  let settled = false

  return () => {
    if (settled) return 'already-settled'
    settled = true

    let current: LiveDestructiveTarget<T> | null
    try {
      current = options.readCurrent()
    } catch {
      options.refuse?.('target-unavailable')
      return 'target-unavailable'
    }

    if (!current || current.identity !== options.disclosedIdentity) {
      const reason: DestructiveCommitRefusal = current ? 'target-changed' : 'target-unavailable'
      options.refuse?.(reason)
      return reason
    }

    if (options.authorization === 'ordinary' && current.kidsGateRequired) {
      options.upgradeToTwoKey(current.target)
      return 'upgraded-to-two-key'
    }

    options.perform(current.target)
    return 'performed'
  }
}

/** Primitive-only, length-safe identity encoding. Callers must enumerate every target field. */
export function destructiveTargetIdentity(
  parts: readonly (string | number | boolean | null | undefined)[]
): string {
  return JSON.stringify(parts)
}
