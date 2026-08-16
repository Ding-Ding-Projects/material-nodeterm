// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { useSettings } from '../state/settings'
import { useSchoolMode } from '../state/schoolMode'
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
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useSettings.setState({ settings: DEFAULT_SETTINGS, base: DEFAULT_SETTINGS, hydrated: false })
  useSchoolMode.setState({ enabled: false, hydrated: false, name: 'School mode' })
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

  it('omits the Language controls while hydration is unknown or mode is ON', () => {
    act(() => root.render(<LanguageSection isActive />))
    expect(host.querySelector('[data-settings-section="language"]')).toBeNull()

    act(() => useSchoolMode.setState({ hydrated: true, enabled: false }))
    expect(host.querySelector('[data-settings-section="language"]')).not.toBeNull()

    act(() => useSchoolMode.setState({ enabled: true }))
    expect(host.querySelector('[data-settings-section="language"]')).toBeNull()
  })
})
