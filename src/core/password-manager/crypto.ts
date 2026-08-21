// Real (non-toy) credential encryption: a memory-hard KDF over the project password, and
// authenticated encryption for every credential secret it protects. This is deliberately a
// different, stronger contract than core/toylocks/toylock-service.ts's scrypt parameters — that
// module says outright "THIS IS NOT SECURITY"; a password manager's own words are the opposite of
// that, so its KDF costs real memory and real time to brute-force rather than a for-fun speed
// bump. Electron-free (only node:crypto) — see ../no-electron.test.ts.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import type { EncryptedPayload, VaultKdfParams } from '../../shared/password-manager'

/**
 * 128 MiB of scrypt memory cost (`128 * N * r` bytes — the standard scrypt memory formula), tuned
 * so deriving a key takes on the order of a few hundred milliseconds on ordinary hardware and an
 * attacker has to actually pay that cost in full per guess, not just CPU time. `keylen` is 32
 * bytes — exactly what AES-256-GCM needs as a key.
 */
export const DEFAULT_KDF_PARAMS: VaultKdfParams = { N: 131072, r: 8, p: 1, keylen: 32 }

export function memoryCostBytes(params: VaultKdfParams): number {
  return 128 * params.N * params.r
}

/** node's `crypto.scryptSync` defaults `maxmem` to 32 MiB, which is smaller than what
 *  DEFAULT_KDF_PARAMS costs (128 MiB) — every call below raises it explicitly rather than
 *  silently letting scrypt refuse, or (worse) silently accepting whatever weaker parameters
 *  happened to fit under the default. */
function maxmemFor(params: VaultKdfParams): number {
  return Math.max(64 * 1024 * 1024, memoryCostBytes(params) + 4 * 1024 * 1024)
}

export function newSalt(): Buffer {
  return randomBytes(16)
}

/** Derive the AES-256-GCM key `password` implies under `params`/`saltB64`. Pure and deterministic
 *  — the SAME inputs always produce the SAME key, which is exactly what lets a teammate on
 *  another machine unlock the same vault with the same password (see shared/password-manager.ts's
 *  `VaultFileV1.salt`/`kdf`, both non-secret and git-shared). */
export function deriveVaultKey(password: string, saltB64: string, params: VaultKdfParams): Buffer {
  const salt = Buffer.from(saltB64, 'base64')
  return scryptSync(password, salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: maxmemFor(params)
  })
}

export class VaultCryptoError extends Error {
  readonly code = 'vault-crypto-error' as const

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options)
  }
}

// AES-GCM's recommended (and node's only supported) nonce length.
const IV_LEN = 12

/** Encrypt an arbitrary JSON-serializable payload under `key` with a fresh random nonce. Never
 *  throws on its own inputs — a bad `key` length is the one case node itself refuses, and that
 *  refusal is a programming error (a wrong-LENGTH key, not a wrong-VALUE one), so it is left to
 *  propagate rather than folded into VaultCryptoError. */
export function encryptPayload(key: Buffer, payload: unknown): EncryptedPayload {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const json = Buffer.from(JSON.stringify(payload), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(json), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    v: 1,
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64')
  }
}

/**
 * Decrypt an `EncryptedPayload` produced by `encryptPayload`. Throws `VaultCryptoError` on ANY
 * failure — a wrong key and a tampered/corrupted ciphertext are DELIBERATELY indistinguishable
 * here: node's GCM implementation refuses to release any plaintext once authentication fails, and
 * this module must never try to tell the two apart (there is nothing left to inspect once
 * `decipher.final()` has thrown — no partial output, no timing signal worth trusting).
 */
export function decryptPayload<T>(key: Buffer, payload: EncryptedPayload): T {
  try {
    const iv = Buffer.from(payload.iv, 'base64')
    const tag = Buffer.from(payload.tag, 'base64')
    const ciphertext = Buffer.from(payload.ciphertext, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const json = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return JSON.parse(json.toString('utf8')) as T
  } catch (cause) {
    throw new VaultCryptoError('Could not decrypt: wrong password, or the data was tampered with.', {
      cause
    })
  }
}
