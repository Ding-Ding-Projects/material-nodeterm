import { describe, expect, it } from 'vitest'
import {
  EncryptedArchiveError,
  decryptArchive,
  encryptArchive,
  looksLikeEncryptedArchive
} from './project-archive-encryption'

// scrypt at the password manager's parameters costs 128 MiB and a few hundred ms per derivation by
// design, so every case below pays for one or two — hence the raised timeout rather than a weaker
// KDF for tests, which would test something the product does not do.
const SLOW = 30_000

// A stand-in for the finished ZIP container: starts with the real `PK` signature and carries bytes
// that are not valid UTF-8, so a route that treated the archive as text would fail here.
const archive = (): Buffer => Buffer.concat([Buffer.from('PK'), Buffer.from([0xff, 0x00, 0xfe, 0x7f])])

describe('encrypted project archives', () => {
  it('round-trips the container bytes exactly', { timeout: SLOW }, () => {
    const original = archive()
    const sealed = encryptArchive(original, 'correct horse battery')
    const opened = decryptArchive(sealed, 'correct horse battery')
    expect(opened.ok && opened.archive.equals(original)).toBe(true)
  })

  it('leaks nothing about the archive it wrapped', { timeout: SLOW }, () => {
    // The ZIP signature is what every "is this an archive?" check looks for; if it survived into
    // the protected file, the file's own contents would be identifiable at a glance.
    const sealed = encryptArchive(Buffer.from('PKsecret-project-name'), 'pw')
    expect(sealed.toString('utf-8')).not.toContain('secret-project-name')
    expect(sealed.subarray(0, 2).toString('utf-8')).not.toBe('PK')
  })

  it('refuses a wrong password without throwing', { timeout: SLOW }, () => {
    const sealed = encryptArchive(archive(), 'right')
    expect(decryptArchive(sealed, 'wrong')).toEqual({ ok: false, error: 'wrong-password' })
  })

  it('refuses a tampered file exactly as it refuses a wrong password', { timeout: SLOW }, () => {
    const sealed = JSON.parse(encryptArchive(archive(), 'pw').toString('utf-8'))
    const flipped = Buffer.from(sealed.payload.ciphertext, 'base64')
    flipped[0] ^= 0xff
    sealed.payload.ciphertext = flipped.toString('base64')
    expect(decryptArchive(Buffer.from(JSON.stringify(sealed)), 'pw')).toEqual({
      ok: false,
      error: 'wrong-password'
    })
  })

  it('recognises a protected file, a plain archive, and something else entirely', () => {
    const sealed = encryptArchive(archive(), 'pw')
    expect(looksLikeEncryptedArchive(sealed)).toBe(true)
    expect(looksLikeEncryptedArchive(archive())).toBe(false)
    expect(looksLikeEncryptedArchive(Buffer.from('{"name":"some-other.json"}'))).toBe(false)
    expect(looksLikeEncryptedArchive(Buffer.alloc(0))).toBe(false)
  })

  it('reports a damaged envelope as damaged, never as a wrong password', () => {
    // The failure that must not be laundered into "wrong password": the user would retype a
    // correct password forever against a file no password can open.
    expect(() => decryptArchive(Buffer.from('not json at all'), 'pw')).toThrow(EncryptedArchiveError)
    expect(() =>
      decryptArchive(
        Buffer.from(JSON.stringify({ kind: 'nodeterm-project-encrypted', version: 1, salt: 's' })),
        'pw'
      )
    ).toThrow(/key settings/)
  })

  it('refuses to write a protected file with an empty password', () => {
    expect(() => encryptArchive(archive(), '')).toThrow(/needs a password/)
  })
})
