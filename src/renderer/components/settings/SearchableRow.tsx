import { useContext } from 'react'
import type React from 'react'
import { SettingsForceVisibleContext, useSettingsSearchState } from './context'
import { matchesEntry, type SettingsSearchEntry } from './search'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import { settingsSearchEntryWithVocabulary } from './vocabulary'
import { resolutionIncludes, useSettingsVocabularyResolution, type SettingsVocabularyResolution } from './context'

/** Renders its children only when the current query (plain text or regex — see context.ts)
 *  matches this row's metadata. */
export function SearchableRow({
  title,
  description,
  keywords,
  children,
  resolvedVocabulary
}: SettingsSearchEntry & { children: React.ReactNode; resolvedVocabulary?: SettingsVocabularyResolution }): React.JSX.Element | null {
  const state = useSettingsSearchState()
  const forceVisible = useContext(SettingsForceVisibleContext)
  const vocab = useVocabularyMapper()
  const inheritedVocabularyResolution = useSettingsVocabularyResolution()
  const alreadyApplied = resolutionIncludes(resolvedVocabulary, 'row') || (
    resolutionIncludes(inheritedVocabularyResolution, 'row') &&
    inheritedVocabularyResolution?.searchEntries === 'mapped'
  )
  // Search both the shipped alias and the visible replacement. This keeps existing command
  // palette/teleport queries valid while allowing a user to find the wording they actually see.
  const visible = alreadyApplied ? { title, description, keywords } : settingsSearchEntryWithVocabulary({ title, description, keywords }, vocab)
  if (!forceVisible && !matchesEntry(state, { ...visible, keywords: visible.keywords })) {
    return null
  }
  return <>{children}</>
}
