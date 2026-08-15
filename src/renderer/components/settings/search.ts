import { clampFilterCandidate } from '../../lib/regex/engine'
import { compileForInlineFilter } from '../../lib/regex/safety'
import type { SearchMode } from '../../lib/regex/useRegexSearchField'

export interface SettingsSearchEntry {
  title: string
  description?: string
  keywords?: string[]
}

/** The regex-search state SettingsPage hands down through context — see context.ts. */
export interface SettingsSearchState {
  mode: SearchMode
  /** Plain-text query, live in text mode. */
  query: string
  /** Regex pattern source, live in regex mode. */
  pattern: string
  flags: string
}

function haystack(entry: SettingsSearchEntry): string {
  return [entry.title, entry.description ?? '', ...(entry.keywords ?? [])].join(' ')
}

/** Case-insensitive substring match over the entry's title, description, and keywords.
 *  An empty/whitespace query matches everything. */
export function matchesQuery(query: string, entry: SettingsSearchEntry): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') {
    return true
  }
  return haystack(entry).toLowerCase().includes(q)
}

/**
 * Mode-aware version: plain-text substring in text mode (identical to `matchesQuery`), a regex
 * test against the same title/description/keyword haystack in regex mode. A pattern that fails to
 * compile or looks catastrophically slow fails OPEN — the row stays visible rather than the whole
 * settings page silently going blank while the user is mid-pattern.
 */
export function matchesEntry(state: SettingsSearchState, entry: SettingsSearchEntry): boolean {
  if (state.mode === 'text') return matchesQuery(state.query, entry)
  const pattern = state.pattern.trim()
  if (!pattern) return true
  const re = compileForInlineFilter(pattern, state.flags)
  if (!re) return true
  return new RegExp(re.source, re.flags).test(clampFilterCandidate(haystack(entry)))
}
