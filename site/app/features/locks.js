// site/app/features/locks.js
//
// The Toy Locks management panel: create a lock on any of this site's
// lockable surfaces (each with its OWN independent password — no master
// credential), see every active lock as a real removable list with its
// own search, and remove one or many at once. THIS IS JUST FOR FUN, and
// the panel says so, every time it is shown, at every funny level.
//
// Two of this site's own panels are wired as real lockable surfaces
// (see shared/lockGate.js's guardPanel, used by vocabulary.js and
// narrator.js) so this is a genuine cross-feature demonstration, not just
// a list that manages itself.

import { h, injectStyleOnce } from '../shared/dom.js'
import { asMountable } from '../shared/mountable.js'
import { t, subscribeI18n } from '../shared/i18n.js'
import { createBulkList } from '../shared/bulkList.js'
import { listLocks, createLock, removeLock, removeLocks, subscribeLocks, relock, isUnlocked } from '../shared/locks-state.js'
import { pushNotification } from '../shared/notifications-state.js'
import { recordHistoryEntry } from '../shared/history-state.js'

injectStyleOnce(
  'site-locks-style',
  `
  .site-locks { display: flex; flex-direction: column; gap: 14px; }
  .site-locks__help { font-size: 12px; opacity: 0.75; }
  .site-locks__create { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .site-locks__create select, .site-locks__create input {
    height: var(--touch-target, 44px); border-radius: var(--md-shape-sm, 8px);
    border: 1px solid var(--md-outline, #79767e); background: var(--md-surface-container-low, #f5f1f8);
    color: var(--md-on-surface, #1c1b1f); padding: 0 10px; font: inherit;
  }
  .site-locks__btn {
    min-height: var(--touch-target, 44px); padding: 0 14px; border-radius: var(--md-shape-full, 999px);
    border: 1px solid var(--md-outline, #79767e); background: var(--md-surface-container, #efeaf2);
    color: var(--md-on-surface, #1c1b1f); cursor: pointer; font: inherit;
  }
  `,
)

// The site's own lockable surfaces. Any feature module could add itself
// here by importing shared/lockGate.js directly; these two are wired as
// the working examples.
const LOCKABLE_SURFACES = [
  { id: 'vocabulary', label: 'Personal vocabulary panel' },
  { id: 'narrator', label: 'Narrator panel' },
]

function buildPanel() {
  const wrap = h('div', { class: 'site-locks' })

  function rebuild() {
    wrap.textContent = ''
    wrap.appendChild(h('h3', {}, t('locks.section.title')))
    wrap.appendChild(h('p', {}, t('locks.disclaimer')))

    const existingIds = new Set(listLocks().map((l) => l.id))
    const available = LOCKABLE_SURFACES.filter((s) => !existingIds.has(s.id))
    if (available.length > 0) {
      const select = h(
        'select',
        { 'aria-label': 'Surface to lock' },
        available.map((s) => h('option', { value: s.id }, s.label)),
      )
      const pw = h('input', { type: 'password', placeholder: 'New password', 'aria-label': 'New lock password' })
      const createBtn = h(
        'button',
        {
          type: 'button',
          class: 'site-locks__btn',
          onClick: async () => {
            if (!pw.value) return
            const surface = LOCKABLE_SURFACES.find((s) => s.id === select.value)
            const label = surface ? surface.label : select.value
            await createLock(select.value, label, pw.value)
            pushNotification({ kind: 'success', title: 'Toy locks', message: `Created a lock on "${label}".` })
            recordHistoryEntry(`Created a toy lock on "${label}".`)
            pw.value = ''
            rebuild()
          },
        },
        'Create lock',
      )
      wrap.appendChild(h('div', { class: 'site-locks__create' }, [select, pw, createBtn]))
    } else {
      wrap.appendChild(h('p', { class: 'site-locks__help' }, 'Every lockable surface already has a lock.'))
    }

    const listComp = createBulkList({
      getItems: () => listLocks(),
      getId: (l) => l.id,
      getSearchText: (l) => l.label + ' ' + l.id,
      renderRow: (l) =>
        h('span', {}, [
          h('strong', {}, l.label),
          ' — ' + t('locks.locked.label') + (isUnlocked(l.id) ? ' (unlocked this visit)' : ''),
          ' · created ' + new Date(l.createdAt).toLocaleDateString(),
        ]),
      searchLabel: 'Search locks',
      emptyLabel: t('common.none'),
      actions: [
        {
          id: 'relock',
          label: 'Re-lock selected',
          run: (ids) => {
            for (const id of ids) relock(id)
            rebuild()
          },
        },
        {
          id: 'remove',
          label: 'Remove selected',
          destructive: true,
          run: (ids) => {
            removeLocks(ids)
            pushNotification({ kind: 'info', title: 'Toy locks', message: `Removed ${ids.length} lock${ids.length === 1 ? '' : 's'}.` })
            recordHistoryEntry(`Removed ${ids.length} toy lock${ids.length === 1 ? '' : 's'}.`)
            rebuild()
          },
        },
      ],
    })
    wrap.appendChild(listComp.root)
    wrap.appendChild(h('p', { class: 'site-locks__help' }, t('locks.recovery.hint')))
  }

  rebuild()
  subscribeLocks(rebuild)
  subscribeI18n(rebuild)
  return wrap
}

export function registerLocks(api) {
  if (typeof api.registerTab === 'function') {
    api.registerTab({ id: 'toy-locks', title: 'Toy locks', icon: '🔒', group: 'settings', render: asMountable(buildPanel) })
  }
  if (typeof api.registerSetting === 'function') {
    api.registerSetting({
      id: 'toy-locks-manager',
      tabId: 'toy-locks',
      title: 'Toy locks (just for fun, not security)',
      describe: () => 'Lock a panel behind its own password. Each lock is independent.',
      control: asMountable(buildPanel),
    })
  }
  if (typeof api.registerCommand === 'function') {
    api.registerCommand({
      id: 'locks-remove-all',
      title: 'Remove every toy lock',
      run: () => removeLocks(listLocks().map((l) => l.id)),
    })
  }
}
