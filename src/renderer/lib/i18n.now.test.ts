// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { CATALOG } from '@shared/i18n'
import { useSettings } from '../state/settings'
import { useSchoolMode } from '../state/schoolMode'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { localizedTextNow } from './i18n'
import { LOCAL_LINK_MESSAGE } from './markdownLinks'

const ID = 'markdownLinks.localLink'

function configure(patch: Partial<typeof DEFAULT_SETTINGS>): void {
  const settings = { ...DEFAULT_SETTINGS, ...patch }
  useSettings.setState({ settings, base: settings, hydrated: true })
}

beforeEach(() => {
  configure({ languageMode: 'yue', funnyLevelEn: 5, funnyLevelYue: 5 })
  useSchoolMode.setState({ enabled: false, hydrated: false, name: 'School mode' })
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
})

afterEach(() => {
  useSettings.setState({ settings: DEFAULT_SETTINGS, base: DEFAULT_SETTINGS, hydrated: false })
  useSchoolMode.setState({ enabled: false, hydrated: false, name: 'School mode' })
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
})

describe('localizedTextNow (copy resolved outside React)', () => {
  it('has a catalogue row whose plain English level is the guard fallback text', () => {
    expect(CATALOG[ID]?.en[0]).toBe(LOCAL_LINK_MESSAGE)
  })

  it('fails closed to plain English while School mode is not yet known', () => {
    expect(localizedTextNow(ID, LOCAL_LINK_MESSAGE)).toBe(LOCAL_LINK_MESSAGE)
  })

  it('reads the live language and level at call time', () => {
    useSchoolMode.setState({ enabled: false, hydrated: true })
    expect(localizedTextNow(ID, LOCAL_LINK_MESSAGE)).toBe(CATALOG[ID].yue[4])
    configure({ languageMode: 'bilingual', funnyLevelEn: 1, funnyLevelYue: 1 })
    expect(localizedTextNow(ID, LOCAL_LINK_MESSAGE)).toBe(`${CATALOG[ID].en[0]} · ${CATALOG[ID].yue[0]}`)
  })

  it('applies the personal vocabulary only when School mode is confirmed off', () => {
    configure({ languageMode: 'en', funnyLevelEn: 1 })
    usePersonalVocabulary.setState({ entries: { markdown: 'notes' } })
    useSchoolMode.setState({ enabled: false, hydrated: true })
    expect(localizedTextNow(ID, LOCAL_LINK_MESSAGE)).toBe("Local file links can't be opened from rendered notes.")
    useSchoolMode.setState({ enabled: true, hydrated: true })
    expect(localizedTextNow(ID, LOCAL_LINK_MESSAGE)).toBe(LOCAL_LINK_MESSAGE)
  })

  it('keeps dynamic facts exact after the vocabulary is applied', () => {
    configure({ languageMode: 'en', funnyLevelEn: 1 })
    usePersonalVocabulary.setState({ entries: { Hello: 'Howdy', Alice: 'Not-Alice' } })
    useSchoolMode.setState({ enabled: false, hydrated: true })
    expect(localizedTextNow('no.such.row', 'Hello {name}', { name: 'Alice' })).toBe('Howdy Alice')
  })
})
