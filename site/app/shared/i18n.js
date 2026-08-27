// site/app/shared/i18n.js
//
// Language modes (English / Cantonese / Both), the two per-language funny
// (silliness) sliders, the emoji toggle, and personal-vocabulary word
// swaps. Facts never change with the funny level or language — only the
// closing "tail" sentence and, in Cantonese/Both mode, the translated copy.

import { YUE } from './data.js'

export const LANGUAGE_MODES = [
  { id: 'en', label: 'English' },
  { id: 'yue', label: '廣東話 Cantonese' },
  { id: 'bi', label: 'Both at once' },
]

export const FUNNY_LEVEL_MIN = 1
export const FUNNY_LEVEL_MAX = 10
export const DEFAULT_FUNNY_LEVEL = 10

export function normalizeFunnyLevel(value, fallback = DEFAULT_FUNNY_LEVEL) {
  return Number.isInteger(value) && value >= FUNNY_LEVEL_MIN && value <= FUNNY_LEVEL_MAX ? value : fallback
}

export function getEmojiEnabled(state) {
  return !!state.emoji
}

export function vocabularyAllowed(state) {
  return state.schoolHydrated !== false && !state.school
}

export function shapeCopy(state, text) {
  const value = String(text)
  return vocabularyAllowed(state) ? applyReplacements(value, state.vocabEntries) : value
}

// The effective language/funny-level: School mode forces plain English at
// the most serious funny level, regardless of the user's own saved choice
// (which stays saved underneath, untouched, and comes straight back the
// moment School mode is turned off).
export function effLang(state) {
  return state.school ? 'en' : state.lang
}
export function effFunnyEn(state) {
  return state.school ? 1 : normalizeFunnyLevel(state.funnyEn)
}
export function effFunnyYue(state) {
  return state.school ? 1 : normalizeFunnyLevel(state.funnyYue)
}

const EN_TAILS = [
  '',
  '',
  ' Neat, right?',
  ' Ta-da! 🎉',
  ' Zoom zoom, wheeeee! 🚀',
  ' A little extra sparkle, with the facts still firmly in charge.',
  ' The copy has found a tasteful confetti button, and nothing factual moved.',
  ' More whimsy has entered the room; the action and its consequences stay exact.',
  ' Maximum playful voice engaged, while every useful detail remains on duty.',
  ' Full comedy overdrive: same facts, same choices, spectacularly sillier delivery.'
]
const YUE_TAILS = [
  '',
  '',
  ' 幾好呀！',
  ' 好正呀！🎉',
  ' 勁到飛起呀！🚀',
  ' 加少少生氣，事實照樣企得穩陣。',
  ' 文字掂咗下靚靚紙碎，重要資料一粒都冇郁。',
  ' 多啲玩味入場，動作同後果仍然原原本本。',
  ' 玩味開到盡，所有有用細節繼續當值。',
  ' 全速搞笑模式：事實一樣，選擇一樣，語氣就放飛喇。'
]

function stripEmoji(text) {
  return text.replace(/[^\x00-\x7F]/g, '').trimEnd()
}

// Apply the validated JSON entries to friendly UI copy. Dynamic facts, commands,
// paths, identifiers, and code never pass through this helper.
export function applyReplacements(text, entries) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return text
  return Object.keys(entries)
    .sort((a, b) => b.length - a.length)
    .reduce((out, from) => out.split(from).join(entries[from]), String(text))
}

// Shape one fact into the current language + funny level + emoji setting.
// `fact` is the canonical English sentence; YUE[fact] supplies its
// Cantonese counterpart when one exists.
export function shapeVoice(state, fact) {
  const lvl = effFunnyEn(state)
  const en = fact + (getEmojiEnabled(state) ? EN_TAILS[lvl - 1] || '' : stripEmoji(EN_TAILS[lvl - 1] || ''))
  const lang = effLang(state)
  if (lang === 'en') return shapeCopy(state, en)
  const yueFact = YUE[fact] || fact
  const yueLvl = effFunnyYue(state)
  if (lang === 'yue') return shapeCopy(state, yueFact + (YUE_TAILS[yueLvl - 1] || ''))
  return shapeCopy(state, en + ' / ' + yueFact)
}

// The title of a room, honouring language mode (but never the funny tail —
// titles stay clean).
export function shapeTitle(state, title) {
  const lang = effLang(state)
  const yue = YUE[title] || title
  const out = lang === 'yue' ? yue : lang === 'bi' ? title + ' / ' + yue : title
  return shapeCopy(state, out)
}
