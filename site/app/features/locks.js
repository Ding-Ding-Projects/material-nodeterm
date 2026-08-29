// site/app/features/locks.js
//
// The "Toy locks" settings card: an overview of every box and door
// currently locked, plus an "unlock everything" bulk action. The lock
// mechanism itself (creating/checking a lock, and the guard every settings
// card and hallway door renders when locked) lives in
// app/shared/locks-state.js and app/shared/lockGate.js and is used
// directly by app/core/engine.js and app/core/render.js — this feature
// module only owns the card that lists and manages them.

import { registerSettingsCard } from '../core/engine.js'

export function registerLocks(store, deps, registerAction, registerBinding) {
  registerAction('locks-clear-all', (s, id, el, h) =>
    h.askConfirm('Take every lock off?', 'All toy locks on every box and every door are removed. Your other settings are untouched.', 'unlock', () => {
      h.save({ locks: {} }, 'All toy locks removed')
      h.toast('🔓', 'All open', 'Every box and door is unlocked.')
    }),
  )

  registerSettingsCard('safety', {
    icon: '🔒',
    title: 'Toy locks',
    desc: 'Put a password on any box on this page. Each lock has its very own password — opening one never opens another.',
    note: 'This is a game, not real safety. Anyone can clear this site’s storage and every lock falls off. Forgot a password? “Start fresh” in the sidebar is the reset.',
    controls: (s) => [
      { label: 'Locked boxes and doors', isText: true, action: 'locks-noop', value: Object.keys(s.locks).map((k) => k.replace('room:', '🚪 ')).join(', ') || 'none yet' },
      { label: 'Take every lock off', isButton: true, action: 'locks-clear-all', toggleLabel: 'Unlock everything' },
    ],
  })
  registerBinding('locks-noop', () => {}) // the "locked boxes" field is read-only, listing state
}
