import type React from 'react'
import { useSettingsSearchState } from './context'
import { matchesEntry, type SettingsSearchEntry } from './search'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import { settingsSearchEntryWithVocabulary } from './vocabulary'
import { useSettingsVocabularyApplied } from './context'

/** Renders its children only when the current query (plain text or regex — see context.ts)
 *  matches this row's metadata. */
export function SearchableRow({
  title,
  description,
  keywords,
  children,
  vocabularyApplied = false
}: SettingsSearchEntry & { children: React.ReactNode; vocabularyApplied?: boolean }): React.JSX.Element | null {
  const state = useSettingsSearchState()
  const vocab = useVocabularyMapper()
  const inheritedVocabularyApplied = useSettingsVocabularyApplied()
  const alreadyApplied = vocabularyApplied || inheritedVocabularyApplied
  // Search both the shipped alias and the visible replacement. This keeps existing command
  // palette/teleport queries valid while allowing a user to find the wording they actually see.
  const visible = alreadyApplied ? { title, description, keywords } : settingsSearchEntryWithVocabulary({ title, description, keywords }, vocab)
  if (!matchesEntry(state, { ...visible, keywords: visible.keywords })) {
    return null
  }
  return <>{children}</>
}
