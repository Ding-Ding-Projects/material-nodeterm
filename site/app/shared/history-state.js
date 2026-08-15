// site/app/shared/history-state.js
//
// A small local version-history log: every meaningful settings change on
// this site (language mode, funny levels, School mode, a vocabulary file
// loaded, a lock created…) is recorded here as one entry, append-only,
// capped, and exportable. This is the site's own analogue of the app's
// local version history — plain, human-readable descriptions rather than
// document snapshots, since this site has no documents.

import { readJSON, writeJSON, subscribe } from './storage.js'

const KEY_HISTORY = 'local.history'
const MAX_HISTORY = 500

export function recordHistoryEntry(description) {
  if (!description) return
  const entry = { id: 'h-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8), description, at: new Date().toISOString() }
  const list = readJSON(KEY_HISTORY, [])
  list.unshift(entry)
  writeJSON(KEY_HISTORY, list.slice(0, MAX_HISTORY))
  return entry
}

export function listHistory() {
  return readJSON(KEY_HISTORY, [])
}
export function removeHistoryEntries(ids) {
  const set = new Set(ids)
  writeJSON(KEY_HISTORY, listHistory().filter((h) => !set.has(h.id)))
}
export function clearHistory() {
  writeJSON(KEY_HISTORY, [])
}
export function subscribeHistory(cb) {
  return subscribe(KEY_HISTORY, cb)
}
