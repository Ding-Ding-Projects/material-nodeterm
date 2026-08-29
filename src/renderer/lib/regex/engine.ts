/**
 * The one and only regex dialect this app speaks: native JavaScript `RegExp` (ECMAScript
 * syntax), exactly as `new RegExp(pattern, flags)` compiles it in the renderer. Every search
 * surface that offers regex mode (find bar, command palette, Explorer filter, settings search,
 * context menus) runs THIS engine — nothing is translated to PCRE, RE2, POSIX, or any other
 * dialect. The regex builder says so in its own UI; this file is the single source of truth for
 * that claim so the two can never drift apart.
 */
export const REGEX_ENGINE_NAME = 'JavaScript RegExp (ECMAScript)'
export const REGEX_ENGINE_NOTE =
  'Patterns compile with new RegExp(pattern, flags) — the same syntax, flags, and backslash-escaping rules Chrome/Node use everywhere else in this app. Not PCRE, not RE2, not POSIX.'

/** Hard bounds — evaluated locally, never transmitted or persisted beyond the component's own
 *  in-memory state, and never written past component unmount. */
export const MAX_PATTERN_LENGTH = 500
export const MAX_SAMPLE_LENGTH = 20_000
/** Menus, the Explorer tree, the command palette and settings rows filter against SHORT strings
 *  (a label, a filename, a setting title) — clamped further so a pasted 10 KB "label" can't turn
 *  an inline filter into its own performance problem. */
export const MAX_FILTER_CANDIDATE_LENGTH = 300
/** Live-preview match cap: the builder stops collecting matches past this count and says so,
 *  rather than rendering thousands of <mark> spans into the DOM. */
export const MAX_MATCHES = 500
/** Wall-clock budget for the builder's Worker-backed live preview (see safeEval.ts). A pattern
 *  that has not answered within this window is presumed catastrophic and the Worker is killed. */
export const MATCH_TIME_BUDGET_MS = 800

export interface RegexFlagInfo {
  flag: string
  label: string
  description: string
}

/** Every flag JS RegExp supports, in the order they read best in a checkbox row. `g` is applied
 *  automatically wherever "find every match" is the point (the builder's preview, list filters) —
 *  it's still offered here because turning it off changes `.exec()`/`.test()` statefulness in a
 *  way an advanced user may want to see. */
export const REGEX_FLAGS: RegexFlagInfo[] = [
  { flag: 'g', label: 'Global', description: 'Find every match, not just the first.' },
  { flag: 'i', label: 'Ignore case', description: 'Case-insensitive matching.' },
  { flag: 'm', label: 'Multiline', description: '^ and $ match at line boundaries, not just string ends.' },
  { flag: 's', label: 'Dot-all', description: '. also matches newline characters.' },
  { flag: 'u', label: 'Unicode', description: 'Treats the pattern as a sequence of Unicode code points; enables \\u{…} escapes.' },
  { flag: 'y', label: 'Sticky', description: 'Matches only starting at lastIndex — no scanning ahead.' }
]

export function clampSample(sample: string): { text: string; truncated: boolean } {
  if (sample.length <= MAX_SAMPLE_LENGTH) return { text: sample, truncated: false }
  return { text: sample.slice(0, MAX_SAMPLE_LENGTH), truncated: true }
}

export function clampFilterCandidate(s: string): string {
  return s.length > MAX_FILTER_CANDIDATE_LENGTH ? s.slice(0, MAX_FILTER_CANDIDATE_LENGTH) : s
}

/** Escapes regex metacharacters so a plain-text query can seed a pattern verbatim when the user
 *  flips from text mode into regex mode ("start from what I already typed"). */
export function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
