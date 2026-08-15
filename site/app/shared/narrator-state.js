// site/app/shared/narrator-state.js
//
// Persisted narrator settings. The narrator itself (features/narrator.js)
// is OFF by default; enabling it is entirely the visitor's choice. Voice
// selection persists the platform's stable `voiceURI`, never the display
// name — names are not unique across engines and are localized, so a
// profile saved under a name can silently point at the wrong voice on a
// different install. See features/narrator.js for the late-voice-list
// handling this state module does not itself need to know about.

import { readJSON, writeJSON, subscribe } from './storage.js'

const KEY_ENABLED = 'narrator.enabled'
const KEY_LANGUAGE = 'narrator.language' // 'en' | 'yue' | 'both'
const KEY_VOICE_EN = 'narrator.voiceUri.en'
const KEY_VOICE_YUE = 'narrator.voiceUri.yue'
const KEY_RATE = 'narrator.rate'
const KEY_PITCH = 'narrator.pitch'

export function isEnabled() {
  return readJSON(KEY_ENABLED, false) === true
}
export function setEnabled(v) {
  writeJSON(KEY_ENABLED, Boolean(v))
}

export function getLanguage() {
  const v = readJSON(KEY_LANGUAGE, 'en')
  return ['en', 'yue', 'both'].includes(v) ? v : 'en'
}
export function setLanguage(v) {
  if (!['en', 'yue', 'both'].includes(v)) return
  writeJSON(KEY_LANGUAGE, v)
}

/** '' means "Choose automatically" — the shipped default. Never a named
 * voice by default. */
export function getVoiceUri(lang) {
  return readJSON(lang === 'yue' ? KEY_VOICE_YUE : KEY_VOICE_EN, '') || ''
}
export function setVoiceUri(lang, uri) {
  writeJSON(lang === 'yue' ? KEY_VOICE_YUE : KEY_VOICE_EN, uri || '')
}

export function getRate() {
  const v = Number(readJSON(KEY_RATE, 1))
  return Number.isFinite(v) ? Math.min(2, Math.max(0.5, v)) : 1
}
export function setRate(v) {
  writeJSON(KEY_RATE, Math.min(2, Math.max(0.5, Number(v) || 1)))
}

export function getPitch() {
  const v = Number(readJSON(KEY_PITCH, 1))
  return Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : 1
}
export function setPitch(v) {
  writeJSON(KEY_PITCH, Math.min(2, Math.max(0, Number(v) || 1)))
}

export function subscribeNarratorState(cb) {
  const unsubs = [
    subscribe(KEY_ENABLED, cb),
    subscribe(KEY_LANGUAGE, cb),
    subscribe(KEY_VOICE_EN, cb),
    subscribe(KEY_VOICE_YUE, cb),
    subscribe(KEY_RATE, cb),
    subscribe(KEY_PITCH, cb),
  ]
  return () => unsubs.forEach((u) => u())
}
