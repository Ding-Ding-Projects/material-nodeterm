import { describe, expect, it } from 'vitest'
import { settingsSidebarSearchEntry } from './vocabulary'

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
})
