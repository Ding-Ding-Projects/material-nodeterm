// site/app/shared/i18n.js
//
// Language modes (English / playful Hong Kong-style Cantonese / bilingual),
// two independent funny-level sliders (English, Cantonese — 1 fully
// professional, 5 maximum playfulness), and the "show emoji in dialogs"
// toggle. Every feature module on this site routes its copy through `t()`
// here so the setting visibly does something everywhere, not just on one
// panel.
//
// THE RULE THAT MATTERS: the funny level changes VOICE, never FACTS. Each
// entry in COPY below is one fact string per language. `shapeVoice()` never
// edits that string — it only appends an additional, clearly separate
// sentence after it, so the original fact is always present verbatim as a
// prefix of the rendered text, in EVERY category including errors and
// warnings. There is no exemption list.
//
// School mode (see school-state.js) forces the effective language to
// English and the effective funny levels to 1 (no shaping) while it is on,
// without touching the visitor's stored Cantonese/funny preferences — they
// come back the moment School mode is turned off.

import { readJSON, writeJSON, subscribe } from './storage.js'
import { isEnabled as isSchoolModeEnabled, subscribeSchoolState } from './school-state.js'
import { applyReplacements } from './vocabulary-state.js'

const KEY_MODE = 'lang.mode'
const KEY_FUNNY_EN = 'lang.funnyEn'
const KEY_FUNNY_YUE = 'lang.funnyYue'
const KEY_EMOJI = 'lang.emoji'

export const LANGUAGE_MODES = ['en', 'yue', 'bi']

export function getLanguageMode() {
  const v = readJSON(KEY_MODE, 'en')
  return LANGUAGE_MODES.includes(v) ? v : 'en'
}
export function setLanguageMode(mode) {
  if (!LANGUAGE_MODES.includes(mode)) return
  writeJSON(KEY_MODE, mode)
}

/** The mode actually in effect right now — 'en' whenever School mode is on,
 * regardless of what is stored. */
export function effectiveLanguageMode() {
  return isSchoolModeEnabled() ? 'en' : getLanguageMode()
}

function clampFunny(n) {
  const v = Math.round(Number(n))
  return Number.isFinite(v) ? Math.min(5, Math.max(1, v)) : 1
}

export function getFunnyLevel(lang) {
  const key = lang === 'yue' ? KEY_FUNNY_YUE : KEY_FUNNY_EN
  return clampFunny(readJSON(key, 1))
}
export function setFunnyLevel(lang, level) {
  const key = lang === 'yue' ? KEY_FUNNY_YUE : KEY_FUNNY_EN
  writeJSON(key, clampFunny(level))
}
/** The funny level actually in effect — 1 (no shaping) whenever School mode
 * is on. */
export function effectiveFunnyLevel(lang) {
  return isSchoolModeEnabled() ? 1 : getFunnyLevel(lang)
}

export function getEmojiEnabled() {
  return readJSON(KEY_EMOJI, false) === true
}
export function setEmojiEnabled(next) {
  writeJSON(KEY_EMOJI, Boolean(next))
}

export function subscribeI18n(cb) {
  const unsubs = [
    subscribe(KEY_MODE, cb),
    subscribe(KEY_FUNNY_EN, cb),
    subscribe(KEY_FUNNY_YUE, cb),
    subscribe(KEY_EMOJI, cb),
    subscribeSchoolState(cb),
  ]
  return () => unsubs.forEach((u) => u())
}

