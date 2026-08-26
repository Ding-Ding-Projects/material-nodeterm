// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { useSettings } from '../state/settings'
import { useSchoolMode } from '../state/schoolMode'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { LanguageSection } from '../components/settings/sections/LanguageSection'
import { useI18n } from './i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root

function I18nHarness(): React.JSX.Element {
  const i18n = useI18n()
  const text = i18n.t('settings.section.language', 'Language')
  return (
    <pre data-i18n-state="">
      {JSON.stringify({
        mode: i18n.mode,
        funnyLevelEn: i18n.funnyLevelEn,
        funnyLevelYue: i18n.funnyLevelYue,
        primary: text.primary,
        secondary: text.secondary
      })}
    </pre>
  )
}

function state(): Record<string, unknown> {
  return JSON.parse(host.querySelector('[data-i18n-state]')?.textContent ?? '{}') as Record<
    string,
    unknown
  >
}

beforeEach(() => {
  ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
    settings: { save: vi.fn(async () => undefined) }
  }
  const configured = {
    ...DEFAULT_SETTINGS,
    languageMode: 'bilingual' as const,
    funnyLevelEn: 5 as const,
    funnyLevelYue: 4 as const
  }
  useSettings.setState({ settings: configured, base: configured, hydrated: true })
  useSchoolMode.setState({ enabled: false, hydrated: false, name: 'School mode' })
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useSettings.setState({ settings: DEFAULT_SETTINGS, base: DEFAULT_SETTINGS, hydrated: false })
  useSchoolMode.setState({ enabled: false, hydrated: false, name: 'School mode' })
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
})

describe('School mode at the renderer localization boundary', () => {
  it('suppresses bilingual copy and playfulness until OFF is known, restores preferences live, then suppresses ON', () => {
    act(() => root.render(<I18nHarness />))
    expect(state()).toEqual({
      mode: 'en',
      funnyLevelEn: 1,
      funnyLevelYue: 1,
      primary: 'Language',
      secondary: null
    })

    act(() => useSchoolMode.setState({ hydrated: true, enabled: false }))
    expect(state()).toEqual({
      mode: 'bilingual',
      funnyLevelEn: 5,
      funnyLevelYue: 4,
      primary: 'Language',
      secondary: '語言'
    })

    act(() => useSchoolMode.setState({ enabled: true }))
    expect(state()).toEqual({
      mode: 'en',
      funnyLevelEn: 1,
      funnyLevelYue: 1,
      primary: 'Language',
      secondary: null
    })
  })

  it('maps localized prose before dynamic facts and restores the original copy when School mode is on', () => {
    usePersonalVocabulary.setState({
      entries: { Language: 'Control Room', Hello: 'Howdy', Alice: 'Not-Alice' },
      status: 'loaded',
      entryCount: 3,
      loadedAt: Date.now(),
      lastError: null
    })
    act(() => useSchoolMode.setState({ hydrated: true, enabled: false }))
    act(() => root.render(<I18nHarness />))
    expect(state().primary).toBe('Control Room')

    function ParamHarness(): React.JSX.Element {
      const { ts } = useI18n()
      return <span data-param-copy>{ts('test.dynamic', 'Hello {name}', { name: 'Alice' })}</span>
    }
    act(() => root.render(<ParamHarness />))
    expect(host.querySelector('[data-param-copy]')?.textContent).toBe('Howdy Alice')

    act(() => useSchoolMode.setState({ enabled: true }))
    expect(host.querySelector('[data-param-copy]')?.textContent).toBe('Hello Alice')
  })

  it('keeps exact parameter interpolation while School mode suppresses vocabulary', () => {
    usePersonalVocabulary.setState({
      entries: { Hello: 'Howdy', Alice: 'Do-not-rewrite' },
      status: 'loaded',
      entryCount: 2,
      loadedAt: Date.now(),
      lastError: null
    })
    useSchoolMode.setState({ enabled: true, hydrated: true })
    function SchoolHarness(): React.JSX.Element {
      const { t } = useI18n()
      return <span data-school-copy>{t('test.dynamic', 'Hello {person}', { person: 'Alice' }).primary}</span>
    }
    act(() => root.render(<SchoolHarness />))
    expect(host.querySelector('[data-school-copy]')?.textContent).toBe('Hello Alice')
  })

  it('omits the Language controls while hydration is unknown or mode is ON', () => {
    act(() => root.render(<LanguageSection isActive />))
    expect(host.querySelector('[data-settings-section="language"]')).toBeNull()

    act(() => useSchoolMode.setState({ hydrated: true, enabled: false }))
    expect(host.querySelector('[data-settings-section="language"]')).not.toBeNull()

    act(() => useSchoolMode.setState({ enabled: true }))
    expect(host.querySelector('[data-settings-section="language"]')).toBeNull()
  })
})
