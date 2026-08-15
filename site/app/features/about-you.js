// site/app/features/about-you.js
//
// The "About you" settings card: an optional nickname the page can greet
// you with, and the little-sounds toggle (see app/core/engine.js#blip).
// The nickname never leaves this browser.

import { registerSettingsCard } from '../core/engine.js'

export function registerAboutYou(store, deps, registerAction, registerBinding) {
  registerBinding('about-nick', (s, id, value, h) => h.save({ nick: value.slice(0, 40) }))
  registerAction('about-sound', (s, id, el, h) => h.save({ sound: !s.state.sound }, 'Sounds ' + (!s.state.sound ? 'on' : 'off')))

  registerSettingsCard('you', {
    icon: '🧸',
    title: 'About you',
    desc: 'A nickname the page can use, and whether little sounds are allowed.',
    note: 'Your nickname stays in this browser. Nobody else can read it, not even us.',
    controls: (s) => [
      { label: 'Nickname', isText: true, action: 'about-nick', value: s.nick, placeholder: 'e.g. Captain Socks' },
      { label: 'Little sounds', isToggle: true, action: 'about-sound', on: s.sound, toggleLabel: s.sound ? 'On 🔊' : 'Off 🔇' },
    ],
  })
}