// --- The copy dictionary --------------------------------------------------
// One fact per language per id. Keep these short, plain, and complete on
// their own — shapeVoice() only ever appends to them, never rewrites them.
export const COPY = {
  'common.cancel': { en: 'Cancel', yue: '取消' },
  'common.confirm': { en: 'Confirm', yue: '確定' },
  'common.close': { en: 'Close', yue: '關閉' },
  'common.clear': { en: 'Clear', yue: '清除' },
  'common.retry': { en: 'Retry', yue: '再試一次' },
  'common.save': { en: 'Save', yue: '儲存' },
  'common.none': { en: 'None yet.', yue: '暫時未有。' },
  'common.error.generic': {
    en: 'Something went wrong and the action did not complete.',
    yue: '呢個動作出咗問題，做唔到。',
  },

  'lang.section.title': { en: 'Language', yue: '語言' },
  'lang.mode.label': { en: 'Language mode', yue: '語言模式' },
  'lang.mode.en': { en: 'English', yue: '英文' },
  'lang.mode.yue': { en: 'Cantonese (playful, Hong Kong style)', yue: '廣東話（香港式，輕鬆啲）' },
  'lang.mode.bi': { en: 'Bilingual', yue: '雙語' },
  'lang.funny.en.label': { en: 'English funny level', yue: '英文抵死程度' },
  'lang.funny.yue.label': { en: 'Cantonese funny level', yue: '廣東話抵死程度' },
  'lang.funny.help': {
    en: 'Level 1 is fully professional, level 5 is maximum playfulness. This changes how a message is said, never what it says — including errors and warnings.',
    yue: '1 級最正經，5 級最搞笑。呢個掣只係改講嘢嘅語氣，唔會改內容，連錯誤同警告都係咁。',
  },
  'lang.emoji.label': { en: 'Show emoji in dialogs and message boxes', yue: '喺對話框度顯示 emoji' },
  'lang.emoji.help': {
    en: 'When on, dialogs and message boxes carry a relevant emoji. Emoji never appear on buttons, field labels, or accessible names.',
    yue: '開咗嘅話，對話框會有相關嘅 emoji。但係按鈕、欄位標籤同無障礙名稱唔會有 emoji。',
  },

  'school.section.title': { en: 'School mode', yue: '返學模式' },
  'school.toggle.label': { en: 'Turn on School mode', yue: '開啟返學模式' },
  'school.toggle.help': {
    en: 'A user-experience lock, not security: it forces English and hides the Cantonese, bilingual, funny-level, and dim-sum surprise controls until you turn it off.',
    yue: '呢個係用戶體驗鎖，唔係保安功能：開咗會強制英文，同埋隱藏廣東話、雙語、抵死程度同點心驚喜嘅掣，直到你關返為止。',
  },
  'school.on.summary': {
    en: 'School mode is on. Language is forced to English; the Cantonese, bilingual, funny-level, and dim-sum controls are not shown while it is on.',
    yue: '而家開緊返學模式。語言強制英文；開住嘅時候唔會顯示廣東話、雙語、抵死程度同點心驚喜嘅掣。',
  },
  'school.pin.set.label': { en: 'Set an unlock PIN', yue: '設定解鎖 PIN' },
  'school.pin.enter.label': { en: 'Enter your PIN to turn School mode off', yue: '輸入 PIN 嚟關閉返學模式' },
  'school.pin.wrong': {
    en: 'That PIN does not match the one on file.',
    yue: '呢個 PIN 同記錄嘅唔一致。',
  },
  'school.pin.missing': {
    en: 'No PIN has been set yet, so School mode cannot be turned off this way. Use the recovery route below instead.',
    yue: '仲未設定 PIN，所以冇辦法用呢個方法關閉返學模式。請用底下嘅復原方法。',
  },
  'school.recovery.hint': {
    en: 'Forgot the PIN? Clearing this site’s browser storage (site settings → clear data, or your browser’s "clear browsing data" for this site) resets School mode along with every other setting on this page.',
    yue: '唔記得 PIN？清除呢個網站嘅瀏覽器儲存（網站設定 → 清除資料，或者你瀏覽器嘅「清除瀏覽資料」揀呢個網站）就可以重設返學模式，同其他所有設定一齊重設。',
  },
  'school.rename.label': { en: 'Rename this feature', yue: '改呢個功能嘅名' },
  'school.rename.help': {
    en: 'You can rename School mode to anything you like. After a rename, the original name never appears anywhere on this site again, including search — only your chosen name does.',
    yue: '你可以隨便幫返學模式改名。改咗名之後，原本嘅名唔會再喺網站任何地方出現，包括搜尋結果，淨係會見到你揀嘅名。',
  },

  'vocab.section.title': { en: 'Personal vocabulary', yue: '個人詞彙' },
  'vocab.no.file': { en: 'No file loaded yet — every surface shows its original wording.', yue: '仲未載入檔案 —— 所有版面用返原本嘅字眼。' },
  'vocab.loaded': { en: 'Vocabulary file loaded.', yue: '詞彙檔案載入咗喇。' },
  'vocab.invalid': { en: 'That file could not be used.', yue: '呢個檔案用唔到。' },
  'vocab.cleared': { en: 'Vocabulary file cleared. Original wording is back.', yue: '詞彙檔案清除咗，返返去原本嘅字眼。' },
  'vocab.help': {
    en: 'Upload your own local JSON file mapping words to replacements. Nothing is uploaded anywhere — it is validated and applied locally, in this browser only.',
    yue: '上載你自己嘅本地 JSON 檔案，將字眼對應去替換字。乜都唔會上傳去邊度 —— 淨係喺呢個瀏覽器度本地驗證同應用。',
  },

  'dimsum.section.title': { en: 'Dim sum surprise', yue: '點心驚喜' },
  'dimsum.reveal.button': { en: 'Show me another dish', yue: '再嚟一碟' },

  'narrator.section.title': { en: 'Narrator', yue: '讀稿員' },
  'narrator.off': { en: 'Narrator is off.', yue: '讀稿員而家關咗。' },
  'narrator.voice.auto': { en: 'Choose automatically', yue: '自動揀' },
  'narrator.voice.missing': {
    en: 'The chosen voice is not installed on this computer. Falling back to another voice; your choice is kept.',
    yue: '揀咗嘅聲喺呢部電腦度未裝，會轉用其他聲；但你揀嘅選擇會保留住。',
  },
  'narrator.no.voices': {
    en: 'This browser reports no voices for this language.',
    yue: '呢個瀏覽器搵唔到呢種語言嘅聲。',
  },

  'locks.section.title': { en: 'Toy locks', yue: '得意鎖' },
  'locks.disclaimer': {
    en: 'This is just for fun — a small speed bump, not real security. It does not protect, secure, or encrypt anything.',
    yue: '呢個純粹得意下 —— 一個小小嘅阻礙，唔係真正嘅保安。佢唔會保護、保安或者加密任何嘢。',
  },
  'locks.recovery.hint': {
    en: 'Forgot a lock’s password? Clearing this site’s browser storage removes every lock along with every other setting.',
    yue: '唔記得鎖嘅密碼？清除呢個網站嘅瀏覽器儲存就可以移除所有鎖，同其他設定一齊清埋。',
  },
  'locks.locked.label': { en: 'Locked', yue: '鎖住咗' },
  'locks.wrong.password': { en: 'That password does not match.', yue: '呢個密碼唔啱。' },

  'exports.section.title': { en: 'Export your data', yue: '匯出你嘅資料' },
  'exports.help': {
    en: 'Everything below is your own data, stored only in this browser. Export it in whichever format you need.',
    yue: '下面全部都係你自己嘅資料，淨係存喺呢個瀏覽器度。想用邊種格式就揀邊種。',
  },

  'changelog.section.title': { en: 'Changelog', yue: '更新記錄' },
  'changelog.empty': { en: 'No entries match the current filter.', yue: '冇符合目前篩選嘅記錄。' },
}

