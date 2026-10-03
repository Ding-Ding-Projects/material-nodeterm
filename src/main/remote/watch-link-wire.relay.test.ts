import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import nacl from 'tweetnacl'
import { decrypt, deriveSessionKey, encrypt, randomSessionNonce } from './e2ee'
import { hkdfSha256 } from '../../shared/watch-link/hkdf'
import { sealBox, openBox, NONCE_BYTES, RELAY_SESSION_INFO } from '../../shared/watch-link/wire'
import { concatBytes, utf8 } from '../../shared/watch-link/bytes'

// The live-link wire rules (src/shared/watch-link/wire.ts) are a copy of the relay's session crypto,
// written without Node so a browser can run them. Upstream keeps these cases in
// src/core/watch-link/wire.test.ts beside its src/core/relay/e2ee.ts; this fork's relay e2ee module is
// src/main/remote/e2ee.ts (byte-identical to upstream's core copy), and src/core may not import from
// src/main, so the cross-checks against the relay's own code live here.
describe('the live-link wire rules match this relay', () => {
  it("HKDF info and salt order equal the relay's deriveSessionKey", async () => {
    // The test above feeds OUR info string to both sides, so it cannot see the relay's change.
    // This one derives the relay's session key from its own code: salt = hostNonce ‖ clientNonce.
    const base = nacl.randomBytes(32), hn = randomSessionNonce(), cn = randomSessionNonce()
    expect(await hkdfSha256(base, concatBytes(hn, cn), utf8(RELAY_SESSION_INFO), 32)).toEqual(deriveSessionKey(base, hn, cn))
  })
  it("the session-key vectors nodeterm-web tests against are the relay's deriveSessionKey", () => {
    const vectors = JSON.parse(readFileSync(join(__dirname, '../../shared/watch-link/vectors.json'), 'utf8').replace(/\r\n/g, '\n'))
    const hex = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, 'hex'))
    expect(vectors.sessionKeys.length).toBeGreaterThan(0)
    for (const v of vectors.sessionKeys) {
      const key = deriveSessionKey(hex(v.baseKeyHex), hex(v.hostNonceHex), hex(v.clientNonceHex))
      expect(Buffer.from(key).toString('hex')).toBe(v.sessionKeyHex)
    }
  })
  it("the session nonce is as long as e2ee's randomSessionNonce", () => {
    expect(randomSessionNonce()).toHaveLength(NONCE_BYTES)
  })
  it('a box sealed here opens with e2ee.decrypt and vice versa', () => {
    const key = nacl.randomBytes(32), plain = utf8('hello')
    expect(decrypt(sealBox(plain, key), key)).toEqual(plain)
    expect(openBox(encrypt(plain, key), key)).toEqual(plain)
    expect(openBox(Uint8Array.of(1, 2, 3), key)).toBeNull()
  })
})
