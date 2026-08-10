export const LOOP_MIN_INTERVAL_MS = 60_000
export const LOOP_MAX_INTERVAL_MS = 365 * 24 * 60 * 60 * 1000
export const LOOP_DEFAULT_INTERVAL_MS = 15 * 60_000

export function validLoopInterval(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return LOOP_DEFAULT_INTERVAL_MS
  return Math.min(LOOP_MAX_INTERVAL_MS, Math.max(LOOP_MIN_INTERVAL_MS, Math.round(value)))
}

/**
 * Keep a future run unchanged. A missing or missed run is scheduled once from now, so waking
 * after several intervals never creates a catch-up burst.
 */
export function nextLoopRun(now: number, intervalMs: unknown, current?: unknown): number {
  if (typeof current === 'number' && Number.isFinite(current) && current > now) return current
  return now + validLoopInterval(intervalMs)
}

export function loopRunDue(now: number, nextRunAt: unknown): nextRunAt is number {
  return typeof nextRunAt === 'number' && Number.isFinite(nextRunAt) && nextRunAt <= now
}

/** Safe, deterministic mailbox identity: one message per loop, due instant and target. */
export function loopMessageId(loopId: string, targetId: string, scheduledAt: number): string {
  return `loopmsg-${loopId}-${targetId}-${Math.max(0, Math.floor(scheduledAt))}`
}
