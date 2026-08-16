// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { useSchoolMode } from '../../../state/schoolMode'
import { useSettings } from '../../../state/settings'
import { NarratorSection } from './NarratorSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class FakeUtterance {
  voice: SpeechSynthesisVoice | null = null
  lang = ''
  rate = 1
  pitch = 1
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly text: string) {}
}

const VOICES: SpeechSynthesisVoice[] = [
  { voiceURI: 'en', name: 'English', lang: 'en-US', default: true, localService: true },
  { voiceURI: 'yue', name: 'Cantonese', lang: 'zh-HK', default: false, localService: true }
]

let host: HTMLElement
let root: Root
let speak: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  speak = vi.fn()
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      speaking: false,
      pending: false,
      getVoices: () => VOICES,
      speak,
      cancel: vi.fn(),
      addEventListener: vi.fn()
    }
  })
  const settings = { ...DEFAULT_SETTINGS, narratorEnabled: false }
  useSettings.setState({ settings, base: settings, hydrated: true })
  useSchoolMode.setState({ enabled: false, hydrated: true, name: 'School mode' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  useSettings.setState({ settings: DEFAULT_SETTINGS, base: DEFAULT_SETTINGS, hydrated: false })
})

describe('Narrator OFF control boundary', () => {
  it('makes every descendant natively disabled/inert and refuses Preview speech', () => {
    act(() => root.render(<NarratorSection isActive />))
    const controls = host.querySelector<HTMLFieldSetElement>('[data-narrator-controls]')
    expect(controls).toBeTruthy()
    expect(controls!.disabled).toBe(true)
    expect(controls!.hasAttribute('inert')).toBe(true)

    const descendants = [...controls!.querySelectorAll<HTMLElement>('button, select, input')]
    expect(descendants.length).toBeGreaterThan(4)
    expect(descendants.every((element) => element.matches(':disabled'))).toBe(true)

    const preview = descendants.find((element) => element.textContent === 'Preview') as HTMLButtonElement
    expect(preview).toBeTruthy()
    act(() => preview.click())
    expect(speak).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(preview)

    // The one control outside the inert subtree remains reachable so the user can turn narration
    // back on; the guard must not disable its own escape hatch.
    expect(host.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(false)
  })
})
