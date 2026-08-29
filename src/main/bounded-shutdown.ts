export const SPEECH_SHUTDOWN_DEADLINE_MS = 1_000

export type BoundedShutdownResult = 'completed' | 'rejected' | 'timed-out'

/**
 * Wait for one shutdown step without allowing a native addon or socket to hold the app forever.
 * The result is deliberately small and path-free so callers can report only the lifecycle state.
 */
export function settleShutdownWithin(
  work: PromiseLike<unknown> | unknown,
  timeoutMs = SPEECH_SHUTDOWN_DEADLINE_MS
): Promise<BoundedShutdownResult> {
  const deadline = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : SPEECH_SHUTDOWN_DEADLINE_MS
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: BoundedShutdownResult): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }
    timer = setTimeout(() => finish('timed-out'), deadline)
    Promise.resolve(work).then(
      () => finish('completed'),
      () => finish('rejected')
    )
  })
}
