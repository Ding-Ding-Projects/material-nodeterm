// site/app/shared/locks-state.js
//
// Toy locks: put a password on any settings box or any hallway door. Each
// lock has its own independently-set password; opening one never opens
// another, and there is no master credential. This is a for-fun
// speed-bump, not real security — the module and every surface that uses
// it says so, and the only recovery path is "Start fresh" (which wipes
// everything this page saved in this browser).

import { sha256Hex } from './crypto.js'

// Create a new lock entry for `id`: hash the given plaintext password and
// return the {id, hash} pair the caller should merge into state.locks.
export async function createLock(id, plainPassword) {
  const hash = await sha256Hex(String(plainPassword || ''))
  return { id, hash }
}

export async function checkLock(locks, id, attempt) {
  const stored = locks[id]
  if (!stored) return true
  const hash = await sha256Hex(String(attempt || ''))
  return hash === stored
}

export function isLocked(locks, unlocked, id) {
  return !!locks[id] && !unlocked[id]
}
