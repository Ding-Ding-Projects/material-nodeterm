// site/app/shared/notifications-state.js
//
// A small notification history + non-blocking toast renderer, shared by
// every feature module that wants to tell the visitor something happened
// (vocabulary loaded, a lock created, School mode toggled, …). Toasts are
// anchored bottom-left (dim sum's toast uses bottom-right — see
// features/dimsum.js — so the two never overlap), auto-dismiss for
// info/success, and stay until dismissed for warning/error, matching the
// project's own non-blocking-notification contract. Every dismissed toast
// stays reviewable afterward in the history list this module keeps.

import { readJSON, writeJSON, subscribe } from './storage.js'
import { h, injectStyleOnce } from './dom.js'

const KEY_HISTORY = 'notify.history'
const MAX_HISTORY = 200

injectStyleOnce(
  'site-notify-style',
  `
  .site-notify-stack {
    position: fixed; left: 16px; bottom: 16px; z-index: 41;
    display: flex; flex-direction: column-reverse; gap: 8px; max-width: min(320px, 90vw);
  }
  .site-notify-toast {
    display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px;
    background: var(--md-surface-container-high, #e9e4ec); color: var(--md-on-surface, #1c1b1f);
    border-radius: var(--md-shape-md, 12px); box-shadow: var(--md-elevation-2); font-size: 13px;
  }
  .site-notify-toast[data-kind="warning"], .site-notify-toast[data-kind="error"] {
    border: 1px solid var(--md-error, #ba1a1a);
  }
  .site-notify-toast__close { margin-left: auto; background: transparent; border: none; cursor: pointer; font-size: 15px; min-width: 28px; min-height: 28px; }
  `,
)

let stackEl = null
function getStack() {
  if (!stackEl) {
    stackEl = h('div', { class: 'site-notify-stack', 'aria-live': 'polite' })
    document.body.appendChild(stackEl)
  }
  return stackEl
}

const KIND_EMOJI = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' }

function showToast(entry) {
  const el = h('div', { class: 'site-notify-toast', 'data-kind': entry.kind, role: 'status' }, [
    h('span', {}, `${KIND_EMOJI[entry.kind] || 'ℹ️'} `),
    h('span', {}, [h('strong', {}, entry.title ? entry.title + ' — ' : ''), entry.message]),
    h('button', { type: 'button', class: 'site-notify-toast__close', 'aria-label': 'Dismiss', onClick: () => el.remove() }, '×'),
  ])
  getStack().appendChild(el)
  const persistUntilDismissed = entry.kind === 'warning' || entry.kind === 'error'
  if (!persistUntilDismissed) setTimeout(() => el.remove(), 6000)
}

export function pushNotification({ kind = 'info', title = '', message }) {
  if (!message) return
  const entry = { id: 'n-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8), kind, title, message, at: new Date().toISOString() }
  const list = readJSON(KEY_HISTORY, [])
  list.unshift(entry)
  writeJSON(KEY_HISTORY, list.slice(0, MAX_HISTORY))
  try {
    showToast(entry)
  } catch (_err) {
    /* DOM not ready yet — history is still recorded */
  }
  return entry
}

export function listNotifications() {
  return readJSON(KEY_HISTORY, [])
}
export function removeNotifications(ids) {
  const set = new Set(ids)
  writeJSON(KEY_HISTORY, listNotifications().filter((n) => !set.has(n.id)))
}
export function clearNotifications() {
  writeJSON(KEY_HISTORY, [])
}
export function subscribeNotifications(cb) {
  return subscribe(KEY_HISTORY, cb)
}
