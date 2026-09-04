// The PIN credential shared by every locked "mode" in this family (School mode today, Kids mode
// next). Extracted rather than copied, because this is the security-critical half and a second
// hand-maintained copy of it is the drift this repo has been bitten by three times already —
// with the twist that here a drift means one mode's lock quietly behaving differently from the
// other's.
//
// The record half (what a mode stores, how it watches for external edits) is deliberately NOT
// here: those differ per mode and getting them slightly out of step is harmless. This file holds
// only the part where a difference would be a security difference.
//
// WHAT THIS GUARANTEES, and each line is asserted in school-mode.test.ts:
//   - a PIN is never stored; only a scrypt hash of it, over a per-credential random salt
//   - the hash is sealed at rest when the platform offers a credential vault, and stored as raw
//     0600 bytes when it does not (the Server Edition has no credential vault, the same documented
//     trade-off core/agents/node-auth-secret.ts already makes)
//   - the hash is base64-encoded BEFORE sealing, because sealSecret encrypts the UTF-8 CONTENT of
//     the buffer it is handed, and not every byte of a binary hash is valid UTF-8
//   - an unsealable credential reads as "cannot verify" and the mode stays LOCKED, rather than
//     throwing on a boot path or falling open. A credential-vault reset or a machine migration is a
//     normal event, and the documented recovery is deleting the shared directory
//   - comparison is timing-safe

import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'

import { platform } from './platform'
import {
  readAtomicFileSnapshot,
  withCrossProcessLock,
  writeAtomicFileCompared,
  type CrossProcessLease
} from './fs-transaction-lock'

const SCRYPT_KEYLEN = 32
export const MIN_PIN_LENGTH = 4
export const MAX_PIN_LENGTH = 128

/**
 * Brute-force throttling, and why it is not optional here.
 *
 * A four-digit PIN is 10^4. `disable(pin)` is exposed verbatim on the bridge
 * (`window.nodeTerminal.kidsMode.disable`), Electron's default menu is deliberately left live so
 * DevTools opens in a packaged build, and the Server Edition runs in an ordinary browser where
 * DevTools cannot be disabled at all. Without a throttle, a console loop walks the whole keyspace
 * in minutes — through the app's own front door, not through the disclosed "the terminal is not
 * sandboxed" limit.
 *
 * The shape is lifted from `core/toylocks/toylock-service.ts`, which has had exactly this since it
 * shipped — for a feature whose own header says it is NOT security. A child-facing lock having
 * less protection than the toy one was the finding that prompted this.
 *
 * In memory on purpose: a restart clears it. That is the honest trade — persisting it would mean
 * a lockout survivable only by deleting the shared directory, which is the very recovery path a
 * locked-out adult needs. It costs an attacker an app restart per burst, and no more.
 */
const RATE_LIMIT_THRESHOLD = 3
const RATE_LIMIT_MAX_MS = 30_000
const rate = new Map<string, { fails: number; lastFailAt: number }>()

/** How long this credential must wait before another attempt is even looked at. 0 = go ahead. */
export function retryAfterMs(file: string, now = Date.now()): number {
  const st = rate.get(file)
  if (!st || st.fails < RATE_LIMIT_THRESHOLD) return 0
  const wait = Math.min(RATE_LIMIT_MAX_MS, 500 * 2 ** (st.fails - RATE_LIMIT_THRESHOLD))
  return Math.max(0, st.lastFailAt + wait - now)
}

/** Test seam: drop the throttle state. */
export function resetRateLimitForTests(): void {
  rate.clear()
}

export interface StoredCredential {
  version: 1
  /** base64 scrypt salt. */
  salt: string
  /** base64 scrypt hash — sealed when `sealed` is true, raw base64 bytes when it is not. Never a
   *  stored plaintext PIN, either way. */
  hash: string
  sealed: boolean
}

/** Write bytes atomically: unique tmp at 0600, rename into place. A reader never observes a
 *  partial file, and a crash mid-write never corrupts the previous good copy. The rename retries
 *  briefly on Windows if the destination is momentarily held open (see fs-atomic.ts). */
