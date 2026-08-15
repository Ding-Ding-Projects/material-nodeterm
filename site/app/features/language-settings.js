// site/app/features/language-settings.js
//
// Registers the site's language mode (English / playful Hong Kong-style
// Cantonese / bilingual), the two independent funny-level sliders, and the
// "show emoji in dialogs" toggle. Every other feature module routes its own
// copy through shared/i18n.js's t()/tNode(), so this setting visibly
// changes copy across the whole site, not just on this one panel.
//
// While School mode is on, the Cantonese/bilingual/funny-level controls
// behave as if not installed: this module checks school-state on every
// (re)build and renders nothing for them in that case, per the contract in
// school-state.js / school-mode.js. There is no unregister hook in the
// registry contract we were given, so the setting ROW itself may still
// exist with an empty body while School mode is on — see the "known
// limitation" note in docs/site-features.md.

import { h, injectStyleOnce } from '../shared/dom.js'
import { asMountable } from '../shared/mountable.js'
import {
  getLanguageMode,
  setLanguageMode,
  getFunnyLevel,
  setFunnyLevel,
  getEmojiEnabled,
  setEmojiEnabled,
  subscribeI18n,
  t,
} from '../shared/i18n.js'
import { isEnabled as isSchoolModeEnabled } from '../shared/school-state.js'
import { recordHistoryEntry } from '../shared/history-state.js'

injectStyleOnce(
  'site-language-style',
  `
  .site-lang { display: flex; flex-direction: column; gap: 16px; }
  .site-lang__row { display: flex; flex-direction: column; gap: 6px; }
  .site-lang__radios { display: flex; gap: 12px; flex-wrap: wrap; }
  .site-lang__radios label { display: flex; align-items: center; gap: 6px; min-height: var(--touch-target, 44px); }
  .site-lang__slider-row { display: flex; align-items: center; gap: 10px; }
  .site-lang__slider-row input[type="range"] { flex: 1 1 auto; }
  .site-lang__help { font-size: 12px; opacity: 0.75; }
  .site-lang__toggle-row { display: flex; align-items: center; gap: 10px; min-height: var(--touch-target, 44px); }
  .site-i18n--bi { display: flex; flex-direction: column; }
  .site-i18n-secondary { opacity: 0.75; }
  .site-lang__hidden-note { font-size: 12px; opacity: 0.7; font-style: italic; }
  `,
)

function buildPanel() {
  const wrap = h('div', { class: 'site-lang' })

  function rebuild() {
    wrap.textContent = ''
    const schoolOn = isSchoolModeEnabled()

    wrap.appendChild(h('h3', {}, t('lang.section.title')))

    // Emoji toggle is unaffected by School mode — it is an accessibility /
    // dialog-chrome preference, not a Cantonese/funny-level control.
    const emojiBox = h('input', {
      type: 'checkbox',
      id: 'site-lang-emoji',
      checked: getEmojiEnabled(),
      onChange: (e) => setEmojiEnabled(e.target.checked),
    })
    wrap.appendChild(
      h('div', { class: 'site-lang__toggle-row' }, [
        emojiBox,
        h('label', { for: 'site-lang-emoji' }, t('lang.emoji.label')),
      ]),
    )
    wrap.appendChild(h('div', { class: 'site-lang__help' }, t('lang.emoji.help')))

    if (schoolOn) {
      wrap.appendChild(
        h(
          'p',
          { class: 'site-lang__hidden-note' },
          'Cantonese, bilingual, and the funny-level sliders are not shown while School mode is on.',
        ),
      )
      return
    }

    // Language mode.
    const modeRow = h('div', { class: 'site-lang__row' })
    modeRow.appendChild(h('span', {}, t('lang.mode.label')))
    const radios = h('div', { class: 'site-lang__radios' })
    const current = getLanguageMode()
    ;[
      ['en', 'lang.mode.en'],
      ['yue', 'lang.mode.yue'],
      ['bi', 'lang.mode.bi'],
    ].forEach(([value, copyId]) => {
      const id = 'site-lang-mode-' + value
      const radio = h('input', {
        type: 'radio',
        name: 'site-lang-mode',
        id,
        checked: current === value,
        onChange: () => {
          setLanguageMode(value)
          recordHistoryEntry(`Language mode changed to "${value}".`)
        },
      })
      radios.appendChild(h('label', { for: id }, [radio, ' ' + t(copyId)]))
    })
    modeRow.appendChild(radios)
    wrap.appendChild(modeRow)

    // Two independent funny-level sliders.
    ;[
      ['en', 'lang.funny.en.label'],
      ['yue', 'lang.funny.yue.label'],
    ].forEach(([lang, labelId]) => {
      const row = h('div', { class: 'site-lang__row' })
      const valueLabel = h('span', {}, String(getFunnyLevel(lang)))
      const slider = h('input', {
        type: 'range',
        min: '1',
        max: '5',
        step: '1',
        value: String(getFunnyLevel(lang)),
        'aria-label': typeof t(labelId) === 'string' ? t(labelId) : labelId,
        onInput: (e) => {
          setFunnyLevel(lang, e.target.value)
          valueLabel.textContent = e.target.value
        },
      })
      row.appendChild(h('span', {}, t(labelId)))
      row.appendChild(h('div', { class: 'site-lang__slider-row' }, [slider, valueLabel]))
      wrap.appendChild(row)
    })
    wrap.appendChild(h('div', { class: 'site-lang__help' }, t('lang.funny.help')))
  }

  rebuild()
  subscribeI18n(rebuild)
  return wrap
}

export function registerLanguageFeature(api) {
  if (typeof api.registerTab === 'function') {
    api.registerTab({
      id: 'language',
      title: 'Language',
      icon: '🌐',
      group: 'settings',
      render: asMountable(buildPanel),
    })
  }
  if (typeof api.registerSetting === 'function') {
    api.registerSetting({
      id: 'language-mode',
      tabId: 'language',
      title: 'Language mode (English / Cantonese / bilingual)',
      describe: () => 'Choose English, playful Hong Kong-style Cantonese, or both at once.',
      control: asMountable(buildPanel),
    })
    api.registerSetting({
      id: 'funny-levels',
      tabId: 'language',
      title: 'Funny-level sliders (English and Cantonese)',
      describe: () => 'Two independent 1–5 sliders that change voice, never facts.',
      control: asMountable(buildPanel),
    })
    api.registerSetting({
      id: 'emoji-in-dialogs',
      tabId: 'language',
      title: 'Show emoji in dialogs and message boxes',
      describe: () => 'Decorative emoji on dialog chrome only — never on buttons or labels.',
      control: asMountable(buildPanel),
    })
  }
}
