// site/app/features/language-settings.js
//
// The "Words and jokes" settings card: three language modes (English,
// Cantonese, Both), and two independent funny-level sliders (one per
// language, 1 = fully serious through 10 = maximum playfulness), plus the
// emoji toggle. See app/shared/i18n.js for how these are applied to page
// copy — the facts in a sentence never change with the funny level, only
// the closing tail and, in Cantonese/Both mode, the translation.

import { registerSettingsCard } from '../core/engine.js'
import { DEFAULT_FUNNY_LEVEL, FUNNY_LEVEL_MAX, FUNNY_LEVEL_MIN, LANGUAGE_MODES, normalizeFunnyLevel } from '../shared/i18n.js'

export function registerLanguageFeature(store, deps, registerAction, registerBinding) {
  registerBinding('lang-mode', (s, id, value, h) => h.save({ lang: value }, 'Language set to ' + value))
  registerBinding('lang-funny-en', (s, id, value, h) => h.save({ funnyEn: normalizeFunnyLevel(Number(value)) }, 'English silliness set to ' + value))
  registerBinding('lang-funny-yue', (s, id, value, h) => h.save({ funnyYue: normalizeFunnyLevel(Number(value)) }, 'Cantonese silliness set to ' + value))
  registerAction('lang-emoji', (s, id, el, h) => h.save({ emoji: !s.state.emoji }, 'Emoji turned ' + (!s.state.emoji ? 'on' : 'off')))

  registerSettingsCard('words', {
    icon: '🗣',
    title: 'Words and jokes',
    desc: 'Pick the language and how silly the page is allowed to be from level 1 through 10. New visitors start both languages at 10; the facts never change — only the tone on the end.',
    note: (s) =>
      s.school
        ? 'School mode is on, so the silliness sliders are hidden and everything reads as plain English. Your real choices are untouched underneath.'
        : 'The silly line is always added after the fact, never instead of it. That is true at every level, including error messages. Returning visitors keep valid earlier choices through the versioned migration.',
    controls: (s) => {
      const list = [{ label: 'Language', isSelect: true, action: 'lang-mode', value: s.lang, options: LANGUAGE_MODES }]
      if (!s.school) {
        list.push({ label: 'Silliness (English)', isRange: true, action: 'lang-funny-en', min: FUNNY_LEVEL_MIN, max: FUNNY_LEVEL_MAX, value: normalizeFunnyLevel(s.funnyEn, DEFAULT_FUNNY_LEVEL) })
        list.push({ label: 'Silliness (Cantonese)', isRange: true, action: 'lang-funny-yue', min: FUNNY_LEVEL_MIN, max: FUNNY_LEVEL_MAX, value: normalizeFunnyLevel(s.funnyYue, DEFAULT_FUNNY_LEVEL) })
      }
      list.push({ label: 'Show emoji', isToggle: true, action: 'lang-emoji', on: s.emoji, toggleLabel: s.emoji ? 'Yes 🎉' : 'No' })
      return list
    },
  })
}
