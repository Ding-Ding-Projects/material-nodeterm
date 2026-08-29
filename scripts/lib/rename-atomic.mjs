import { renameSync } from 'node:fs'
import { rename } from 'node:fs/promises'

// `src/core/fs-atomic.ts` is the canonical implementation and explanation. Scripts cannot import
// that TypeScript module directly, so this boundary-local twin keeps the same transient codes,
// bounded backoff, and final-error behavior as the sanctioned session-host duplicate.
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RETRY_DELAYS_MS = [10, 25, 75, 200]
const SLEEP_SLOT = new Int32Array(new SharedArrayBuffer(4))

function codeOf(error) {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function renameAtomic(temporary, target, options = {}) {
  const renameFile = options.rename ?? rename
  const wait = options.sleep ?? sleep
  for (let attempt = 0; ; attempt++) {
    try {
      await renameFile(temporary, target)
      return
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length || !TRANSIENT_RENAME_CODES.has(codeOf(error))) {
        throw error
      }
      await wait(RETRY_DELAYS_MS[attempt])
    }
  }
}

export function renameAtomicSync(temporary, target, options = {}) {
  const renameFile = options.rename ?? renameSync
  const wait = options.sleep ?? ((ms) => Atomics.wait(SLEEP_SLOT, 0, 0, ms))
  for (let attempt = 0; ; attempt++) {
    try {
      renameFile(temporary, target)
      return
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length || !TRANSIENT_RENAME_CODES.has(codeOf(error))) {
        throw error
      }
      wait(RETRY_DELAYS_MS[attempt])
    }
  }
}
