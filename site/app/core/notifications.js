// site/app/core/notifications.js
//
// Non-blocking notifications, anchored bottom-right. Informational,
// success and progress messages auto-dismiss on a timeout; warnings and
// errors persist until the visitor dismisses them. Every notification is
// also kept in a reviewable, list-shaped notification centre: multi-
// select, an honestly-scoped select-all ("visible" vs "every match" of
// the centre's own filter), inverse selection, bulk dismiss, and export
// of whatever is currently filtered.
//
// Modal dialogs are reserved for genuine decisions elsewhere (see
// confirm.js) — nothing in this module ever blocks the page.

import { readJSON, writeJSON } from './storage.js'

const LOG_KEY = 'notification-log'
const MAX_LOG = 300
const AUTO_DISMISS_MS = { info: 4500, success: 4500, progress: 6000, warning: 0, error: 0 }

let toastRoot = null
let centreRoot = null
let centreOpen = false
const selected = new Set()
let filterQuery = ''
let refreshBellFn = null

function loadLog() {
  return readJSON(LOG_KEY, [])
}
function saveLog(entries) {
  writeJSON(LOG_KEY, entries.slice(0, MAX_LOG))
}

export function mount(root) {
  root.innerHTML = ''
  toastRoot = document.createElement('div')
  toastRoot.className = 'toast-stack'
  toastRoot.setAttribute('aria-live', 'polite')
  toastRoot.setAttribute('role', 'status')
  root.appendChild(toastRoot)

  const bell = document.createElement('button')
  bell.type = 'button'
  bell.className = 'notification-bell'
  bell.setAttribute('aria-label', 'Notification centre')
  bell.setAttribute('aria-expanded', 'false')
  bell.textContent = '🔔'
  const count = document.createElement('span')
  count.className = 'notification-bell__count'
  count.hidden = true
  bell.appendChild(count)
  root.appendChild(bell)

  centreRoot = document.createElement('div')
  centreRoot.className = 'notification-centre'
  centreRoot.hidden = true
  centreRoot.setAttribute('role', 'dialog')
  centreRoot.setAttribute('aria-label', 'Notification centre')
  root.appendChild(centreRoot)

  bell.addEventListener('click', () => {
    centreOpen = !centreOpen
    bell.setAttribute('aria-expanded', String(centreOpen))
    centreRoot.hidden = !centreOpen
    if (centreOpen) renderCentre()
  })

  function refreshBell() {
    const unread = loadLog().filter((e) => !e.dismissed).length
    count.hidden = unread === 0
    count.textContent = String(unread)
  }
  refreshBell()
  refreshBellFn = refreshBell // notify()/dismiss()/dismissMany() call this below
}

export function notify({ kind = 'info', title, body, actions = [] } = {}) {
  const entry = {
    id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind,
    title,
    body,
    at: new Date().toISOString(),
    dismissed: false,
  }
  const log = loadLog()
  log.unshift(entry)
  saveLog(log)
  if (refreshBellFn) refreshBellFn()

  if (toastRoot) renderToast(entry, actions)
  return entry.id
}

function renderToast(entry, actions) {
  const el = document.createElement('div')
  el.className = `toast toast--${entry.kind}`
  el.setAttribute('role', entry.kind === 'error' || entry.kind === 'warning' ? 'alert' : 'status')

  const iconMap = { info: 'ℹ️', success: '✅', progress: '⏳', warning: '⚠️', error: '❌' }
  el.innerHTML = `
    <span class="toast__icon" aria-hidden="true">${iconMap[entry.kind] || 'ℹ️'}</span>
    <span class="toast__text">
      <strong class="toast__title"></strong>
      ${entry.body ? '<span class="toast__body"></span>' : ''}
    </span>
    <button type="button" class="toast__dismiss" aria-label="Dismiss notification">×</button>
  `
  el.querySelector('.toast__title').textContent = entry.title || ''
  if (entry.body) el.querySelector('.toast__body').textContent = entry.body

  const actionsWrap = document.createElement('span')
  actionsWrap.className = 'toast__actions'
  actions.forEach((a) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'toast__action'
    btn.textContent = a.label
    btn.addEventListener('click', () => {
      a.onClick && a.onClick()
      close()
    })
    actionsWrap.appendChild(btn)
  })
  if (actions.length) el.appendChild(actionsWrap)

  function close() {
    el.classList.add('toast--leaving')
    setTimeout(() => el.remove(), 200)
  }
  el.querySelector('.toast__dismiss').addEventListener('click', () => {
    dismiss(entry.id)
    close()
  })

  toastRoot.appendChild(el)
  const ms = AUTO_DISMISS_MS[entry.kind] ?? 4500
  if (ms > 0) setTimeout(close, ms)
}

