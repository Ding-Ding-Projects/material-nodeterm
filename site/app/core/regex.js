// site/app/core/regex.js
//
// Pure regex helpers shared by every anchored regex-builder popover on
// the site (see regexBuilder.js). Evaluation is local-only — nothing here
// ever transmits a pattern or sample text anywhere — and bounded, to
// protect the visitor's own tab from a runaway pattern.

const MAX_PATTERN_LEN = 300
const MAX_SAMPLE_LEN = 20000
const MAX_MATCHES = 500

export const LIMITS = { MAX_PATTERN_LEN, MAX_SAMPLE_LEN, MAX_MATCHES }

/**
 * compileSafe(pattern, flags) -> { ok, regex } | { ok: false, error }
 *
 * Bounds pattern length and refuses the classic nested-unbounded-quantifier
 * shape ((a+)+, (a*)* and similar) that causes catastrophic backtracking.
 * This is a heuristic, not a full static analyzer — the sample-size bound
 * in safeTestMatches() is the real backstop against a pattern this check
 * doesn't catch.
 */
export function compileSafe(pattern, flags) {
  if (typeof pattern !== 'string') return { ok: false, error: 'Pattern must be a string.' }
  if (pattern.length === 0) return { ok: false, error: 'Pattern is empty.' }
  if (pattern.length > MAX_PATTERN_LEN) {
    return { ok: false, error: `Pattern is too long (max ${MAX_PATTERN_LEN} characters).` }
  }
  if (/\([^()]*[+*]\)[+*]/.test(pattern)) {
    return {
      ok: false,
      error: 'This pattern shape (a repeated group inside another repetition) can hang the browser and is refused.',
    }
  }
  try {
    const regex = new RegExp(pattern, flags || '')
    return { ok: true, regex }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/**
 * safeTestMatches(regex, sample, { limit }) -> { matches, truncated }
 *
 * Bounds the sample text length and the number of matches collected, so a
 * pathological "global" match cannot loop indefinitely against a huge
 * string.
 */
export function safeTestMatches(regex, sample, { limit = MAX_MATCHES } = {}) {
  const text = typeof sample === 'string' && sample.length > MAX_SAMPLE_LEN ? sample.slice(0, MAX_SAMPLE_LEN) : sample || ''
  if (!regex.global) {
    const m = text.match(regex)
    return { matches: m ? [m] : [], truncated: false }
  }
  const re = new RegExp(regex.source, regex.flags)
  const matches = []
  let m
  let guard = 0
  while ((m = re.exec(text)) !== null && guard < limit) {
    matches.push(m)
    guard++
    if (m[0] === '') re.lastIndex++
  }
  return { matches, truncated: guard >= limit }
}

/** Plain-text substring test used as the default (non-regex) mode. */
export function plainTextMatches(query, haystack) {
  if (!query) return true
  return String(haystack).toLowerCase().includes(String(query).toLowerCase())
}
