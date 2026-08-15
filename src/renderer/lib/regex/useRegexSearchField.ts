import { useCallback, useMemo, useState } from 'react'
import { escapeForRegex } from './engine'
import { compileForInlineFilter } from './safety'

export type SearchMode = 'text' | 'regex'

/**
 * The minimal surface `<AnchoredRegexBuilder>` needs to bind itself to a search field — a
 * structural subset of `RegexSearchFieldState`, so any hook that manages mode/pattern/flags
 * itself (like `useTerminalSearch`) can hand its own state in without wrapping it.
 */
export interface RegexBuilderBinding {
  mode: SearchMode
  pattern: string
  flags: string
  setMode: (m: SearchMode) => void
  setValue: (v: string) => void
  setFlags: (f: string) => void
}

export interface RegexSearchFieldState {
  mode: SearchMode
  /** The plain-text query — live while `mode === 'text'`. */
  query: string
  /** The regex pattern source — live while `mode === 'regex'`. */
  pattern: string
  flags: string
  /** The value the visible input should show right now (query or pattern, per mode). */
  value: string
  /** True when there's an active query/pattern of any kind (used to gate "no matches" UI, dim
   *  rows, etc). */
  active: boolean
  /** Compile error, only meaningful in regex mode with a non-empty pattern. */
  error: string | null
  setValue: (v: string) => void
  setFlags: (f: string) => void
  setMode: (m: SearchMode) => void
  toggleMode: () => void
  /** Unified matcher: substring test in text mode, regex test in regex mode. An invalid or
   *  catastrophic-looking pattern fails OPEN (matches everything) rather than hiding results
   *  behind a silent parse error — the error is still surfaced via `.error` for the UI to show. */
  test: (candidate: string) => boolean
  reset: () => void
}

const DEFAULT_FLAGS = 'i'

/**
 * Backs every "plain text by default, regex as an explicit opt-in" search field in the app — the
 * find bar, the Explorer filter, the command palette, the settings search, and FilterableMenu.
 * One hook, one behavior contract, so query/pattern/flags/mode can never drift between surfaces.
 */
export function useRegexSearchField(initial?: {
  mode?: SearchMode
  query?: string
  pattern?: string
  flags?: string
}): RegexSearchFieldState {
  const [mode, setModeRaw] = useState<SearchMode>(initial?.mode ?? 'text')
  const [query, setQuery] = useState(initial?.query ?? '')
  const [pattern, setPattern] = useState(initial?.pattern ?? '')
  const [flags, setFlags] = useState(initial?.flags ?? DEFAULT_FLAGS)

  const setMode = useCallback(
    (m: SearchMode) => {
      // Bidirectional seed: switching modes never throws away what you typed. Going text→regex
      // escapes the plain query so it matches the SAME literal text by default; going back keeps
      // the regex source around (still visible next time you flip back to regex).
      if (m === 'regex' && !pattern.trim() && query.trim()) setPattern(escapeForRegex(query))
      if (m === 'text' && !query.trim() && pattern.trim()) setQuery(pattern)
      setModeRaw(m)
    },
    [pattern, query]
  )

  const setValue = useCallback(
    (v: string) => {
      if (mode === 'text') setQuery(v)
      else setPattern(v)
    },
    [mode]
  )

  const toggleMode = useCallback(() => setMode(mode === 'text' ? 'regex' : 'text'), [mode, setMode])

  const compiled = useMemo(() => {
    if (mode !== 'regex' || !pattern.trim()) return { regex: null as RegExp | null, error: null as string | null }
    const regex = compileForInlineFilter(pattern, flags)
    if (regex) return { regex, error: null }
    // Distinguish "doesn't compile" from "compiles but looks catastrophic" for the UI message.
    try {
      // eslint-disable-next-line no-new
      new RegExp(pattern, flags)
      return { regex: null, error: 'This pattern looks likely to run away (nested repetition) — refine it in the Regex Builder.' }
    } catch (e) {
      return { regex: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [mode, pattern, flags])

  const test = useCallback(
    (candidate: string) => {
      if (mode === 'text') {
        const q = query.trim().toLowerCase()
        return q === '' || candidate.toLowerCase().includes(q)
      }
      if (!pattern.trim()) return true
      // Fail open: an invalid or refused pattern matches everything rather than hiding the list —
      // the error is still shown via `.error` so the user knows why filtering isn't narrowing yet.
      if (!compiled.regex) return true
      // A fresh regex per call: `g`-flagged instances carry `lastIndex` state across `.test()`
      // calls, which would make every other call against the same candidate silently return false.
      const re = new RegExp(compiled.regex.source, compiled.regex.flags)
      return re.test(candidate)
    },
    [mode, query, pattern, compiled.regex]
  )

  const reset = useCallback(() => {
    setQuery('')
    setPattern('')
  }, [])

  return {
    mode,
    query,
    pattern,
    flags,
    value: mode === 'text' ? query : pattern,
    active: (mode === 'text' ? query : pattern).trim() !== '',
    error: mode === 'regex' ? compiled.error : null,
    setValue,
    setFlags,
    setMode,
    toggleMode,
    test,
    reset
  }
}
