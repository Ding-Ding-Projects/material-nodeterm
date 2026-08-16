/**
 * The authorization shown for a destructive action.
 *
 * `ordinary` covers both an existing one-button confirmation and an action whose ordinary-mode
 * contract is immediate. The distinction does not matter at the commit boundary: neither is the
 * Kids two-key gate. `two-key` is the stronger authorization and remains valid if Kids mode turns
 * off while its completion animation runs.
 */
export type DestructiveAuthorization = 'ordinary' | 'two-key'

export interface LiveDestructiveTarget<T> {
  /** Exact, non-secret identity of what will be changed. */
  identity: string
  target: T
  /** True for Kids mode ON and for an unavailable/untrusted Kids-mode record. */
  kidsGateRequired: boolean
}

export type DestructiveCommitRefusal = 'target-changed' | 'target-unavailable'
export type DestructiveCommitResult =
  | 'performed'
  | 'upgraded-to-two-key'
  | DestructiveCommitRefusal
  | 'already-settled'

export interface DestructiveCommitBarrierOptions<T> {
  /** Identity that was disclosed by the dialog whose callback owns this barrier. */
  disclosedIdentity: string
  authorization: DestructiveAuthorization
  /** Re-read from the owning live store immediately before the irreversible call. */
  readCurrent(): LiveDestructiveTarget<T> | null
  perform(target: T): void
  /** Re-open the action from a fresh target snapshot under the two-key gate. */
  upgradeToTwoKey(target: T): void
  refuse?(reason: DestructiveCommitRefusal): void
}

/**
 * Make a once-only commit callback for an asynchronous confirmation surface.
 *
 * A dialog is a disclosure about one target under one policy snapshot, not a capability token for
 * whatever occupies that id later. The callback therefore re-reads both facts at the last possible
 * synchronous boundary. A changed/missing target performs nothing. An ordinary confirmation whose
 * Kids verdict has tightened performs nothing and starts a fresh two-key request instead.
 *
 * Settling before any callback prevents a double click or a re-entrant callback from running an
 * irreversible action twice. A failed live read is not evidence that the old target still exists.
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
      options.refuse?.(current ? 'target-changed' : 'target-unavailable')
      return current ? 'target-changed' : 'target-unavailable'
    }

    if (options.authorization === 'ordinary' && current.kidsGateRequired) {
      options.upgradeToTwoKey(current.target)
      return 'upgraded-to-two-key'
    }

    options.perform(current.target)
    return 'performed'
  }
}

/** Primitive-only identity encoding so call sites spell out every field the user was shown. */
export function destructiveTargetIdentity(
  parts: readonly (string | number | boolean | null | undefined)[]
): string {
  return JSON.stringify(parts)
}