export async function persistFile(
  file: string,
  data: string,
  lease?: CrossProcessLease
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  if (lease) {
    const current = await readAtomicFileSnapshot(file)
    await writeAtomicFileCompared(file, data, current.revision, lease, { mode: 0o600 })
    return
  }
  await withCrossProcessLock(file, async (lease) => {
    const current = await readAtomicFileSnapshot(file)
    await writeAtomicFileCompared(file, data, current.revision, lease, { mode: 0o600 })
  })
}

/** Whether this shell can seal secrets at rest. Throws when a shell supplies exactly one of the
 *  two hooks — a programming error, the same contract node-auth-secret.ts enforces. */
export function canSeal(): boolean {
  const p = platform()
  const hasSeal = typeof p.sealSecret === 'function'
  const hasUnseal = typeof p.unsealSecret === 'function'
  if (hasSeal !== hasUnseal) {
    throw new Error('CorePlatform must supply both sealSecret and unsealSecret, or neither')
  }
  return hasSeal
}

function deriveHash(pin: string, salt: Buffer): Buffer {
  return scryptSync(pin, salt, SCRYPT_KEYLEN)
}

/** True when a credential file exists for this mode. */
export async function hasCredential(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    // An unreadable credential is still a credential. Propagate unavailable state so callers do
    // not offer first-enable and overwrite the only recoverable hash.
    throw error
  }
}

/** Establish or replace the credential. The caller is responsible for bounds-checking the PIN. */
export async function setCredential(
  file: string,
  pin: string,
  lease?: CrossProcessLease
): Promise<void> {
  const salt = randomBytes(16)
  const hashB64 = deriveHash(pin, salt).toString('base64')
  const sealed = canSeal()
  const hash = sealed
    ? platform().sealSecret!(Buffer.from(hashB64, 'utf8')).toString('base64')
    : hashB64
  const body: StoredCredential = { version: 1, salt: salt.toString('base64'), hash, sealed }
  await persistFile(file, JSON.stringify(body), lease)
}

/**
 * Verify a PIN. Returns false — never throws — for every failure mode, including an unreadable,
 * malformed or unsealable credential. A mode that cannot verify stays locked.
 *
 * Throttled: while a backoff is in effect this returns false WITHOUT looking at the credential at
 * all, so a caller cannot distinguish "wrong PIN" from "still waiting" by timing. Use
 * `retryAfterMs` to tell a user how long is left.
 */
export async function verifyPin(file: string, pin: string): Promise<boolean> {
  if (retryAfterMs(file) > 0) return false
  let stored: StoredCredential
  try {
    stored = JSON.parse(await fs.readFile(file, 'utf-8')) as StoredCredential
  } catch {
    return false
  }
  if (stored?.version !== 1 || typeof stored.salt !== 'string' || typeof stored.hash !== 'string') {
    return false
  }
  let expected: Buffer
  try {
    expected = stored.sealed
      ? Buffer.from(platform().unsealSecret!(Buffer.from(stored.hash, 'base64')).toString('utf8'), 'base64')
      : Buffer.from(stored.hash, 'base64')
  } catch {
    // Unseal fails across a machine migration or a credential-vault reset. "Cannot verify", never a crash.
    return false
  }
  const candidate = deriveHash(pin, Buffer.from(stored.salt, 'base64'))
  const ok = expected.byteLength === candidate.byteLength && timingSafeEqual(expected, candidate)
  if (ok) rate.delete(file)
  else rate.set(file, { fails: (rate.get(file)?.fails ?? 0) + 1, lastFailAt: Date.now() })
  return ok
}

/** Shared PIN bounds check, so two modes cannot disagree about what a valid PIN is. */
export function isAcceptablePin(pin: string | undefined): boolean {
  const t = (pin ?? '').trim()
  return t.length >= MIN_PIN_LENGTH && t.length <= MAX_PIN_LENGTH
}
