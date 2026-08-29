// site/app/features/adhd-modes.js
//
// ADHD modes on the site: the same five independent accommodations the desktop app ships, applied
// to this page's own surfaces. The rule is that every user-facing app AND every user-facing page
// carries them — a documentation site that talks about an accommodation while not offering it is
// the exact gap that rule exists to close.
//
// Independent switches, never a master toggle. Someone may want a quieter page without a timer, or
// want the timer precisely because they are lost in reading. Bundled, most people turn the lot off
// to escape the one part that does not suit them.
//
// All off by default. These are accommodations, not an opinion about how anyone should read, and a
// mode that switches itself on has decided something about the visitor it cannot know.
//
// Nothing here is medical: no diagnosis, no assessment, no advice, no claim of benefit. State is
// this browser's own local storage — nothing is recorded, counted or sent anywhere.

import { registerSettingsCard } from '../core/engine.js'
import { openInputDialog } from '../core/input-dialog.js'

/** Applied to <html> so the page's own stylesheet can respond. Mirrors the app's `data-adhd-*`. */
function applyToDocument(state) {
  const root = document.documentElement
  const on = (k) => state['adhd' + k] === true
  // Removed rather than set to a neutral value: the authored stylesheet's own value should win when
  // nothing is overriding it.
  if (on('Quiet')) root.setAttribute('data-adhd-quiet', 'on')
  else root.removeAttribute('data-adhd-quiet')
  if (on('Focus')) root.setAttribute('data-adhd-focus', 'on')
  else root.removeAttribute('data-adhd-focus')
  if (on('Time')) root.setAttribute('data-adhd-time', 'on')
  else root.removeAttribute('data-adhd-time')
}

/** Coarse on purpose — a second-by-second readout is itself a distraction. */
export function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return mins + ' min'
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return rem === 0 ? hours + ' h' : hours + ' h ' + rem + ' min'
}

export function registerAdhdModes(store, deps, registerAction, registerBinding) {
  const openedAt = Date.now()

  for (const key of ['Focus', 'Quiet', 'Time', 'OneThing']) {
    registerAction('adhd-toggle-' + key, (s, id, el, h) => {
      const field = 'adhd' + key
      const next = !s.state[field]
      h.save({ [field]: next }, 'ADHD modes')
      applyToDocument({ ...s.state, [field]: next })
    })
  }

  registerAction('adhd-one-thing', (s, id, el, h) => {
    openInputDialog(s, {
      id: 'adhd-one-thing',
      kind: 'text',
      maxLength: 200,
      allowEmpty: true,
      title: 'One thing at a time',
      body: 'Write the one next action you want to keep in view. This is your text, so the page keeps it exactly as entered.',
      label: 'What is the one thing right now?',
      submitLabel: 'Keep this in view',
      initialValue: s.state.adhdOneThingText || '',
      onSubmit: (text) => {
        h.save({ adhdOneThingText: text }, 'ADHD modes')
      },
    })
  })

  registerSettingsCard('adhd', {
    icon: '🎯',
    title: 'ADHD modes',
    desc: 'Five things you can switch on independently. They change how this page behaves, nothing else.',
    note:
      'Not a diagnosis, an assessment or advice, and nothing here is recorded or sent anywhere — it lives in this browser only. Focus dims and never hides: everything stays readable and clickable. Low stimulation only ever removes motion, so it never overrides a reduced-motion setting you already chose.',
    controls: (s) => {
      const rows = [
        {
          label: 'Focus — fade everything but the part you are reading',
          isToggle: true,
          action: 'adhd-toggle-Focus',
          on: s.adhdFocus === true,
          toggleLabel: s.adhdFocus ? 'On 🎯' : 'Off'
        },
        {
          label: 'Low stimulation — less motion, quieter colour',
          isToggle: true,
          action: 'adhd-toggle-Quiet',
          on: s.adhdQuiet === true,
          toggleLabel: s.adhdQuiet ? 'On 🌙' : 'Off'
        },
        {
          label: 'Time awareness — how long this page has been open',
          isToggle: true,
          action: 'adhd-toggle-Time',
          on: s.adhdTime === true,
          toggleLabel: s.adhdTime
            ? 'On · ' + formatElapsed(Date.now() - openedAt)
            : 'Off'
        },
        {
          label: 'One thing at a time — keep one next action in view',
          isToggle: true,
          action: 'adhd-toggle-OneThing',
          on: s.adhdOneThing === true,
          toggleLabel: s.adhdOneThing ? 'On 📌' : 'Off'
        }
      ]
      if (s.adhdOneThing) {
        rows.push({
          label: s.adhdOneThingText ? 'Right now: ' + s.adhdOneThingText : 'Right now: (not set)',
          action: 'adhd-one-thing',
          btnLabel: 'Change'
        })
      }
      return rows
    }
  })

  // Apply whatever was already stored, so a reload does not silently drop a mode the visitor chose.
  applyToDocument(store.state)
}
