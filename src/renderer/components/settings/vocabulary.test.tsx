import { describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { usePersonalVocabulary } from '../../state/personalVocabulary'
import { useSchoolMode } from '../../state/schoolMode'
import { SettingsSearchContext, SettingsVocabularyContext } from './context'
import { SearchableRow } from './SearchableRow'
import { settingsSidebarSearchEntry } from './vocabulary'

afterEach(() => {
  cleanup()
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
  useSchoolMode.setState({ enabled: false, hydrated: false, name: 'School mode' })
})

describe('settings sidebar vocabulary corpus', () => {
  const identity = (value: string | undefined): string | undefined => value

  it('keeps the localized visible title and shipped alias without mapping twice', () => {
    const entry = settingsSidebarSearchEntry(
      { id: 'accounts', title: 'Accounts' },
      'School mode',
      (value) => value === 'Accounts' ? 'Konten' : identity(value),
      'Konten',
      true
    )

    expect(entry.title).toBe('Konten')
    expect(entry.keywords).toEqual(['Accounts', 'Konten'])
  })

  it('uses only the renamed School label in the searchable corpus', () => {
    const entry = settingsSidebarSearchEntry(
      { id: 'school-mode', title: 'School mode' },
      'Quiet study',
      (value) => value === 'School mode' ? 'Should not appear' : identity(value),
      'Quiet study',
      true
    )

    expect(entry.title).toBe('Quiet study')
    expect(entry.keywords).toEqual(['Quiet study'])
    expect(entry.keywords).not.toContain('School mode')
  })

  it('maps child-row search metadata when a parent only resolved row copy', () => {
    usePersonalVocabulary.setState({
      entries: { Label: 'Display name' },
      status: 'loaded',
      entryCount: 1,
      loadedAt: Date.now(),
      lastError: null
    })
    useSchoolMode.setState({ enabled: false, hydrated: true })

    render(
      <SettingsSearchContext.Provider value={{ mode: 'text', query: 'Display name', pattern: '', flags: 'i' }}>
        <SettingsVocabularyContext.Provider value={{ source: 'i18n', fields: 'all' }}>
          <SearchableRow title="Label" keywords={[]}>
            <span>visible row</span>
          </SearchableRow>
        </SettingsVocabularyContext.Provider>
      </SettingsSearchContext.Provider>
    )

    expect(screen.getByText('visible row')).toBeTruthy()
  })
})
