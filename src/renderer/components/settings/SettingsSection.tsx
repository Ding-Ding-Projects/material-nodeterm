import type React from 'react'
import { useSettingsSearchState } from './context'
import { matchesEntry, type SettingsSearchEntry } from './search'
import { useVocabularyMapper, useVocabularyText } from '../../lib/personalVocabulary/useVocabularyText'
import { settingsSearchEntryWithVocabulary } from './vocabulary'

/** Section shell: header + card body. Renders only when it is the active section
 *  (no query) or when at least one of its searchEntries matches (query present). */
export function SettingsSection({
  id,
  title,
  description,
  isActive,
  searchEntries,
  vocabularyApplied = false,
  children
}: {
  id: string
  title: string
  description?: string
  isActive: boolean
  searchEntries?: SettingsSearchEntry[]
  vocabularyApplied?: boolean
  children: React.ReactNode
}): React.JSX.Element | null {
  // Mode-aware — the same state SearchableRow and the sidebar already match against. This used
  // to be the plain-text `useSettingsSearch()` string run through `matchesQuery`'s literal
  // substring check, so a regex-mode query was tested as if its raw pattern SOURCE were the
  // search text: a section with no searchEntries bypassed the check entirely (`!searchEntries`)
  // and stayed on screen regardless of the query, while a section that DID declare entries almost
  // never matched (the pattern source is not the thing being searched). Two different, both-wrong
  // answers depending on whether a section happened to pass `searchEntries` — never the section's
  // own real rows, which is what SearchableRow was faithfully filtering all along.
  const search = useSettingsSearchState()
  const hasQuery = (search.mode === 'text' ? search.query : search.pattern).trim() !== ''
  // Personal-vocabulary boundary for section chrome (unconditional — search matching below still
  // runs against the ORIGINAL title/searchEntries, so a rename never breaks ⌘K-style lookup).
  const mappedTitle = useVocabularyText(title)
  const vocabTitle = vocabularyApplied ? title : mappedTitle
  const mappedDescription = useVocabularyText(description)
  const vocabDescription = vocabularyApplied ? description : mappedDescription
  const vocab = useVocabularyMapper()
  const visibleEntries = searchEntries?.map((entry) =>
    vocabularyApplied ? entry : settingsSearchEntryWithVocabulary(entry, vocab)
  )
  if (hasQuery) {
    const anyMatch = !visibleEntries || visibleEntries.some((e) => matchesEntry(search, e))
    if (!anyMatch) {
      return null
    }
  } else if (!isActive) {
    return null
  }
  return (
    <section id={id} data-settings-section={id} className="space-y-5">
      <div className="md3-settings-header">
        <h2 className="md3-settings-header__title">{vocabTitle}</h2>
        {vocabDescription ? <p className="md3-settings-header__desc">{vocabDescription}</p> : null}
      </div>
      <div className="md3-settings-card">{children}</div>
    </section>
  )
}
