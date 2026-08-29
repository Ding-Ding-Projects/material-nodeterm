// site/app/features/appearance.js
//
// The "How it looks" settings card: day/night theme, a favourite-colour
// swatch picker, four ready-made presets, a custom badge picture (stored
// as a data: URL — capped at 400 KB so it fits comfortably in
// localStorage), bigger text, and export/import/reset of "the look" as a
// small JSON file. Everything here is local-only; nothing is ever
// uploaded anywhere.

import { registerSettingsCard } from '../core/engine.js'
import { authoredPart, factPart, openInputDialog } from '../core/input-dialog.js'
import { SWATCHES, PRESETS } from '../shared/data.js'

export function registerAppearance(store, deps, registerAction, registerBinding) {
  registerBinding('appearance-theme', (s, id, value, h) => {
    h.save({ theme: value }, 'Theme set to ' + value, {
      titleParts: [authoredPart('Theme set to '), factPart(value)],
    })
    h.applyTheme()
  })
  registerBinding('appearance-preset', (s, id, value, h) => {
    const p = PRESETS[value]
    if (!p) return
    h.save({ preset: value, accent: p.accent, theme: p.theme }, 'Look set to ' + p.name, {
      titleParts: [authoredPart('Look set to '), factPart(p.name)],
    })
    h.applyTheme()
  })
  registerAction('appearance-big-text', (s, id, el, h) => {
    h.save({ bigText: !s.state.bigText }, 'Bigger text ' + (!s.state.bigText ? 'on' : 'off'))
    h.applyTheme()
  })
  registerAction('appearance-logo', (s, id, el, h) => pickLogo(store, h))
  registerAction('appearance-export', (s, id, el, h) => exportLook(store, h))
  registerAction('appearance-import', (s, id, el, h) => importLook(store, h))
  registerAction('appearance-reset', (s, id, el, h) => {
    h.save({ theme: 'day', accent: '#ffd93d', bigText: false, logo: '', preset: 'playground' }, 'Look reset')
    h.applyTheme()
    h.toast('🎨', 'Back to normal', 'The look is how it started.')
  })

  registerSettingsCard('look', {
    icon: '🎨',
    title: 'How it looks',
    desc: 'Day or night, your favourite colour, a saved look you can carry to another computer, and your own badge picture.',
    note: 'Colours come from a small chosen set so every one of them still reads clearly on both backgrounds.',
    controls: (s) => [
      { label: 'Time of day', isSelect: true, action: 'appearance-theme', value: s.theme, options: [{ id: 'day', label: '☀️ Day' }, { id: 'night', label: '🌙 Night' }] },
      { label: 'Favourite colour', isColor: true, swatches: SWATCHES.map(([name, hex]) => ({ name, hex, picked: s.accent === hex })) },
      { label: 'Ready-made looks', isSelect: true, action: 'appearance-preset', value: s.preset, options: Object.keys(PRESETS).map((k) => ({ id: k, label: PRESETS[k].name })) },
      { label: 'Bigger text', isToggle: true, action: 'appearance-big-text', on: s.bigText, toggleLabel: s.bigText ? 'On' : 'Off' },
      { label: 'Badge picture', isButton: true, action: 'appearance-logo', toggleLabel: s.logo ? 'Change it' : 'Choose a picture' },
      { label: 'Save or load a look', isButton: true, action: 'appearance-export', toggleLabel: 'Save look' },
      { label: 'Load one you saved', isButton: true, action: 'appearance-import', toggleLabel: 'Load look' },
      { label: 'Put everything back', isButton: true, action: 'appearance-reset', toggleLabel: 'Reset the look' },
    ],
  })
}

function pickLogo(store, h) {
  try {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const f = input.files && input.files[0]
      if (!f) return
      if (f.size > 400000) {
        h.toast('😅', 'That picture is big', 'Pick one under 400 KB so it fits in this browser’s storage.')
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        h.save({ logo: String(reader.result) }, 'Badge picture changed')
        h.toast('🖼', 'New badge!', 'Your own picture is in the corner now.')
      }
      reader.readAsDataURL(f)
    }
    input.click()
  } catch (_err) {
    h.toast('😕', 'Could not open the picker', 'Your browser blocked it.')
  }
}
function exportLook(store, h) {
  const s = store.state
  const blob = { theme: s.theme, accent: s.accent, preset: s.preset, bigText: s.bigText, logo: s.logo ? '(a picture you chose)' : '' }
  h.download('nodeterm-look.json', JSON.stringify(blob, null, 2))
}
function importLook(store, h) {
  openInputDialog(store, {
    id: 'appearance-import',
    kind: 'json',
    maxLength: 65536,
    title: 'Load a saved look',
    body: 'Paste the JSON from a look file you saved earlier. It stays in this field only while the dialog is open.',
    label: 'Look JSON',
    submitLabel: 'Load this look',
    placeholder: '{"theme":"day"}',
    onSubmit: (txt) => {
      try {
        const v = JSON.parse(txt)
        const theme = v.theme === 'night' ? 'night' : 'day'
        h.save({ theme, accent: typeof v.accent === 'string' ? v.accent : store.state.accent, bigText: !!v.bigText }, 'Imported a look')
        h.applyTheme()
        h.toast('🎨', 'Look loaded', 'Your saved colours are back.')
      } catch (_err) {
        h.toast('❌', 'That file did not parse', 'Nothing was changed. Your old look is still here.')
      }
    },
  })
}
