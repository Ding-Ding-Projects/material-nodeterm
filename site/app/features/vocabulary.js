// site/app/features/vocabulary.js
//
// The landing-page personal-vocabulary surface uses the same local JSON contract as the desktop
// renderer. The page keeps its existing visual style, while the data path is strict and file-based.

import { registerSettingsCard } from '../core/engine.js'
import {
  validateVocabularyJson,
  VOCAB_MAX_ENTRIES,
  VOCAB_MAX_FILE_BYTES,
  VOCAB_MAX_KEY_LENGTH,
  VOCAB_MAX_VALUE_LENGTH
} from '../shared/vocabulary-state.js'

const CACHE_KEY = 'nodeterm-playground.vocabulary.v1'

export function readVocabularyFile(file) {
  return file.text()
}

export function handleVocabularyFileChange(input, handlers) {
  const file = input.files && input.files[0]
  if (!file) return Promise.resolve('empty')
  if (file.size > VOCAB_MAX_FILE_BYTES) {
    handlers.onTooLarge(file.size)
    input.value = ''
    return Promise.resolve('too-large')
  }
  return readVocabularyFile(file).then(
    (text) => {
      handlers.onText(text)
      input.value = ''
      return 'loaded'
    },
    () => {
      handlers.onReadError()
      input.value = ''
      return 'read-error'
    },
  )
}

export function registerVocabulary(store, deps, registerAction, registerBinding) {
  registerBinding('vocab-file', (s, id, text, h) => {
    const result = validateVocabularyJson(text)
    if (!result.ok) {
      h.save({ vocabError: result.reason }, 'Vocabulary file rejected')
      h.toast('❌', 'That did not fit', result.reason)
      return
    }
    const savedAt = Date.now()
    let persistenceError = ''
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ version: 1, entries: result.entries, entryCount: result.entryCount, savedAt }))
    } catch (_err) {
      // The in-memory page state still applies, but persistence failure must be visible so a
      // reload cannot be mistaken for a successful durable save.
      persistenceError = 'Vocabulary loaded for this visit, but browser storage could not save it.'
    }
    h.save({ vocabEntries: result.entries, vocabSavedAt: savedAt, vocabStatus: 'loaded', vocabError: persistenceError, vocab: '' }, 'Vocabulary file changed')
  })
  registerBinding('vocab-json', (s, id, value, h) => {
    const result = validateVocabularyJson(value)
    if (!result.ok) {
      h.toast('❌', 'That file did not fit', result.reason)
      return
    }
    h.save({ vocab: JSON.stringify({ version: 1, entries: Object.fromEntries(result.entries) }) }, 'Vocabulary file loaded')
    h.toast('📖', 'Loaded', `${result.entries.length} local swaps are active.`)
  })
  registerAction('vocab-clear', (s, id, el, h) => {
    try { localStorage.removeItem(CACHE_KEY) } catch (_err) {}
    h.save({ vocabEntries: Object.create(null), vocabSavedAt: 0, vocabStatus: 'no-file', vocabError: '', vocab: '' }, 'Vocabulary file cleared')
    h.toast('📖', 'Cleared', 'Everything reads normally again.')
  })

  registerSettingsCard('vocab', {
    icon: '📖',
    title: 'My own words',
    desc: 'Choose a local JSON file with the same versioned word pairs used by the desktop app.',
    note: (s) => s.vocabError
      ? `${s.vocabError}${s.vocabStatus === 'loaded' ? ' The currently loaded file remains active for this visit.' : ''}`
      : s.vocabStatus === 'loaded'
        ? `${Object.keys(s.vocabEntries || {}).length} usable pair(s) loaded locally. Nothing leaves this browser.`
        : 'No file loaded. Original wording is shown everywhere.',
    controls: (s) => [
      {
        label: 'Vocabulary JSON file',
        isFile: true,
        action: 'vocab-file',
        accept: 'application/json,.json',
        status: s.vocabError
          ? `${s.vocabStatus === 'loaded' ? 'Previous file active, ' : ''}new file rejected`
          : s.vocabStatus === 'loaded' ? `${Object.keys(s.vocabEntries || {}).length} pairs loaded` : 'No file selected'
      },
      { label: 'Clear file', isButton: true, action: 'vocab-clear', toggleLabel: 'Remove local vocabulary' }
    ],
  })
}

export { CACHE_KEY, VOCAB_MAX_ENTRIES, VOCAB_MAX_FILE_BYTES, VOCAB_MAX_KEY_LENGTH, VOCAB_MAX_VALUE_LENGTH }
