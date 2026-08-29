// site/app/features/school-mode.js
//
// School mode: forces plain English at the calmest funny level and hides
// the jokey settings and the dim-sum surprise, optionally gated by a PIN.
// Turning it off never has to restore anything, because it never
// overwrote the user's real settings — see app/shared/school-state.js.

import { registerSettingsCard } from '../core/engine.js'
import { setPin, verifyPin, SHIPPED_NAME } from '../shared/school-state.js'

export function registerSchoolMode(store, deps, registerAction, registerBinding) {
  registerAction('school-toggle', async (s, id, el, h) => {
    const state = s.state
    if (state.school) {
      if (state.schoolPin) {
        h.askInput(
          { title: 'Turn school mode off', message: 'Type the PIN to turn ' + SHIPPED_NAME + ' off.', type: 'password' },
          async (pin) => {
            const ok = await verifyPin(pin, state.schoolPin)
            if (!ok) {
              h.toast('❌', 'Wrong PIN', SHIPPED_NAME + ' stays on.')
              return
            }
            h.save({ school: false }, SHIPPED_NAME + ' off')
            h.toast('🎒', SHIPPED_NAME + ' off', 'Your own settings came straight back.')
          },
        )
        return
      }
      h.save({ school: false }, SHIPPED_NAME + ' off')
      h.toast('🎒', SHIPPED_NAME + ' off', 'Your own settings came straight back.')
    } else {
      h.askInput(
        { title: 'Turn school mode on', message: 'Pick a PIN so it cannot be switched off again in a hurry. Leave it blank for no PIN.', type: 'password', allowEmpty: true },
        async (pin) => {
          const hash = await setPin(pin)
          h.save({ school: true, schoolPin: hash }, SHIPPED_NAME + ' on')
          h.toast('🎒', SHIPPED_NAME + ' on', 'Plain English, no jokes, no surprise dim sum.')
        },
      )
    }
  })

  registerSettingsCard('school', {
    icon: '🎒',
    title: SHIPPED_NAME,
    desc: 'Turns everything into plain English at silliness one, and hides the jokey settings. A PIN keeps it that way.',
    note: 'Turning it off never has to restore anything, because nothing was overwritten — your real settings sat safely underneath the whole time.',
    controls: (s) => [{ label: SHIPPED_NAME, isToggle: true, action: 'school-toggle', on: s.school, toggleLabel: s.school ? 'On 🎒' : 'Off' }],
  })
}
