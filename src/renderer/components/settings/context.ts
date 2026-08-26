import { createContext, useContext } from 'react'
import type { SettingsSearchState } from './search'

const DEFAULT_STATE: SettingsSearchState = { mode: 'text', query: '', pattern: '', flags: 'i' }

/** Current settings search state, provided by SettingsPage to all descendant rows. */
export const SettingsSearchContext = createContext<SettingsSearchState>(DEFAULT_STATE)
export const SettingsVocabularyContext = createContext(false)

/** Back-compat convenience: the plain-text query (what most callers actually want — "is there an
 *  active search, and what's its text"). Reflects the pattern source while in regex mode too, so
 *  a caller like GitHubIssuesSection's `searching = searchQuery.trim() !== ''` still means the
 *  right thing in either mode. */
export function useSettingsSearch(): string {
  const s = useContext(SettingsSearchContext)
  return s.mode === 'text' ? s.query : s.pattern
}

/** The full mode-aware search state — for SearchableRow and the sidebar's own dimming. */
export function useSettingsSearchState(): SettingsSearchState {
  return useContext(SettingsSearchContext)
}

export function useSettingsVocabularyApplied(): boolean {
  return useContext(SettingsVocabularyContext)
}
