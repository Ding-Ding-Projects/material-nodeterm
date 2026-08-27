import type React from 'react'
import { SettingsVocabularyContext, resolutionIncludes, useSettingsSearchState, type SettingsVocabularyResolution } from './context'
import { matchesEntry, type SettingsSearchEntry } from './search'
import { useVocabularyMapper, useVocabularyText } from '../../lib/personalVocabulary/useVocabularyText'
import { settingsSearchEntryWithVocabulary } from './vocabulary'
import { SettingsSearchContext, useSettingsSearch } from './context'
import { matchesQuery, type SettingsSearchEntry } from './search'

/**
 * THE section-visibility predicate. Every gate in the settings dialog calls this one function:
 * `SettingsSection` itself, and `ProjectSettingsSection`'s outer gate (which must decide the same
 * thing one level earlier, so an invisible pane never mounts its settings-reading hook — an SSH
 * read is a network round-trip). Two hand-written copies of this rule drifting apart shows up as a
 * nav row pointing at a blank pane, so they share the implementation instead.
 *
 * `forceVisible` is honored ONLY under a non-empty query: callers compute it with `matchesQuery`,
 * which answers `true` for an empty query, so treating it as authoritative while the search box is
 * empty would render (and read) every project's pane the moment settings opens.
 */
export function sectionVisible(
  query: string,
  isActive: boolean,
  searchEntries: SettingsSearchEntry[] | undefined,
  forceVisible?: boolean
): boolean {
  if (query.trim() === '') return isActive
  if (forceVisible) return true
  return !searchEntries || searchEntries.some((e) => matchesQuery(query, e))
}

/** Section shell: header + card body. Renders only when it is the active section
 *  (no query) or when at least one of its searchEntries matches (query present). */
export function SettingsSection({
  id,
  title,
  description,
  isActive,
  searchEntries,
  resolvedVocabulary,
  forceVisible,
  children
}: {
  id: string
  title: string
  description?: string
  isActive: boolean
  searchEntries?: SettingsSearchEntry[]
  resolvedVocabulary?: SettingsVocabularyResolution
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
  // Personal-vocabulary boundary for section chrome (unconditional). Search matching below keeps
  // the shipped aliases beside visible replacements, so a rename never breaks existing lookup.
  const mappedTitle = useVocabularyText(title)
  const sectionAlreadyApplied = resolutionIncludes(resolvedVocabulary, 'section')
  const searchEntriesAlreadyApplied = resolvedVocabulary?.searchEntries === 'mapped'
  const vocabTitle = sectionAlreadyApplied ? title : mappedTitle
  const mappedDescription = useVocabularyText(description)
  const vocabDescription = sectionAlreadyApplied ? description : mappedDescription
  const vocab = useVocabularyMapper()
  const visibleEntries = searchEntries?.map((entry) =>
    searchEntriesAlreadyApplied ? entry : settingsSearchEntryWithVocabulary(entry, vocab)
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
    <SettingsVocabularyContext.Provider value={resolvedVocabulary ?? null}>
      <section id={id} data-settings-section={id} className="space-y-5">
      <div className="md3-settings-header">
        <h2 className="md3-settings-header__title">{vocabTitle}</h2>
        {vocabDescription ? <p className="md3-settings-header__desc">{vocabDescription}</p> : null}
  /** "This query named the SECTION, not a field in it" — set by a project pane when the query
   *  matches the project's own name. The section then renders whole: its rows are shown
   *  unfiltered (see the cleared search context below), because naming a section is navigation,
   *  not filtering, and a name query matches none of the individual rows. */
  forceVisible?: boolean
  children: React.ReactNode
}): React.JSX.Element | null {
  const query = useSettingsSearch()
  if (!sectionVisible(query, isActive, searchEntries, forceVisible)) return null
  // Children see an EMPTY query when this section was forced open, so every `SearchableRow` (and
  // every other query-reading descendant) renders. Identical to `query` otherwise.
  const childQuery = forceVisible ? '' : query
  return (
    <section id={id} data-settings-section={id} className="space-y-6">
      <div className="border-b border-border pb-5">
        <h2 className="text-[28px] font-bold leading-tight tracking-tight text-text">{title}</h2>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      <div className="divide-y divide-border/60 rounded-2xl border border-border bg-white/[0.02] px-6 shadow-sm [&>*]:py-5">
        <SettingsSearchContext.Provider value={childQuery}>{children}</SettingsSearchContext.Provider>
      </div>
      <div className="md3-settings-card">{children}</div>
      </section>
    </SettingsVocabularyContext.Provider>
  )
}
