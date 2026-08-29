import { describe, it, expect } from 'vitest'
import { matchesQuery } from './search'
import { settingsSearchEntryWithVocabulary, settingsSidebarSearchEntry } from './vocabulary'

describe('matchesQuery', () => {
  it('matches everything when the query is empty or whitespace', () => {
    expect(matchesQuery('', { title: 'Font size' })).toBe(true)
    expect(matchesQuery('   ', { title: 'Font size' })).toBe(true)
  })
  it('matches the title case-insensitively', () => {
    expect(matchesQuery('FONT', { title: 'Font size' })).toBe(true)
  })
  it('matches the description', () => {
    expect(matchesQuery('blink', { title: 'Cursor', description: 'Cursor blink' })).toBe(true)
  })
  it('matches a keyword not present in the title', () => {
    expect(matchesQuery('typeface', { title: 'Font family', keywords: ['typeface'] })).toBe(true)
  })
  it('returns false when nothing matches', () => {
    expect(matchesQuery('zzz', { title: 'Font size', keywords: ['font'] })).toBe(false)
  })

  it('matches a visible replacement while retaining the shipped alias', () => {
    const map = (value: string | undefined) => value?.replace('Font', 'Typeface')
    const entry = settingsSearchEntryWithVocabulary({ title: 'Font', keywords: ['font'] }, map)
    expect(matchesQuery('typeface', entry)).toBe(true)
    expect(matchesQuery('font', entry)).toBe(true)
  })

  it('searches the renamed School mode only by its chosen name', () => {
    const map = (value: string | undefined) => value
    const section = settingsSidebarSearchEntry({ id: 'school-mode', title: 'School mode' }, 'Study mode', map)
    expect(matchesQuery('study mode', section)).toBe(true)
    expect(matchesQuery('school mode', section)).toBe(false)
  })
})
