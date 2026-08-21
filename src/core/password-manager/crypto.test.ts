import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KDF_PARAMS,
  VaultCryptoError,
  decryptPayload,
  deriveVaultKey,
  encryptPayload,
  memoryCostBytes,
  newSalt
} from './crypto'

// Small, fast KDF params for the test suite — same shape as DEFAULT_KDF_PARAMS, far cheaper so the
// suite doesn't pay 128 MiB of scrypt on every assertion. The MEMORY-COST arithmetic itself is
// still exercised directly against DEFAULT_KDF_PARAMS below.
const FAST = { N: 1024, r: 4, p: 1, keylen: 32 }

describe('memoryCostBytes', () => {
  it('is 128 * N * r bytes — the standard scrypt memory formula', () => {
    expect(memoryCostBytes(DEFAULT_KDF_PARAMS)).toBe(128 * DEFAULT_KDF_PARAMS.N * DEFAULT_KDF_PARAMS.r)
    expect(memoryCostBytes(DEFAULT_KDF_PARAMS)).toBe(128 * 1024 * 1024) // 128 MiB, as documented
  })
})

describe('deriveVaultKey', () => {
  it('is deterministic: the same password/salt/params always derive the same key', () => {
    const salt = newSalt().toString('base64')
    const a = deriveVaultKey('correct horse', salt, FAST)
    const b = deriveVaultKey('correct horse', salt, FAST)
    expect(a.equals(b)).toBe(true)
    expect(a).toHaveLength(FAST.keylen)
  })

  it('a different password derives a different key', () => {
    const salt = newSalt().toString('base64')
    const a = deriveVaultKey('correct horse', salt, FAST)
    const b = deriveVaultKey('wrong horse', salt, FAST)
    expect(a.equals(b)).toBe(false)
  })

  it('a different salt derives a different key from the SAME password', () => {
    const a = deriveVaultKey('correct horse', newSalt().toString('base64'), FAST)
    const b = deriveVaultKey('correct horse', newSalt().toString('base64'), FAST)
    expect(a.equals(b)).toBe(false)
  })
})

describe('encryptPayload / decryptPayload', () => {
  it('round-trips an arbitrary JSON payload', () => {
    const key = deriveVaultKey('pw', newSalt().toString('base64'), FAST)
    const payload = { username: 'alice', password: 'hunter2', totpSecretBase32: 'JBSWY3DPEHPK3PXP' }
    const enc = encryptPayload(key, payload)
    expect(decryptPayload(key, enc)).toEqual(payload)
  })

  it('the ciphertext never contains the plaintext secret as a substring', () => {
    const key = deriveVaultKey('pw', newSalt().toString('base64'), FAST)
    const enc = encryptPayload(key, { password: 'hunter2-the-very-secret-password' })
    const wire = JSON.stringify(enc)
    expect(wire).not.toContain('hunter2')
  })

  it('two encryptions of the SAME payload under the SAME key produce DIFFERENT ciphertext (fresh nonce)', () => {
    const key = deriveVaultKey('pw', newSalt().toString('base64'), FAST)
    const a = encryptPayload(key, { x: 1 })
    const b = encryptPayload(key, { x: 1 })
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('a WRONG key throws VaultCryptoError rather than returning garbage plaintext', () => {
    const salt = newSalt().toString('base64')
    const rightKey = deriveVaultKey('right', salt, FAST)
    const wrongKey = deriveVaultKey('wrong', salt, FAST)
    const enc = encryptPayload(rightKey, { secret: 'value' })
    expect(() => decryptPayload(wrongKey, enc)).toThrow(VaultCryptoError)
  })

  it('a TAMPERED ciphertext is rejected by the auth tag', () => {
    const key = deriveVaultKey('pw', newSalt().toString('base64'), FAST)
    const enc = encryptPayload(key, { secret: 'value' })
    // Flip one bit of the ciphertext's first byte.
    const bytes = Buffer.from(enc.ciphertext, 'base64')
    bytes[0] ^= 0xff
    const tampered = { ...enc, ciphertext: bytes.toString('base64') }
    expect(() => decryptPayload(key, tampered)).toThrow(VaultCryptoError)
  })

  it('a TAMPERED auth tag is rejected', () => {
    const key = deriveVaultKey('pw', newSalt().toString('base64'), FAST)
    const enc = encryptPayload(key, { secret: 'value' })
    const bytes = Buffer.from(enc.tag, 'base64')
    bytes[0] ^= 0xff
    const tampered = { ...enc, tag: bytes.toString('base64') }
    expect(() => decryptPayload(key, tampered)).toThrow(VaultCryptoError)
  })

  it('a tampered IV also fails to authenticate (wrong nonce for this ciphertext)', () => {
    const key = deriveVaultKey('pw', newSalt().toString('base64'), FAST)
    const enc = encryptPayload(key, { secret: 'value' })
    const bytes = Buffer.from(enc.iv, 'base64')
    bytes[0] ^= 0xff
    const tampered = { ...enc, iv: bytes.toString('base64') }
    expect(() => decryptPayload(key, tampered)).toThrow(VaultCryptoError)
  })
})

describe('newSalt', () => {
  it('produces 16 random bytes, different every call', () => {
    const a = newSalt()
    const b = newSalt()
    expect(a).toHaveLength(16)
    expect(a.equals(b)).toBe(false)
  })
})
