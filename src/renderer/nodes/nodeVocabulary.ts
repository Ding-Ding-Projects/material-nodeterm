/**
 * Apply the local vocabulary mapper to authored copy while retaining exact provider, service,
 * brand, protocol, URL, and other runtime facts. Facts are never passed through the mapper, even
 * when an uploaded term happens to contain one of them.
 */
export function mapAroundExactFacts(
  text: string,
  facts: readonly string[],
  map: (value: string) => string
): string {
  const preserved = facts.filter(Boolean)
  if (preserved.length === 0) return map(text)

  let remaining = text
  let result = ''
  while (remaining) {
    let nextIndex = -1
    let nextFact = ''
    for (const fact of preserved) {
      const index = remaining.indexOf(fact)
      if (index >= 0 && (nextIndex < 0 || index < nextIndex || (index === nextIndex && fact.length > nextFact.length))) {
        nextIndex = index
        nextFact = fact
      }
    }
    if (nextIndex < 0) return result + map(remaining)
    result += map(remaining.slice(0, nextIndex)) + nextFact
    remaining = remaining.slice(nextIndex + nextFact.length)
  }
  return result
}

/** Build the pending-launch summary with authored prose mapped and the agent/action facts raw. */
export function pendingLaunchSummaryText(
  launch: { kind: string; action?: string; agentId?: string },
  map: (value: string) => string
): string {
  if (launch.kind === 'shell-command') return map('the queued terminal command')
  const action = launch.action === 'resume' ? map('resume') : map('start')
  return `${action} ${launch.agentId ?? ''}`.trimEnd()
}

/**
 * Classify pending-launch copy by the operation result, not by matching a human-readable error
 * string. A missing renderer executor is an authored recovery state; a coordinator result is a
 * factual diagnostic, except for the shared session-unavailable result whose wording is owned by
 * the local executor.
 */
export function pendingLaunchErrorOwnership(
  result: { ok: boolean; reason?: string } | null,
  acceptedByExecutor: boolean
): 'authored' | 'external-factual' {
  if (!acceptedByExecutor) return 'authored'
  if (result && !result.ok && result.reason === 'session-unavailable') return 'authored'
  return 'external-factual'
}
