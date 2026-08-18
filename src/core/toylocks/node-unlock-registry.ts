// The core-side answer to "may text be written into this node's terminal right now?"
//
// Exists because the renderer's gate is not enough. TerminalNode refuses input while its node lock
// is engaged, but several writers address a session by NAME straight through core — pty-manager's
// sendText (dictation, note pushes, canvas-control's open-terminal --cmd from an agent session) —
// and never pass through the renderer's client at all. Measured during the node-lock fix: a locked
// terminal's view went dark while dictation could still type into the underlying pty.
//
// The registry is DELIBERATELY in-memory and never persisted. "Unlocked right now" is ephemeral by
// contract — persisting it anywhere would defeat `lockedOnLaunch`, the one behavior every lock
// mode shares (see shared/toylock.ts). A fresh process therefore answers "not unlocked" for every
// node, which is exactly the locked-on-launch default.
//
// Fail-closed asymmetry, same rule as the renderer's store: a node WITH a lock record and no
// live unlock entry is blocked; a node with NO lock record is never blocked. The two questions are
// answered by different parties (records come from the sealed store via `hasLock`; liveness comes
// from renderer notifications), so the composition lives here where it cannot be re-derived
// subtly differently by each caller.

export interface NodeUnlockRegistry {
  /** Renderer reports a successful unlock of `lockId` covering `nodeId`, valid until `until`
   *  (epoch ms; Infinity for until-close/session modes — session relock arrives as `relock`). */
  markUnlocked(lockId: string, nodeId: string, until: number): void
  /** Renderer reports the lock re-engaged (surface left, timer elapsed, manual relock). */
  relock(lockId: string): void
  /** A lock was deleted entirely — its unlock entry must not outlive it. */
  drop(lockId: string): void
  /** May text reach this node's terminal? `hasLock` is the caller-supplied record check. */
  mayWrite(nodeId: string, hasLock: (nodeId: string) => boolean): boolean
  /** Everything forgotten (tests, dispose). */
  clear(): void
}

export function createNodeUnlockRegistry(now: () => number = Date.now): NodeUnlockRegistry {
  // lockId → { nodeId, until }. Keyed by lock, not node: relock/drop arrive with the lock id, and
  // a node can only carry one node-lock at a time by construction (one record per target).
  const live = new Map<string, { nodeId: string; until: number }>()

  return {
    markUnlocked(lockId, nodeId, until) {
      live.set(lockId, { nodeId, until })
    },
    relock(lockId) {
      live.delete(lockId)
    },
    drop(lockId) {
      live.delete(lockId)
    },
    mayWrite(nodeId, hasLock) {
      if (!hasLock(nodeId)) return true
      for (const entry of live.values()) {
        if (entry.nodeId !== nodeId) continue
        // Expiry is evaluated on READ, mirroring the renderer store's isUnlocked — a minutes-mode
        // unlock needs no timer here, and a stale entry can never authorize a write.
        if (now() < entry.until) return true
      }
      return false
    },
    clear() {
      live.clear()
    }
  }
}
