// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsSearchContext } from './context'
import { SearchableRow } from './SearchableRow'
import { SettingsSection, sectionVisible } from './SettingsSection'
import type { SettingsSearchEntry } from './search'
import { usePersonalVocabulary } from '../../state/personalVocabulary'
import { useSchoolMode } from '../../state/schoolMode'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ENTRIES: SettingsSearchEntry[] = [{ title: 'Default shell', keywords: ['bash'] }]

describe('sectionVisible', () => {
  it('shows an active section and hides an inactive one when there is no query', () => {
    expect(sectionVisible('', true, ENTRIES)).toBe(true)
    expect(sectionVisible('   ', true, ENTRIES)).toBe(true)
    expect(sectionVisible('', false, ENTRIES)).toBe(false)
  })

  it('ignores forceVisible when there is no query', () => {
    // `matchesQuery` answers true for an EMPTY query, so every caller computing forceVisible from
    // it hands us `true` while the search box is empty. If that forced the pane open, opening
    // settings would render every project's pane at once (and, for SSH projects, read every one).
    expect(sectionVisible('', false, ENTRIES, true)).toBe(false)
  })

  it('shows a section whose entries match the query and hides one whose entries do not', () => {
    expect(sectionVisible('bash', false, ENTRIES)).toBe(true)
    expect(sectionVisible('zzz', true, ENTRIES)).toBe(false)
  })

  it('shows a section with no search entries at all for any query (legacy sections)', () => {
    expect(sectionVisible('zzz', false, undefined)).toBe(true)
  })

  it('shows an otherwise non-matching section when forceVisible is set under a query', () => {
    expect(sectionVisible('zzz', false, ENTRIES, true)).toBe(true)
  })
})

describe('SettingsSection', () => {
  let root: Root
  let host: HTMLElement

  const mount = async (node: React.JSX.Element, query: string): Promise<void> => {
    root = createRoot(host)
    await act(async () => {
      root.render(<SettingsSearchContext.Provider value={{ mode: 'text', query, pattern: '', flags: 'i' }}>{node}</SettingsSearchContext.Provider>)
    })
  }

  const section = (forceVisible?: boolean): React.JSX.Element => (
    <SettingsSection id="demo" title="Demo" isActive={false} searchEntries={ENTRIES} forceVisible={forceVisible}>
      <SearchableRow title="Default shell" keywords={['bash']}>
        <p>shell row</p>
      </SearchableRow>
      <SearchableRow title="Something else" keywords={['other']}>
        <p>other row</p>
      </SearchableRow>
    </SettingsSection>
  )

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    usePersonalVocabulary.setState({ status: 'no-file', entries: {}, entryCount: 0, loadedAt: null, lastError: null })
    useSchoolMode.setState({ enabled: false, hydrated: false })
  })

  it('filters rows to the matching one on an ordinary query', async () => {
    await mount(section(), 'bash')
    expect(host.textContent).toContain('shell row')
    expect(host.textContent).not.toContain('other row')
  })

  it('renders the WHOLE section (rows unfiltered) when forceVisible is set', async () => {
    // forceVisible means "this query named the section itself" — navigation, not filtering, so
    // its rows must not be individually filtered by a query that matches none of them.
    await mount(section(true), 'zzz')
    expect(host.textContent).toContain('shell row')
    expect(host.textContent).toContain('other row')
  })

  it('renders nothing when neither active, matched, nor forced', async () => {
    await mount(section(false), 'zzz')
    expect(host.textContent).toBe('')
  })

  it('renders the mapped section title and description, including their accessible text', async () => {
    usePersonalVocabulary.setState({
      status: 'loaded',
      entries: { 'Original title': 'Mapped title', 'Original description': 'Mapped description' },
      entryCount: 2,
      loadedAt: Date.now(),
      lastError: null
    })
    useSchoolMode.setState({ enabled: false, hydrated: true })

    await mount(
      <SettingsSection
        id="mapped"
        title="Original title"
        description="Original description"
        isActive
      >
        <span>content</span>
      </SettingsSection>,
      ''
    )

    expect(host.querySelector('h2')?.textContent).toBe('Mapped title')
    expect(host.querySelector('p')?.textContent).toBe('Mapped description')
  })

  it('does not map section text a second time when the caller already resolved it', async () => {
    usePersonalVocabulary.setState({
      status: 'loaded',
      entries: { 'Mapped title': 'Double mapped title', 'Mapped description': 'Double mapped description' },
      entryCount: 2,
      loadedAt: Date.now(),
      lastError: null
    })
    useSchoolMode.setState({ enabled: false, hydrated: true })

    await mount(
      <SettingsSection
        id="already-mapped"
        title="Mapped title"
        description="Mapped description"
        isActive
        resolvedVocabulary={{ source: 'localized-vocabulary', fields: 'section' }}
      >
        <span>content</span>
      </SettingsSection>,
      ''
    )

    expect(host.querySelector('h2')?.textContent).toBe('Mapped title')
    expect(host.querySelector('p')?.textContent).toBe('Mapped description')
  })
})
