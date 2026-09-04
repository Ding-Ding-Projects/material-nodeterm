// site/app/features/school-mode.js
//
// School mode: forces plain English at the calmest funny level and hides
// the jokey settings and the dim-sum surprise, optionally gated by a PIN.
// Turning it off never has to restore anything, because it never
// overwrote the user's real settings — see app/shared/school-state.js.

import { registerSettingsCard } from '../core/engine.js'
import { authoredPart, factPart, openInputDialog } from '../core/input-dialog.js'
import { setPin, verifyPin, SHIPPED_NAME } from '../shared/school-state.js'

export function registerSchoolMode(store, deps, registerAction, registerBinding) {
  registerAction('school-toggle', async (s, id, el, h) => {
    const state = s.state
    if (state.school) {
      if (state.schoolPin) {
        openInputDialog(s, {
          id: 'school-mode-unlock',
          kind: 'pin',
          maxLength: 256,
          titleParts: [authoredPart('Turn '), factPart(SHIPPED_NAME), authoredPart(' off')],
          body: 'Enter the PIN that was set when this mode was turned on.',
          label: 'PIN',
          submitLabel: 'Check the PIN',
          onSubmit: async (pin) => {
            const ok = await verifyPin(pin, s.state.schoolPin)
            if (!ok) {
              h.toast('❌', 'Wrong PIN', SHIPPED_NAME + ' stays on.', '', {
                bodyParts: [factPart(SHIPPED_NAME), authoredPart(' stays on.')],
              })
              return
            }
            h.save({ school: false }, SHIPPED_NAME + ' off', {
              titleParts: [factPart(SHIPPED_NAME), authoredPart(' off')],
            })
            h.toast('🎒', SHIPPED_NAME + ' off', 'Your own settings came straight back.', '', {
              titleParts: [factPart(SHIPPED_NAME), authoredPart(' off')],
            })
          },
        })
        return
      }
      h.save({ school: false }, SHIPPED_NAME + ' off', {
        titleParts: [factPart(SHIPPED_NAME), authoredPart(' off')],
      })
      h.toast('🎒', SHIPPED_NAME + ' off', 'Your own settings came straight back.', '', {
        titleParts: [factPart(SHIPPED_NAME), authoredPart(' off')],
      })
    } else {
      openInputDialog(s, {
        id: 'school-mode-pin',
        kind: 'pin',
        maxLength: 256,
        allowEmpty: true,
        titleParts: [authoredPart('Turn '), factPart(SHIPPED_NAME), authoredPart(' on')],
        body: 'Choose a PIN so this mode cannot be switched off again in a hurry, or leave the field empty for no PIN.',
        label: 'New PIN',
        submitLabel: 'Turn it on',
        onSubmit: async (pin) => {
          const hash = await setPin(pin)
          h.save({ school: true, schoolPin: hash }, SHIPPED_NAME + ' on', {
            titleParts: [factPart(SHIPPED_NAME), authoredPart(' on')],
          })
          h.toast('🎒', SHIPPED_NAME + ' on', 'Plain English, no jokes, no surprise dim sum.', '', {
            titleParts: [factPart(SHIPPED_NAME), authoredPart(' on')],
          })
        },
      })
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