/**
 * Appends a level-appropriate, clearly separate sentence AFTER the fact.
 * The fact string itself is never modified — it is always the exact prefix
 * of the returned string. This is what "voice, never facts" means in code.
 */
const EN_SUFFIX = {
  1: '',
  2: '',
  3: ' (noted, with a small smile).',
  4: ' No drama — that’s just how it is.',
  5: ' Confetti optional, drama fully included.',
}
const YUE_SUFFIX = {
  1: '',
  2: '',
  3: '（幾好嘅，笑住講。）',
  4: '（唔使驚，小事啫。）',
  5: '（誇張少少，開心到飛起！）',
}

export function shapeVoice(fact, level, lang) {
  const table = lang === 'yue' ? YUE_SUFFIX : EN_SUFFIX
  const suffix = table[clampFunny(level)] || ''
  return fact + suffix
}

/**
 * Renders copy id `id` for the language(s) currently in effect.
 * Returns a plain string for 'en'/'yue' modes, or { en, yue } for 'bi'.
 */
export function t(id) {
  const entry = COPY[id]
  if (!entry) {
    console.warn('[nodeterm-site] missing copy id:', id)
    return id
  }
  const mode = effectiveLanguageMode()
  // Personal-vocabulary replacements apply at exactly this text boundary —
  // after voice shaping (so a replaced word can still be styled by a
  // funny-level suffix), and only to this rendered prose, never to code,
  // URLs, identifiers, or paths, none of which ever pass through t().
  const en = applyReplacements(shapeVoice(entry.en, effectiveFunnyLevel('en'), 'en'))
  const yue = applyReplacements(shapeVoice(entry.yue, effectiveFunnyLevel('yue'), 'yue'))
  if (mode === 'en') return en
  if (mode === 'yue') return yue
  return { en, yue }
}

/** Builds a small DOM node for copy id `id`, honoring bilingual layout
 * (English primary and prominent, Cantonese secondary and compact) without
 * crowding the interface. */
export function tNode(id, tag = 'span') {
  const result = t(id)
  if (typeof result === 'string') {
    const el = document.createElement(tag)
    el.textContent = result
    el.className = 'site-i18n'
    return el
  }
  const wrap = document.createElement(tag)
  wrap.className = 'site-i18n site-i18n--bi'
  const primary = document.createElement('span')
  primary.className = 'site-i18n-primary'
  primary.textContent = result.en
  const secondary = document.createElement('small')
  secondary.className = 'site-i18n-secondary'
  secondary.textContent = result.yue
  wrap.appendChild(primary)
  wrap.appendChild(secondary)
  return wrap
}

/** A relevant, non-semantic emoji for dialog/message-box chrome. Never used
 * on buttons, field labels, or accessible names — callers must not attach
 * this to those. */
const DIALOG_EMOJI = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '❌',
  question: '❓',
  fun: '✨',
}
export function dialogEmoji(kind) {
  if (!getEmojiEnabled()) return ''
  return DIALOG_EMOJI[kind] || DIALOG_EMOJI.info
}
