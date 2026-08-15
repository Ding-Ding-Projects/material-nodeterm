// site/app/features/narrator.js
//
// The "Read it to me" settings card: an opt-in (off by default) text-to-
// speech narrator using whatever voice is already installed on this
// computer. Voice lists from speechSynthesis often arrive late — an empty
// list on first call, filled in behind the `voiceschanged` event a moment
// later — so app/main.js re-reads on that event rather than trusting a
// single snapshot. No audio ever leaves the machine.

import { registerSettingsCard } from '../core/engine.js'
import { VOICE_URI_FIELD } from '../shared/narrator-state.js'

export function registerNarrator(store, deps, registerAction, registerBinding) {
  registerAction('narrator-toggle', (s, id, el, h) => h.save({ narrate: !s.state.narrate }, 'Narrator ' + (!s.state.narrate ? 'on' : 'off')))
  registerBinding('narrator-voice', (s, id, value, h) => h.save({ [VOICE_URI_FIELD]: value }, 'Voice changed'))
  registerBinding('narrator-rate', (s, id, value, h) => h.save({ rate: Number(value) }))
  registerAction('narrator-try', (s, id, el, h) => {
    store.setState({ narrate: true }, { persist: true })
    h.speak('Hello ' + (s.state.nick || 'there') + '. This is the nodeterm playground.')
  })

  registerSettingsCard('narrator', {
    icon: '🔊',
    title: 'Read it to me',
    desc: 'The page can say its messages out loud using a voice already on this computer.',
    note: 'Voice lists often arrive late, so this list refills itself the moment the browser hands one over. No sound ever leaves the machine.',
    controls: (s) => [
      { label: 'Read messages aloud', isToggle: true, action: 'narrator-toggle', on: s.narrate, toggleLabel: s.narrate ? 'On 🔊' : 'Off' },
      {
        label: 'Voice', isSelect: true, action: 'narrator-voice', value: s.voice,
        options: [{ id: '', label: s.voices.length ? 'Whatever the browser picks' : 'No voices found yet…' }].concat(s.voices),
      },
      { label: 'Speed', isRange: true, action: 'narrator-rate', min: 1, max: 5, value: s.rate },
      { label: 'Try it', isButton: true, action: 'narrator-try', toggleLabel: 'Say something' },
    ],
  })
}
