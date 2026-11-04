import { narrate, stopNarrator, isSynthesisAvailable } from './narrator'
import { decideCanvasNarration } from '../canvas/narration-policy'
import { schoolModeAllowsOptionalFeatures } from './schoolModePolicy'
import { useSettings } from '../state/settings'
import { useSchoolMode } from '../state/schoolMode'

/** The most text one Read aloud press speaks. Longer text is cut at a sentence or word end. */
export const READ_ALOUD_MAX = 4000

/** Han characters, which an English voice would read as nothing or as letter names. */
const HAN = /\p{Script=Han}/u

/**
 * What to read: the user's text selection when there is one, otherwise the text of the element
 * that had focus. Never the value of a password field, and never more than READ_ALOUD_MAX.
 */
export function pickReadAloudText(selection: string, focused: Element | null): string {
  const chosen = selection.trim() ? selection : focusedText(focused)
  const text = chosen.replace(/\s+/g, ' ').trim()
  if (text.length <= READ_ALOUD_MAX) return text
  const cut = text.slice(0, READ_ALOUD_MAX)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('。'), cut.lastIndexOf(' '))
  return (end > READ_ALOUD_MAX / 2 ? cut.slice(0, end + 1) : cut).trim()
}

function focusedText(el: Element | null): string {
  if (!el || el === document.body) return ''
  if (el instanceof HTMLInputElement) return el.type === 'password' ? '' : el.value
  if (el instanceof HTMLTextAreaElement) return el.value
  const label = el.getAttribute('aria-label')
  const text = (el as HTMLElement).innerText ?? el.textContent ?? ''
  return text.trim() ? text : (label ?? '')
}

/** Which narrator track fits the text: Cantonese for text with Han characters when Cantonese is
 *  allowed, English otherwise. School mode keeps it English, the same rule as every narration. */
export function readAloudTrack(text: string, cantoneseAllowed: boolean): 'en' | 'yue' {
  return cantoneseAllowed && HAN.test(text) ? 'yue' : 'en'
}

export function canReadAloud(): boolean {
  return isSynthesisAvailable()
}

/**
 * Speak `text` now through the app narrator. This is an explicit request, so it runs whether or
 * not narration of app events is switched on, uses the narrator's chosen voices, rate and pitch,
 * and replaces anything still being read aloud.
 */
export function readAloud(text: string): boolean {
  if (!text || !isSynthesisAvailable()) return false
  const settings = useSettings.getState().settings
  const decision = decideCanvasNarration(settings, useSchoolMode.getState())
  const track = readAloudTrack(text, decision.cantoneseAllowed)
  stopNarrator()
  narrate({
    category: 'read-aloud',
    language: track,
    en: text,
    yue: track === 'yue' ? text : undefined,
    rate: settings.narratorRate,
    pitch: settings.narratorPitch,
    voiceEn: settings.narratorVoiceEn,
    voiceYue: decision.voiceYue,
    canSpeakTrack: (t) => (t === 'en' ? true : schoolModeAllowsOptionalFeatures(useSchoolMode.getState())),
    important: true
  })
  return true
}

export function stopReadingAloud(): void {
  stopNarrator()
}
