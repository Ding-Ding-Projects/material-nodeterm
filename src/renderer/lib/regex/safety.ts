import { MAX_PATTERN_LENGTH } from './engine'

export interface CompileResult {
  ok: boolean
  regex?: RegExp
  error?: string
}

/**
 * Compiles a pattern against the ONE dialect this app speaks (native `RegExp`). Every caller gets
 * a `{ok:false, error}` instead of a thrown exception — a malformed pattern is a normal, expected
 * state while the user is mid-edit, not a bug to crash a search field over.
 */
export function compilePattern(pattern: string, flags: string): CompileResult {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return { ok: false, error: `Pattern is longer than the ${MAX_PATTERN_LENGTH}-character limit.` }
  }
  try {
    return { ok: true, regex: new RegExp(pattern, flags) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * A deliberately conservative, purely STATIC heuristic for "this pattern has the classic shape
 * of catastrophic backtracking" — nested quantifiers like `(a+)+`, `(a*)*`, `(a+)*`, or a
 * quantified group containing alternation with overlapping branches like `(a|a)+`. It is a
 * heuristic, not a proof: it can flag a pattern that would actually run fine, and it cannot catch
 * every pathological shape. Its job is narrow — decide whether a pattern is safe to run
 * SYNCHRONOUSLY, inline, against every row of a menu/list on every keystroke (no time to spare
 * for a Worker round-trip there). The builder's own live-match preview does NOT rely on this: it
 * always runs inside a time-boxed Worker (see safeEval.ts) regardless of what this returns, so a
 * pattern this heuristic misses can still only ever hang the preview panel, never the app.
 */
export function looksCatastrophic(pattern: string): boolean {
  // A group ending in a quantifier, where the group's own body also contains a quantifier or an
  // alternation — e.g. (a+)+, (a*)+, (\d+)*, ([a-z]+)+, (a|ab)+, (a+|b+)*.
  const nestedQuantifier = /\([^()]*[*+][^()]*\)[*+]|\([^()]*\|[^()]*\)[*+{]/
  // A chain of back-to-back unbounded wildcards (`.*.*`, `.+.*.+`, …) — cheap for a single `.`
  // but a well-known source of exponential blowup once a few appear in sequence.
  const chainedWildcards = /(?:\.[*+]){2,}/
  return nestedQuantifier.test(pattern) || chainedWildcards.test(pattern)
}

/**
 * Compiles + guards a pattern for a SYNCHRONOUS, inline filter surface (menus, the command
 * palette, the Explorer tree, settings rows). Returns `null` when the pattern is empty, invalid,
 * or looks catastrophic — every one of those states means "don't filter with this yet", and the
 * caller should fail OPEN (show everything) rather than silently hang the tab.
 */
export function compileForInlineFilter(pattern: string, flags: string): RegExp | null {
  const trimmed = pattern.trim()
  if (!trimmed) return null
  if (looksCatastrophic(trimmed)) return null
  const compiled = compilePattern(trimmed, flags.includes('g') ? flags : `${flags}g`)
  return compiled.ok ? compiled.regex ?? null : null
}
