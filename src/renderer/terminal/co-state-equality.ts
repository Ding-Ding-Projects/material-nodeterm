/**
 * The park-surviving terminal UI state is published only when a visible field changed. Keep this
 * pure comparison outside TerminalNode so a newly added error cannot be omitted from the gate and
 * silently disappear — the exact regression that originally swallowed spawn failures.
 */
export interface ComparableTerminalCoState {
  letterbox: boolean
  closed: unknown
  ended: boolean
  offline: boolean
  spawnError: string | null
  agentRelaunchError: unknown
}

export function sameTerminalCoState(
  previous: ComparableTerminalCoState,
  next: ComparableTerminalCoState
): boolean {
  return (
    next.letterbox === previous.letterbox &&
    next.closed === previous.closed &&
    next.ended === previous.ended &&
    next.offline === previous.offline &&
    next.spawnError === previous.spawnError &&
    next.agentRelaunchError === previous.agentRelaunchError
  )
}
