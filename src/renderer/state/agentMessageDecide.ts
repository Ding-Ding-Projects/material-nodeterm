/**
 * THE PURE DECIDER — every reason a delivery may not happen, decided without a single side effect.
 *
 * Ported from upstream's `src/core/agents/agent-message-decide.ts` (feat/agent-message-verbs +
 * feat/messaging-per-project-switch + feat/messaging-bounded-queue), scoped down to what this
 * tree can actually decide today. Upstream's decider additionally gates on kernel-verified pane
 * ownership (`isAgentPane` / `PtyManager.paneOwner`), hook-script revision staleness, and
 * bracketed-paste awareness — none of which exist in this codebase's control surface yet (our
 * `canvas-control-core.ts` verb dispatch trusts `nodesRef` + `agentStatus`, not a kernel-level
 * pane-owner proof). Porting those needs `src/core/agents/hooks/managed-script.ts`-equivalent
 * revision tracking and a `paneOwner` primitive this app does not have; that is explicitly left
 * as a gap (see CLAUDE.md's canvas-control-core section) rather than faked with a probe that
 * would silently always say "yes".
 *
 * The caller is a LANGUAGE MODEL: an outcome that is not retryable must SAY so, or the agent
 * tries again — with a per-pair rate limiter in front of it (see `agentMessageFlow.ts`), retrying
 * a permanent refusal is a busy-loop that burns tokens and produces nothing. Whether to retry is
 * therefore DATA (`RETRYABLE`), never prose the caller has to parse.
 */

/**
 * `unaddressable-node-id` is its own word rather than a shade of `cross-project`: an id outside
 * `SAFE_NODE_ID` may still be listed in the sender's OWN project (nothing validates ids on the
 * load path), so calling it a project-scope failure would misstate why it was refused.
 */
export type NotPermittedReason =
  | 'switch-off'
  | 'cross-project'
  | 'self-send'
  | 'unaddressable-node-id'
  /** The target id names nodes in MORE THAN ONE project. One id, several claimed owners — the
   *  grant cannot be attributed to either, so no single owner can be proved. Its own word because
   *  the human's fix is de-duplicating ids, not moving nodes. */
  | 'ambiguous-target-node-id'

export type AgentMessageOutcome =
  | { kind: 'delivered'; traceId: string }
  | { kind: 'queued'; traceId: string; position: number; ttlMs: number }
  | { kind: 'expired'; traceId: string; queuedForMs: number }
  | { kind: 'rateLimited'; retryAfterMs: number }
  | { kind: 'queueFull'; capacity: number }
  | { kind: 'targetBusy'; state: string }
  | { kind: 'targetGone' }
  | { kind: 'notPermitted'; reason: NotPermittedReason }

export type AgentMessageOutcomeKind = AgentMessageOutcome['kind']

/**
 * The retry column, as data — exhaustive BY THE TYPE: a new union member not listed here is a
 * compile error, never a runtime `undefined` that silently reads as "not retryable".
 */
export const RETRYABLE: Record<AgentMessageOutcomeKind, boolean> = {
  delivered: false,
  queued: false,
  expired: true,
  rateLimited: true,
  queueFull: true,
  targetBusy: true,
  targetGone: false,
  notPermitted: false
}

/** Cheapest-and-most-permanent first: a caller that cannot be helped is told so without touching
 *  a pane or burning rate-limit budget. */
export const DECISION_ORDER = ['notPermitted', 'rateLimited', 'targetGone', 'targetBusy'] as const

export interface DeliveryFacts {
  /** Compared to `targetNodeId` for the self-send backstop; absent skips that check. */
  sourceNodeId?: string
  targetNodeId?: string
  /** Set by the verb handler + the per-project switch. Cheapest gate: pure caller state. */
  notPermitted?: NotPermittedReason
  /** Set by the per-pair/fan-out limiter (`agentMessageFlow.ts`). `> 0` ⇒ refuse now, say when. */
  retryAfterMs?: number
  /** Is there a live terminal node for this id at all? False ⇒ `targetGone`. */
  targetLive: boolean
  /** The target's live agent state, when known. `undefined` = never reported / not an agent. */
  targetState?: 'working' | 'waiting' | 'blocked' | 'done'
  /** Would accepting this send exceed the recipient's bounded queue? */
  wouldOverflowQueue: boolean
  queueCapacity: number
}

/** The one non-refusal. Kept out of `AgentMessageOutcome` so no caller can return it as a result. */
export interface Proceed {
  kind: 'proceed'
}

/**
 * Decide whether a delivery may proceed immediately, must queue, or must be refused. Pure —
 * reads nothing but `f`. The sequence below IS `DECISION_ORDER`.
 */
export function decideDelivery(f: DeliveryFacts): AgentMessageOutcome | Proceed {
  if (f.notPermitted) return { kind: 'notPermitted', reason: f.notPermitted }
  // SELF-SEND is a backstop here too (the outer guard lives in `resolveDeliveryScope`), so no
  // future caller of this function alone can forget it.
  if (f.sourceNodeId && f.targetNodeId && f.sourceNodeId === f.targetNodeId) {
    return { kind: 'notPermitted', reason: 'self-send' }
  }
  if (typeof f.retryAfterMs === 'number' && f.retryAfterMs > 0) {
    return { kind: 'rateLimited', retryAfterMs: f.retryAfterMs }
  }
  if (!f.targetLive) return { kind: 'targetGone' }
  if (f.targetState === 'working' || f.targetState === 'blocked' || f.targetState === 'waiting') {
    return { kind: 'targetBusy', state: f.targetState }
  }
  // Target is live and idle (or unknown-but-not-flagged-busy) — deliver now unless the recipient's
  // bounded queue is already full. Queue-full is checked LAST among the free gates because it is
  // only reachable once every identity/rate refusal has already passed.
  if (f.wouldOverflowQueue) return { kind: 'queueFull', capacity: f.queueCapacity }
  return { kind: 'proceed' }
}
