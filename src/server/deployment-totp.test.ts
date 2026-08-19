import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { base32Decode, base32Encode, totp } from '../core/toylocks/totp'
import { Auth } from './auth'

let root = ''
afterEach(() => {
  delete process.env.NODETERM_TOTP_SECRET_FILE
  if (root) rmSync(root, { recursive: true, force: true })
  root = ''
})

describe('deployment TOTP login', () => {
  it('admits one current code through the normal bounded login path and refuses replay', async () => {
    root = mkdtempSync(path.join(tmpdir(), 'nodeterm-deployment-totp-'))
    const secret = base32Encode(Buffer.from('12345678901234567890'))
    const secretFile = path.join(root, 'totp.secret')
    writeFileSync(secretFile, secret, { mode: 0o600 })
    process.env.NODETERM_TOTP_SECRET_FILE = secretFile
    const now = 1_700_000_000_000
    const auth = new Auth(root, { now: () => now })
    const code = totp(base32Decode(secret), { epochSeconds: now / 1000 })

    await expect(auth.attemptPassword('peer-a', code)).resolves.toBe('success')
    await expect(auth.attemptPassword('peer-b', code)).resolves.toBe('invalid')
  })
})
