// site/app/features/vocabulary.js
//
// The personal-vocabulary JSON upload control. Visible even before a file
// exists (no-file / loaded / invalid / replace / clear states), fully
// local, no network request. See shared/vocabulary-state.js for the schema,
// bounds, and the applyReplacements() function that shared/i18n.js's t()
// calls at the text boundary.

import { h, injectStyleOnce } from '../shared/dom.js'
import { asMountable } from '../shared/mountable.js'
import { guardPanel } from '../shared/lockGate.js'
import { t, subscribeI18n } from '../shared/i18n.js'
import { createBulkList } from '../shared/bulkList.js'
import { pushNotification } from '../shared/notifications-state.js'
import { recordHistoryEntry } from '../shared/history-state.js'
import {
  validateVocabularyText,
  hasVocabulary,
  getFileName,
  getEntries,
  setVocabulary,
  clearVocabulary,
  subscribeVocabulary,
  MAX_ENTRIES,
  MAX_KEY_LEN,
  MAX_VALUE_LEN,
  MAX_FILE_BYTES,
} from '../shared/vocabulary-state.js'

injectStyleOnce(
  'site-vocab-style',
  `
  .site-vocab { display: flex; flex-direction: column; gap: 14px; }
  .site-vocab__picker { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .site-vocab__btn {
    min-height: var(--touch-target, 44px); padding: 0 14px; border-radius: var(--md-shape-full, 999px);
    border: 1px solid var(--md-outline, #79767e); background: var(--md-surface-container, #efeaf2);
    color: var(--md-on-surface, #1c1b1f); cursor: pointer; font: inherit;
  }
  .site-vocab__status { font-size: 13px; }
  .site-vocab__status[data-kind="invalid"] { color: var(--md-error, #ba1a1a); }
  .site-vocab__status[data-kind="ok"] { color: var(--md-on-surface-variant, #47454a); }
  .site-vocab__help { font-size: 12px; opacity: 0.75; }
  .site-vocab__row-key { font-family: var(--md-font-mono); }
  .site-vocab__row-arrow { opacity: 0.6; margin: 0 6px; }
  `,
)

function buildPanel() {
  const wrap = h('div', { class: 'site-vocab' })
  const status = h('div', { class: 'site-vocab__status', 'aria-live': 'polite' })
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    'aria-label': 'Choose a personal-vocabulary JSON file',
    onChange: async (e) => {
      const file = e.target.files && e.target.files[0]
      if (!file) return
      if (file.size > MAX_FILE_BYTES) {
        status.dataset.kind = 'invalid'
        status.textContent = t('vocab.invalid') + ` File is larger than ${Math.round(MAX_FILE_BYTES / 1024)} KB.`
        return
      }
      const text = await file.text()
      const result = validateVocabularyText(text)
      if (!result.ok) {
        status.dataset.kind = 'invalid'
        status.textContent = t('vocab.invalid') + ' ' + result.error
        pushNotification({ kind: 'error', title: 'Vocabulary', message: `Could not use "${file.name}": ${result.error}` })
        return
      }
      setVocabulary(file.name, result.entries)
      status.dataset.kind = 'ok'
      status.textContent = t('vocab.loaded') + ` (${Object.keys(result.entries).length} entries from "${file.name}")`
      pushNotification({ kind: 'success', title: 'Vocabulary', message: `Loaded ${Object.keys(result.entries).length} entries from "${file.name}".` })
      recordHistoryEntry(`Loaded personal vocabulary file "${file.name}" (${Object.keys(result.entries).length} entries).`)
      fileInput.value = ''
      rebuild()
    },
  })

  let listHandle = null

  function rebuild() {
    wrap.textContent = ''
    wrap.appendChild(h('h3', {}, t('vocab.section.title')))
    wrap.appendChild(h('p', { class: 'site-vocab__help' }, t('vocab.help')))
    wrap.appendChild(
      h('p', { class: 'site-vocab__help' }, `Limits: up to ${MAX_ENTRIES} entries, key ≤ ${MAX_KEY_LEN} chars, value ≤ ${MAX_VALUE_LEN} chars, file ≤ ${Math.round(MAX_FILE_BYTES / 1024)} KB.`),
    )

    const has = hasVocabulary()
    const chooseBtn = h(
      'button',
      { type: 'button', class: 'site-vocab__btn', onClick: () => fileInput.click() },
      has ? 'Replace file…' : 'Choose file…',
    )
    const clearBtn = h(
      'button',
      {
        type: 'button',
        class: 'site-vocab__btn',
        disabled: !has,
        onClick: () => {
          clearVocabulary()
          status.dataset.kind = 'ok'
          status.textContent = t('vocab.cleared')
          pushNotification({ kind: 'info', title: 'Vocabulary', message: 'Vocabulary file cleared.' })
          recordHistoryEntry('Cleared personal vocabulary file.')
          rebuild()
        },
      },
      t('common.clear'),
    )
    wrap.appendChild(h('div', { class: 'site-vocab__picker' }, [chooseBtn, clearBtn, fileInput]))

    if (!has) {
      status.dataset.kind = 'ok'
      if (!status.textContent) status.textContent = t('vocab.no.file')
    } else if (!status.textContent) {
      status.dataset.kind = 'ok'
      status.textContent = `${t('vocab.loaded')} (${getFileName()}, ${Object.keys(getEntries()).length} entries)`
    }
    wrap.appendChild(status)

    if (has) {
      const entries = getEntries()
      const items = Object.entries(entries).map(([key, value]) => ({ key, value }))
      listHandle = createBulkList({
        getItems: () => items,
        getId: (it) => it.key,
        getSearchText: (it) => it.key + ' ' + it.value,
        renderRow: (it) =>
          h('span', {}, [
            h('span', { class: 'site-vocab__row-key' }, it.key),
            h('span', { class: 'site-vocab__row-arrow' }, '→'),
            h('span', {}, it.value),
          ]),
        searchLabel: 'Search vocabulary entries',
        emptyLabel: t('common.none'),
        actions: [
          {
            id: 'remove',
            label: 'Remove selected',
            destructive: true,
            run: (ids) => {
              const next = { ...entries }
              for (const id of ids) delete next[id]
              setVocabulary(getFileName(), next)
              rebuild()
            },
          },
        ],
      })
      wrap.appendChild(listHandle.root)
    }
  }

  rebuild()
  subscribeVocabulary(rebuild)
  subscribeI18n(rebuild)
  return wrap
}

export function registerVocabulary(api) {
  // Wired as a real lockable surface (features/locks.js can lock this
  // panel behind its own independent password).
  const guarded = guardPanel('vocabulary', 'Personal vocabulary panel', buildPanel)

  if (typeof api.registerTab === 'function') {
    api.registerTab({ id: 'vocabulary', title: 'Personal vocabulary', icon: '📖', group: 'settings', render: asMountable(guarded) })
  }
  if (typeof api.registerSetting === 'function') {
    api.registerSetting({
      id: 'personal-vocabulary-upload',
      tabId: 'vocabulary',
      title: 'Personal vocabulary JSON upload',
      describe: () => 'Upload a local word → replacement JSON file. Nothing is uploaded anywhere.',
      control: asMountable(guarded),
    })
  }
  if (typeof api.registerCommand === 'function') {
    api.registerCommand({
      id: 'clear-personal-vocabulary',
      title: 'Clear personal vocabulary',
      run: () => clearVocabulary(),
    })
  }
}
