import { MAX_MATCHES } from './engine'

export interface RegexGroupMatch {
  /** Named group name (`(?<name>…)`), or undefined for a plain numbered group. */
  name?: string
  /** `undefined` when the group didn't participate in this match (e.g. the unmatched side of `|`). */
  value: string | undefined
  index: number
}

export interface RegexMatchResult {
  start: number
  end: number
  text: string
  groups: RegexGroupMatch[]
}

export interface RunMatchesResult {
  matches: RegexMatchResult[]
  /** Hit MAX_MATCHES — there were more matches than we collected. */
  truncated: boolean
}

/**
 * Runs a compiled pattern against `sample` and collects every match (forcing the `g` flag
 * internally so callers never have to remember to set it), handling zero-width matches safely —
 * without the manual lastIndex bump, a pattern like `a*` matches an empty string at every
 * position and `regex.exec` never advances, spinning forever on a `g` regex.
 *
 * Pure and synchronous. Callers are responsible for the surrounding safety story: either the
 * caller already bounded `sample`'s length and applied `looksCatastrophic` (inline filters), or
 * this call is happening inside the time-boxed Worker (the builder's live preview) — see
 * safeEval.ts and safety.ts.
 */
export function runMatches(pattern: string, flags: string, sample: string): RunMatchesResult {
  const globalFlags = flags.includes('g') ? flags : `${flags}g`
  const re = new RegExp(pattern, globalFlags)
  const matches: RegexMatchResult[] = []
  let truncated = false
  let m: RegExpExecArray | null
  // Sticky isn't forced — a sticky pattern that doesn't match at index 0 legitimately returns no
  // matches, and forcing `y` off would silently change what the user is testing.
  while ((m = re.exec(sample)) !== null) {
    if (matches.length >= MAX_MATCHES) {
      truncated = true
      break
    }
    const groups: RegexGroupMatch[] = []
    for (let i = 1; i < m.length; i++) {
      groups.push({ value: m[i], index: i })
    }
    if (m.groups) {
      for (const [name, value] of Object.entries(m.groups)) {
        groups.push({ name, value, index: -1 })
      }
    }
    matches.push({ start: m.index, end: m.index + m[0].length, text: m[0], groups })
    if (m[0].length === 0) {
      // Zero-width match — advance by one code point so we don't loop forever on the same index.
      re.lastIndex += 1
    }
  }
  return { matches, truncated }
}
