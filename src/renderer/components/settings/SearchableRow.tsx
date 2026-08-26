import type React from 'react'
import { useSettingsSearchState } from './context'
import { matchesEntry, type SettingsSearchEntry } from './search'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'

/** Renders its children only when the current query (plain text or regex — see context.ts)
 *  matches this row's metadata. */
export function SearchableRow({
  title,
  description,
  keywords,
  children
}: SettingsSearchEntry & { children: React.ReactNode }): React.JSX.Element | null {
  const state = useSettingsSearchState()
  const vocab = useVocabularyMapper()
  // Search both the shipped alias and the visible replacement. This keeps existing command
  // palette/teleport queries valid while allowing a user to find the wording they actually see.
  const visible = {
    title: vocab(title),
    description: vocab(description),
    keywords: keywords?.flatMap((keyword) => [keyword, vocab(keyword)])
  }
  if (!matchesEntry(state, { ...visible, keywords: visible.keywords })) {
    return null
  }
  return <>{children}</>
}
