// site/app/shared/narrator-state.js
//
// Narrator (TTS) voice state. Voice lists from speechSynthesis often arrive
// late (an empty array on the first call, filled in behind the
// `voiceschanged` event a moment later) so callers must re-read rather
// than trust a single snapshot — see app/features/narrator.js.

// The field persisted in state/localStorage is the voice's own stable
// voiceURI, never its display name (names are not unique across engines
// and are localized, so persisting a name can silently stop matching any
// installed voice on a different machine or after an OS update).
export const VOICE_URI_FIELD = 'voice'

export function listVoices() {
  try {
    return (window.speechSynthesis.getVoices() || []).map((v) => ({ id: v.voiceURI, label: v.name + ' (' + v.lang + ')' }))
  } catch (_err) {
    return []
  }
}

export function findVoice(voiceUri) {
  try {
    return (window.speechSynthesis.getVoices() || []).find((v) => v.voiceURI === voiceUri) || null
  } catch (_err) {
    return null
  }
}