export function dismiss(id) {
  const log = loadLog()
  const e = log.find((x) => x.id === id)
  if (e) e.dismissed = true
  saveLog(log)
  if (refreshBellFn) refreshBellFn()
  if (centreOpen) renderCentre()
}

export function dismissMany(ids) {
  const log = loadLog()
  const set = new Set(ids)
  log.forEach((e) => {
    if (set.has(e.id)) e.dismissed = true
  })
  saveLog(log)
  if (refreshBellFn) refreshBellFn()
  if (centreOpen) renderCentre()
}

function filteredLog() {
  const log = loadLog()
  if (!filterQuery) return log
  const q = filterQuery.toLowerCase()
  return log.filter((e) => `${e.title} ${e.body || ''}`.toLowerCase().includes(q))
}

function renderCentre() {
  centreRoot.innerHTML = ''
  const header = document.createElement('div')
  header.className = 'notification-centre__header'
  header.innerHTML = '<h3>Notifications</h3>'
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'icon-btn'
  closeBtn.setAttribute('aria-label', 'Close notification centre')
  closeBtn.textContent = '×'
  closeBtn.addEventListener('click', () => {
    centreOpen = false
    centreRoot.hidden = true
  })
  header.appendChild(closeBtn)
  centreRoot.appendChild(header)

  const searchInput = document.createElement('input')
  searchInput.type = 'search'
  searchInput.placeholder = 'Filter notifications…'
  searchInput.value = filterQuery
  searchInput.className = 'notification-centre__filter'
  searchInput.addEventListener('input', () => {
    filterQuery = searchInput.value
    selected.clear()
    renderCentre()
  })
  centreRoot.appendChild(searchInput)

  const entries = filteredLog()
  const toolbar = document.createElement('div')
  toolbar.className = 'notification-centre__toolbar'

  const selectAllBtn = document.createElement('button')
  selectAllBtn.type = 'button'
  selectAllBtn.className = 'btn btn-secondary btn-sm'
  const allSelected = entries.length > 0 && entries.every((e) => selected.has(e.id))
  selectAllBtn.textContent = allSelected ? 'Deselect all shown' : `Select all shown (${entries.length})`
  selectAllBtn.addEventListener('click', () => {
    if (allSelected) entries.forEach((e) => selected.delete(e.id))
    else entries.forEach((e) => selected.add(e.id))
    renderCentre()
  })
  toolbar.appendChild(selectAllBtn)

  const invertBtn = document.createElement('button')
  invertBtn.type = 'button'
  invertBtn.className = 'btn btn-secondary btn-sm'
  invertBtn.textContent = 'Invert selection'
  invertBtn.addEventListener('click', () => {
    entries.forEach((e) => (selected.has(e.id) ? selected.delete(e.id) : selected.add(e.id)))
    renderCentre()
  })
  toolbar.appendChild(invertBtn)

  const bulkDismissBtn = document.createElement('button')
  bulkDismissBtn.type = 'button'
  bulkDismissBtn.className = 'btn btn-secondary btn-sm'
  bulkDismissBtn.textContent = `Dismiss selected (${selected.size})`
  bulkDismissBtn.disabled = selected.size === 0
  bulkDismissBtn.addEventListener('click', () => {
    dismissMany([...selected])
    selected.clear()
  })
  toolbar.appendChild(bulkDismissBtn)

  const exportBtn = document.createElement('button')
  exportBtn.type = 'button'
  exportBtn.className = 'btn btn-secondary btn-sm'
  exportBtn.textContent = 'Export filtered as JSON'
  exportBtn.addEventListener('click', () => exportEntries(entries))
  toolbar.appendChild(exportBtn)

  centreRoot.appendChild(toolbar)

  const list = document.createElement('div')
  list.className = 'notification-centre__list'
  if (!entries.length) {
    list.innerHTML = '<p class="settings-empty">No notifications match this filter.</p>'
  } else {
    entries.forEach((e) => {
      const row = document.createElement('label')
      row.className = 'notification-centre__row'
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = selected.has(e.id)
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(e.id)
        else selected.delete(e.id)
        renderCentre()
      })
      row.appendChild(cb)
      const text = document.createElement('span')
      text.className = 'notification-centre__row-text'
      text.innerHTML = `<strong>${escapeHtml(e.title || '')}</strong>${e.body ? ' — ' + escapeHtml(e.body) : ''} <span class="notification-centre__when">${new Date(e.at).toLocaleString()}</span>${e.dismissed ? ' <em>(dismissed)</em>' : ''}`
      row.appendChild(text)
      list.appendChild(row)
    })
  }
  centreRoot.appendChild(list)
}

function exportEntries(entries) {
  const json = JSON.stringify(entries, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'nodeterm-site-notifications.json'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
