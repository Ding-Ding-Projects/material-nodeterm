// site/app/features/vocabulary.js
//
// The "My own words" settings card: swap any friendly word on this page
// for one of your own — "terminal=magic box, robot=helper" — validated
// and bounded (see app/shared/vocabulary-state.js) and applied only to
// friendly sentences, never to a command, a file path or a piece of code
// (see app/shared/i18n.js#applyReplacements).

import { registerSettingsCard } from '../core/engine.js'
import { validateVocabularyText, MAX_TEXT_LENGTH } from '../shared/vocabulary-state.js'
import { applyReplacements } from '../shared/i18n.js'

export function registerVocabulary(store, deps, registerAction, registerBinding) {
  registerBinding('vocab-text', (s, id, value, h) => {
    const text = value.slice(0, MAX_TEXT_LENGTH)
    const result = validateVocabularyText(text)
    if (!result.ok) {
      h.toast('❌', 'That did not fit', result.reason)
      return
    }
    h.save({ vocab: text }, 'Word swaps changed')
  })
  registerAction('vocab-clear', (s, id, el, h) => {
    h.save({ vocab: '' }, 'Word swaps cleared')
    h.toast('📖', 'Cleared', 'Everything reads normally again.')
  })

  registerSettingsCard('vocab', {
    icon: '📖',
    title: 'My own words',
    desc: 'Swap any word on this page for one of your own. Write them as word=newword, separated by commas.',
    note: 'Only the friendly sentences are swapped — never a command, a file path or a piece of code.',
    controls: (s) => [
      { label: 'Swaps', isText: true, action: 'vocab-text', value: s.vocab, placeholder: 'terminal=magic box, robot=helper' },
      { label: 'Clear them', isButton: true, action: 'vocab-clear', toggleLabel: 'Remove all swaps' },
    ],
  })
}

// Re-exported for anything that only needs the pure text-shaping helper
// without pulling in the settings-card registration.
export { applyReplacements }
