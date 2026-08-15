// site/app/features/timers.js
//
// The "Timers" settings card: a single scheduled-settings rule — "at this
// time of day, switch to day or night colours". The timer only runs while
// this page is open (checked once a second by app/main.js's boot loop); it
// is not a background service.

import { registerSettingsCard } from '../core/engine.js'

export function registerTimers(store, deps, registerAction, registerBinding) {
  registerAction('timers-on', (s, id, el, h) => h.save({ schedOn: !s.state.schedOn }, 'Timer ' + (!s.state.schedOn ? 'on' : 'off')))
  registerBinding('timers-time', (s, id, value, h) => h.save({ schedTime: value }, 'Timer set for ' + value))
  registerBinding('timers-target', (s, id, value, h) => h.save({ schedTheme: value }, 'Timer target set to ' + value))

  registerSettingsCard('timers', {
    icon: '⏰',
    title: 'Timers',
    desc: 'Ask the page to change something all by itself at a certain time of day.',
    note: 'The timer only runs while this page is open. It checks once a second and tells you when it fires.',
    controls: (s) => [
      { label: 'Use a timer', isToggle: true, action: 'timers-on', on: s.schedOn, toggleLabel: s.schedOn ? 'On ⏰' : 'Off' },
      { label: 'At this time', isText: true, action: 'timers-time', type: 'time', value: s.schedTime },
      { label: 'Switch to', isSelect: true, action: 'timers-target', value: s.schedTheme, options: [{ id: 'night', label: '🌙 Night colours' }, { id: 'day', label: '☀️ Day colours' }] },
    ],
  })
}
