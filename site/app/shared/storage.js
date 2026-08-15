// site/app/shared/storage.js
//
// Every feature module on this site keeps its state in the visitor's own
// browser storage, under keys prefixed with LS_PREFIX. Nothing here ever
// makes a network request. `localStorage` can throw (private/incognito
// mode, storage quota, a browser policy) so every read/write is wrapped —
// a feature that cannot persist should degrade to "works for this load
// only", never crash the page.

export const LS_PREFIX = 'nodeterm.site.'

/** @type {Map<string, Set<() => void>>} */
const subscribers = new Map()

function fullKey(key) {
  return key.startsWith(LS_PREFIX) ? key : LS_PREFIX + key
}

export function readString(key, fallback = '') {
  try {
    const v = window.localStorage.getItem(fullKey(key))
    return v === null ? fallback : v
  } catch (_err) {
    return fallback
  }
}

export function writeString(key, value) {
  try {
    window.localStorage.setItem(fullKey(key), String(value))
    publish(key)
    return true
  } catch (_err) {
    return false
  }
}

export function readJSON(key, fallback = null) {
  const raw = readString(key, null)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw)
  } catch (_err) {
    return fallback
  }
}

export function writeJSON(key, value) {
  try {
    return writeString(key, JSON.stringify(value))
  } catch (_err) {
    return false
  }
}

export function remove(key) {
  try {
    window.localStorage.removeItem(fullKey(key))
    publish(key)
    return true
  } catch (_err) {
    return false
  }
}

/** Every key this site has ever written, for a full-storage export or a full reset. */
export function listOwnKeys() {
  const out = []
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(LS_PREFIX)) out.push(k)
    }
  } catch (_err) {
    /* storage unavailable */
  }
  return out
}

/** Removes every key this site owns. Used by the "clear this site's storage" recovery route. */
export function clearAllSiteStorage() {
  for (const k of listOwnKeys()) {
    try {
      window.localStorage.removeItem(k)
    } catch (_err) {
      /* ignore */
    }
  }
  for (const key of subscribers.keys()) publish(key)
}

/**
 * In-page pub/sub for a storage key. The browser's own `storage` event only
 * fires in OTHER tabs, never the tab that made the write — so components in
 * this same page that need to react to a change made elsewhere in this page
 * (e.g. the settings tab and the palette both showing the language mode)
 * subscribe here instead.
 */
export function subscribe(key, cb) {
  const k = fullKey(key)
  if (!subscribers.has(k)) subscribers.set(k, new Set())
  subscribers.get(k).add(cb)
  return () => {
    const set = subscribers.get(k)
    if (set) set.delete(cb)
  }
}

function publish(key) {
  const k = fullKey(key)
  const set = subscribers.get(k)
  if (!set) return
  for (const cb of set) {
    try {
      cb()
    } catch (_err) {
      /* a subscriber's own error must not break other subscribers */
    }
  }
}

export function clampString(s, max) {
  if (typeof s !== 'string') return ''
  return s.length > max ? s.slice(0, max) : s
}
