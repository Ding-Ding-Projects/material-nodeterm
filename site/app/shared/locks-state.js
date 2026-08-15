// site/app/shared/locks-state.js
//
// Toy locks. THIS IS JUST FOR FUN — a small speed bump, never security. It
// never protects, secures, or encrypts anything, and every surface that
// shows a lock says so, every time (see features/locks.js and
// shared/lockGate.js). Each lock carries its OWN credential: there is no
// master credential and no inheritance, so unlocking one lock never
// unlocks another. Locks are tracked as a real, enumerable, individually
// removable list. Forgetting a password is recovered by clearing this
// site's browser storage, which is named explicitly everywhere a lock's
// password prompt appears.

import { readJSON, writeJSON, subscribe } from './storage.js'
import { hashSecret, verifySecret, randomSaltHex } from './crypto.js'

const KEY_LOCKS = 'locks.list'

function readList() {
  const list = readJSON(KEY_LOCKS, [])
  return Array.isArray(list) ? list : []
}
function writeList(list) {
  writeJSON(KEY_LOCKS, list)
}

export function listLocks() {
  return readList()
}

export function getLock(id) {
  return readList().find((l) => l.id === id) || null
}

export function isLocked(id) {
  return getLock(id) != null
}

export async function createLock(id, label, password) {
  const salt = randomSaltHex()
  const hash = await hashSecret(password, salt)
  const list = readList().filter((l) => l.id !== id)
  list.push({ id, label, saltHex: salt, hashHex: hash, createdAt: new Date().toISOString() })
  writeList(list)
}

export function removeLock(id) {
  writeList(readList().filter((l) => l.id !== id))
  unlockedThisSession.delete(id)
}

export function removeLocks(ids) {
  const set = new Set(ids)
  writeList(readList().filter((l) => !set.has(l.id)))
  for (const id of ids) unlockedThisSession.delete(id)
}

export async function verifyLockPassword(id, password) {
  const lock = getLock(id)
  if (!lock) return false
  return verifySecret(password, lock.saltHex, lock.hashHex)
}

export function subscribeLocks(cb) {
  return subscribe(KEY_LOCKS, cb)
}

// --- Session-only unlocked state (never persisted — a reload re-locks
// everything, which is the honest behavior for a toy lock with no real
// session concept). ---
const unlockedThisSession = new Set()
const unlockListeners = new Set()

export function isUnlocked(id) {
  return unlockedThisSession.has(id)
}
export function markUnlocked(id) {
  unlockedThisSession.add(id)
  notifyUnlock()
}
export function relock(id) {
  unlockedThisSession.delete(id)
  notifyUnlock()
}
export function subscribeUnlockState(cb) {
  unlockListeners.add(cb)
  return () => unlockListeners.delete(cb)
}
function notifyUnlock() {
  for (const cb of unlockListeners) {
    try {
      cb()
    } catch (_err) {
      /* ignore */
    }
  }
}
