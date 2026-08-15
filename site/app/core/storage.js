// site/app/core/storage.js
//
// Every persisted value on this site lives in the visitor's own browser
// (localStorage) — per-visitor state, never a network write. Every key is
// namespaced under "nodeterm-site." so this page never collides with
// anything else on the same origin, and a private-mode visitor (where
// localStorage throws) degrades to an in-memory Map for the tab's
// lifetime rather than crashing the page.

const PREFIX = 'nodeterm-site.'

let memory = null
function fallback() {
  if (!memory) memory = new Map()
  return memory
}

function hasRealStorage() {
  try {
    const k = `${PREFIX}__probe__`
    window.localStorage.setItem(k, '1')
    window.localStorage.removeItem(k)
    return true
  } catch (_) {
    return false
  }
}

const usable = typeof window !== 'undefined' && hasRealStorage()

export function readJSON(key, fallbackValue) {
  const full = PREFIX + key
  try {
    if (usable) {
      const raw = window.localStorage.getItem(full)
      return raw === null ? fallbackValue : JSON.parse(raw)
    }
    return fallback().has(full) ? fallback().get(full) : fallbackValue
  } catch (_) {
    return fallbackValue
  }
}

export function writeJSON(key, value) {
  const full = PREFIX + key
  try {
    if (usable) {
      window.localStorage.setItem(full, JSON.stringify(value))
    } else {
      fallback().set(full, value)
    }
  } catch (_) {
    // Quota exceeded or storage disabled mid-session — the page keeps
    // working with the in-memory value for this load; nothing crashes.
    fallback().set(full, value)
  }
}

export function removeKey(key) {
  const full = PREFIX + key
  try {
    if (usable) window.localStorage.removeItem(full)
  } catch (_) {
    /* ignore */
  }
  fallback().delete(full)
}

/** Remove every key this page owns. Used by the destructive "clear local
 * site data" action — never called for the visitor without the
 * super-confirmation gate. */
export function clearAll() {
  try {
    if (usable) {
      const toRemove = []
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i)
        if (k && k.startsWith(PREFIX)) toRemove.push(k)
      }
      toRemove.forEach((k) => window.localStorage.removeItem(k))
    }
  } catch (_) {
    /* ignore */
  }
  if (memory) memory.clear()
}

export const STORAGE_PREFIX = PREFIX
