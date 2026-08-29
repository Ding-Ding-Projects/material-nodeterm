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

export function getEmojiEnabled(state) {
  return !!state.emoji
}

// The effective language/funny-level: School mode forces plain English at
// the most serious funny level, regardless of the user's own saved choice
// (which stays saved underneath, untouched, and comes straight back the
// moment School mode is turned off).
export function effLang(state) {
  return state.school ? 'en' : state.lang
}
export function effFunnyEn(state) {
  return state.school ? 1 : state.funnyEn
}
export function effFunnyYue(state) {
  return state.school ? 1 : state.funnyYue
}

const EN_TAILS = ['', '', ' Neat, right?', ' Ta-da! 🎉', ' Zoom zoom, wheeeee! 🚀']
const YUE_TAILS = ['', '', ' 幾好呀！', ' 好正呀！🎉', ' 勁到飛起呀！🚀']

function stripEmoji(text) {
  return text.replace(/[^\x00-\x7F]/g, '').trimEnd()
}

// Apply the user's word=newword swaps (comma or newline separated) to a
// piece of friendly UI copy. Only whole-word, case-insensitive matches are
// replaced, and this is only ever called on the friendly sentences — never
// on a command, a file path, or a piece of code.
export function applyReplacements(text, vocabText) {
  const raw = String(vocabText || '').trim()
  if (!raw) return text
  let out = String(text)
  let pairs = raw.split(/[,\n]/)
  try {
    const json = JSON.parse(raw)
    if (json && json.version === 1 && json.entries && !Array.isArray(json.entries)) pairs = Object.entries(json.entries).map(([from, to]) => `${from}=${to}`)
  } catch (_err) { /* legacy text route */ }
  pairs.forEach((pair) => {
    const bits = pair.split('=')
    if (bits.length !== 2) return
    const from = bits[0].trim()
    const to = bits[1].trim()
    if (!from) return
    try {
      out = out.replace(new RegExp('\\b' + from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), to)
    } catch (_err) {
      /* an unbuildable pattern is simply skipped */
    }
  })
  return out
}

// Shape one fact into the current language + funny level + emoji setting.
// `fact` is the canonical English sentence; YUE[fact] supplies its
// Cantonese counterpart when one exists.
export function shapeVoice(state, fact) {
  const lvl = effFunnyEn(state)
  const en = fact + (getEmojiEnabled(state) ? EN_TAILS[lvl - 1] || '' : stripEmoji(EN_TAILS[lvl - 1] || ''))
  const lang = effLang(state)
  if (lang === 'en') return applyReplacements(en, state.vocab)
  const yueFact = YUE[fact] || fact
  const yueLvl = effFunnyYue(state)
  if (lang === 'yue') return applyReplacements(yueFact + (YUE_TAILS[yueLvl - 1] || ''), state.vocab)
  return applyReplacements(en + ' / ' + yueFact, state.vocab)
}

// The title of a room, honouring language mode (but never the funny tail —
// titles stay clean).
export function shapeTitle(state, title) {
  const lang = effLang(state)
  const yue = YUE[title] || title
  const out = lang === 'yue' ? yue : lang === 'bi' ? title + ' / ' + yue : title
  return applyReplacements(out, state.vocab)
}
