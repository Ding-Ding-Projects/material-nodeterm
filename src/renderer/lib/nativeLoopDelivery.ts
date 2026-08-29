/** Normalize one shallow pane-command observation for cross-platform comparison. */
export function paneCommandName(value: string | null | undefined): string | null {
  if (!value) return null
  const name = value.trim().split(/[\\/]/).pop()?.toLowerCase()
  if (!name) return null
  return name.replace(/[.]exe$/, '')
}

/**
 * The session host reports native executable names such as `codex.exe`; agent configuration uses
 * the portable command name `codex`. Keep the comparison exact after normalizing only the path and
 * Windows executable suffix. This remains a shallow readiness check, not an identity proof.
 */
export function paneCommandMatchesAgent(
  observed: string | null | undefined,
  expected: string | null | undefined
): boolean {
  const actual = paneCommandName(observed)
  const wanted = paneCommandName(expected)
  return actual !== null && wanted !== null && actual === wanted
}
