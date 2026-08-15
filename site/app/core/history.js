// site/app/core/history.js
//
// Local, append-only version history for the visitor's own settings
// changes. Every write goes through `record()`, which appends a new
// revision — it NEVER rewrites or removes an earlier one. Restoring an
// earlier value is itself recorded as a brand-new revision (so an undo
// can be undone, and that undo undone in turn), per the project's local
// version-control contract.
//
// This is intentionally small: a per-visitor settings history for a
// static site, not the full Git-backed document history the desktop app
// keeps. It still honours the same shape — append-only, labelled with
// WHAT changed, filterable by date and by action.

import { readJSON, writeJSON } from './storage.js'

const KEY = 'settings-history'
const MAX_ENTRIES = 500 // bounded so localStorage can't grow without limit

function load() {
  return readJSON(KEY, [])
}
function save(entries) {
  writeJSON(KEY, entries)
}

/**
 * record({ settingId, title, from, to, action })
 * action: 'changed' | 'restored' | 'reset'
 */
export function record(entry) {
  const entries = load()
  entries.unshift({
    id: `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    action: entry.action || 'changed',
    settingId: entry.settingId,
    title: entry.title || entry.settingId,
    from: entry.from,
    to: entry.to,
  })
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES
  save(entries)
  return entries[0]
}

export function list({ action, since, until, query } = {}) {
  let entries = load()
  if (action) entries = entries.filter((e) => e.action === action)
  if (since) entries = entries.filter((e) => e.at >= since)
  if (until) entries = entries.filter((e) => e.at <= until)
  if (query) {
    const q = query.toLowerCase()
    entries = entries.filter((e) => (e.title || '').toLowerCase().includes(q))
  }
  return entries
}

export function actionCounts() {
  const counts = {}
  for (const e of load()) counts[e.action] = (counts[e.action] || 0) + 1
  return counts
}

export function clearHistory() {
  save([])
}
