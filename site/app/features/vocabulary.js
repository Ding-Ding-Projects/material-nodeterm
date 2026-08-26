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

export function registerVocabulary(store, deps, registerAction, registerBinding) {
  registerBinding('vocab-file', (s, id, text, h) => {
    const result = validateVocabularyJson(text)
    if (!result.ok) {
      h.save({ vocabError: result.reason }, 'Vocabulary file rejected')
      h.toast('❌', 'That did not fit', result.reason)
      return
    }
    const savedAt = Date.now()
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ version: 1, entries: result.entries, entryCount: result.entryCount, savedAt }))
    } catch (_err) {
      // The in-memory page state still applies; the status remains honest about this visit.
    }
    h.save({ vocabEntries: result.entries, vocabSavedAt: savedAt, vocabStatus: 'loaded', vocabError: '', vocab: '' }, 'Vocabulary file changed')
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
      ? `${s.vocabError}${s.vocabStatus === 'loaded' ? ' The previous valid file remains active.' : ''}`
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
