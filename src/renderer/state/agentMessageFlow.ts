/**
 * FLOW CONTROL — a per-pair rate limit and a per-turn fan-out cap. Ported from upstream's
 * `src/core/agents/agent-message-flow.ts` (feat/messaging-per-project-switch review + PR #239).
 *
 * Both are PRE-PROBE by construction: a refusal here costs nothing but a Map lookup, so no tmux
 * round-trip and — on an SSH project — no real login is spent on a message that was going to be
 * refused anyway.
 *
 * State lives in process (module) memory, for the app's lifetime, and that is a decision rather
 * than an omission: a LOST limiter after a restart is a brief over-send (every pair starts clean),
 * which is bounded and self-healing. A STUCK limiter — an entry that outlives its meaning and
 * refuses every future delivery — is the failure this module refuses to have, so every path that
 * could produce one fails OPEN: a fan-out budget whose reset signal (`noteNewTurn`) never arrives
 * expires on its own after `TURN_STALE_MS`, and a non-finite clock reading is treated as "no
 * budget recorded yet" rather than as an immortal entry.
 */

/** The minimum gap between two deliveries on the same (sender, recipient) pair. */
export const PAIR_MIN_INTERVAL_MS = 10_000

/** How many DIFFERENT deliveries one sender may make inside a single turn. */
export const FANOUT_PER_TURN = 4

/** A fan-out budget that has seen no send for this long belongs to a turn that is over — the
 *  backstop for a `noteNewTurn` signal that never arrives (see module doc). */
export const TURN_STALE_MS = 5 * 60_000

/** What a fan-out refusal reports as `retryAfterMs` — a floor, not a promise: the budget really
 *  resets on a turn boundary, which is not a clock event. `PAIR_MIN_INTERVAL_MS` is the honest
 *  lower bound, since nothing this sender does can land sooner than that anyway. */
export const FANOUT_RETRY_AFTER_MS = PAIR_MIN_INTERVAL_MS

/** The pair-key separator. Written as the escape `\u0000`, never as a raw NUL byte in this file —
 *  a raw NUL in source makes git/grep skip the whole file in silence.
 *
 *  INJECTIVE ONLY over ids that pass `isSafeNodeId` (see `agentMessageScope.ts`): an id containing
 *  this separator would collide two different conversations. Every caller of this module MUST
 *  validate ids through `resolveDeliveryScope` first — this module does not re-check them. */
export function pairKey(src: string, dst: string): string {
  return `${src}\u0000${dst}`
}

const pairLastSentAt = new Map<string, number>()

interface FanoutBudget {
  count: number
  lastSentAt: number
}
const fanoutBySender = new Map<string, FanoutBudget>()

function finite(n: number): boolean {
  return Number.isFinite(n)
}

/** Record that a delivery was ADMITTED (not refused) for this pair/sender, at `now`. Call this
 *  only once the send has actually been accepted — never speculatively. */
export function noteSent(sourceNodeId: string, targetNodeId: string, now: number): void {
  if (!finite(now)) return
  pairLastSentAt.set(pairKey(sourceNodeId, targetNodeId), now)
  const budget = fanoutBySender.get(sourceNodeId)
  if (!budget || now < budget.lastSentAt || now - budget.lastSentAt > TURN_STALE_MS) {
    fanoutBySender.set(sourceNodeId, { count: 1, lastSentAt: now })
  } else {
    fanoutBySender.set(sourceNodeId, { count: budget.count + 1, lastSentAt: now })
  }
}

/** The sender started a genuinely new turn: its fan-out budget resets. */
export function noteNewTurn(sourceNodeId: string): void {
  fanoutBySender.delete(sourceNodeId)
}

export interface FlowCheck {
  ok: boolean
  retryAfterMs?: number
}

/** Would a send from `sourceNodeId` to `targetNodeId` clear both budgets right now? Pure given
 *  `now` (module state aside — see doc header on why that state is deliberately volatile). */
export function checkFlow(sourceNodeId: string, targetNodeId: string, now: number): FlowCheck {
  if (!finite(now)) return { ok: true } // a broken clock must never manufacture a stuck refusal
  const lastPair = pairLastSentAt.get(pairKey(sourceNodeId, targetNodeId))
  if (typeof lastPair === 'number' && now >= lastPair && now - lastPair < PAIR_MIN_INTERVAL_MS) {
    return { ok: false, retryAfterMs: PAIR_MIN_INTERVAL_MS - (now - lastPair) }
  }
  const budget = fanoutBySender.get(sourceNodeId)
  if (budget && now >= budget.lastSentAt && now - budget.lastSentAt <= TURN_STALE_MS && budget.count >= FANOUT_PER_TURN) {
    return { ok: false, retryAfterMs: FANOUT_RETRY_AFTER_MS }
  }
  return { ok: true }
}

/** Test-only: drop every recorded budget so suites don't leak state across cases. */
export function resetAgentMessageFlowForTests(): void {
  pairLastSentAt.clear()
  fanoutBySender.clear()
}
