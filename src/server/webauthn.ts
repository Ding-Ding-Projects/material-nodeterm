// WebAuthn (passkey) verification for the Server Edition, using Node's own crypto — no new
// dependency, and nothing native.
//
// SCOPE, stated up front so nobody mistakes this for a general-purpose library: this server is
// SINGLE-USER. There is one account, and a passkey is a second way into it beside the password.
// That removes most of what a multi-tenant WebAuthn implementation has to worry about (user
// handles, credential-to-account mapping, account enumeration) and leaves the part that actually
// matters — proving the browser holds the private key for a credential this server registered.
//
// WHAT IS VERIFIED, and what is deliberately not:
//
//   Registration (attestation): the clientDataJSON's type, challenge and origin; the RP ID hash;
//   the user-present flag; and the COSE public key is parsed and kept. The attestation STATEMENT
//   is not verified — this is `attestationType: 'none'`, so there is no signature over the
//   authenticator's provenance to check. That is the right call here: attestation only tells you
//   *what make of authenticator* enrolled, which matters to an enterprise deciding whether a
//   YubiKey is genuine, and not at all to a single-user box where the person registering IS the
//   owner. Pretending to verify it would be worse than not doing it.
//
//   Login (assertion): the clientDataJSON's type, challenge and origin; the RP ID hash; the
//   user-present flag; the ECDSA/RSA signature over authenticatorData || SHA-256(clientDataJSON);
//   and the signature counter, which must not go backwards.
//
// The counter check is the one people skip. An authenticator that reports a counter is supposed
// to increment it every assertion; a counter that goes DOWN (or repeats a non-zero value) means
// the credential has been cloned and two copies are in use. Many modern passkeys report a
// constant 0 and are exempt by spec — so the rule is "reject a decrease, allow a constant zero",
// not "require an increase".

import crypto from 'crypto'

export interface StoredCredential {
  /** base64url credential id, as sent by the browser. */
  id: string
  /** base64url SPKI DER of the credential's public key. */
  publicKeySpki: string
  /** Last signature counter seen. 0 for authenticators that do not implement one. */
  counter: number
  /** Free-text label so a user with several passkeys can tell them apart. */
  label: string
  createdAt: number
}

export function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}
export function bufToB64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * The RP ID is the registrable domain the credential is scoped to. It MUST match the origin the
 * page was served from, or the browser refuses before the server is ever consulted — so derive it
 * from the request's own Host rather than configuring it separately and letting the two drift.
 * Port is excluded (an RP ID is a domain, not an origin); `localhost` is legal as-is.
 */
export function rpIdFromHost(host: string): string {
  return (host || 'localhost').split(':')[0]!.toLowerCase()
}

/** Parse the fixed-layout prefix of authenticatorData. Everything before the attested credential
 *  data is a known size: 32-byte RP ID hash, 1 flag byte, 4-byte counter. */
export function parseAuthData(buf: Buffer): {
  rpIdHash: Buffer
  flags: number
  counter: number
  userPresent: boolean
  userVerified: boolean
  hasAttestedData: boolean
  rest: Buffer
} {
  if (buf.length < 37) throw new Error('authenticatorData is shorter than its fixed 37-byte prefix')
  const flags = buf[32]!
  return {
    rpIdHash: buf.subarray(0, 32),
    flags,
    counter: buf.readUInt32BE(33),
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    hasAttestedData: (flags & 0x40) !== 0,
    rest: buf.subarray(37)
  }
}

// ── minimal CBOR reader ──────────────────────────────────────────────────────────────────────
// Only what an attestation object and a COSE key actually contain: unsigned/negative ints, byte
// strings, text strings, arrays and maps. Written out rather than pulled in as a dependency
// because the alternative is a transitive tree for ~80 lines of parsing.

interface CborResult { value: unknown; next: number }

function cborRead(buf: Buffer, i: number): CborResult {
  if (i >= buf.length) throw new Error('CBOR: truncated')
  const b = buf[i]!
  const major = b >> 5
  const minor = b & 0x1f
  let val = minor
  let p = i + 1
  if (minor === 24) { val = buf[p]!; p += 1 }
  else if (minor === 25) { val = buf.readUInt16BE(p); p += 2 }
  else if (minor === 26) { val = buf.readUInt32BE(p); p += 4 }
  else if (minor === 27) throw new Error('CBOR: 64-bit lengths are not supported here')
  else if (minor > 27) throw new Error(`CBOR: unsupported additional info ${minor}`)

  switch (major) {
    case 0: return { value: val, next: p }
    case 1: return { value: -1 - val, next: p }
    case 2: return { value: buf.subarray(p, p + val), next: p + val }
    case 3: return { value: buf.subarray(p, p + val).toString('utf8'), next: p + val }
    case 4: {
      const arr: unknown[] = []
      for (let k = 0; k < val; k++) { const r = cborRead(buf, p); arr.push(r.value); p = r.next }
      return { value: arr, next: p }
    }
    case 5: {
      const map = new Map<unknown, unknown>()
      for (let k = 0; k < val; k++) {
        const kr = cborRead(buf, p); const vr = cborRead(buf, kr.next)
        map.set(kr.value, vr.value); p = vr.next
      }
      return { value: map, next: p }
    }
    default: throw new Error(`CBOR: unsupported major type ${major}`)
  }
}

export function cborDecodeFirst(buf: Buffer): unknown {
  return cborRead(buf, 0).value
}

/**
 * Convert a COSE_Key into a Node KeyObject, via SPKI DER hand-assembled from the curve/modulus.
 * Supports ES256 (P-256, alg -7) and RS256 (alg -257) — between them these cover every passkey
 * a browser will actually produce. An unsupported algorithm throws by name rather than failing
 * later as a bad signature, because those two failures need very different debugging.
 */
export function coseToSpki(cose: Map<unknown, unknown>): Buffer {
  const kty = cose.get(1)
  const alg = cose.get(3)

  if (kty === 2) {
    // EC2. -1 crv, -2 x, -3 y. Only P-256 is accepted; the DER prefix below encodes exactly that
    // curve's AlgorithmIdentifier, so a different curve would be mislabelled rather than rejected.
    if (alg !== -7) throw new Error(`unsupported EC algorithm ${String(alg)} (only ES256/-7)`)
    if (cose.get(-1) !== 1) throw new Error('unsupported EC curve (only P-256)')
    const x = cose.get(-2) as Buffer
    const y = cose.get(-3) as Buffer
    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) {
      throw new Error('malformed EC public key coordinates')
    }
    const prefix = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex')
    return Buffer.concat([prefix, Buffer.from([0x04]), x, y])
  }

  if (kty === 3) {
    // RSA. -1 n, -2 e.
    if (alg !== -257) throw new Error(`unsupported RSA algorithm ${String(alg)} (only RS256/-257)`)
    const n = cose.get(-1) as Buffer
    const e = cose.get(-2) as Buffer
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e)) throw new Error('malformed RSA public key')
    const der = (tag: number, body: Buffer): Buffer => {
      const len = body.length
      let lenBytes: Buffer
      if (len < 0x80) lenBytes = Buffer.from([len])
      else {
        const tmp: number[] = []
        let v = len
        while (v > 0) { tmp.unshift(v & 0xff); v >>= 8 }
        lenBytes = Buffer.from([0x80 | tmp.length, ...tmp])
      }
      return Buffer.concat([Buffer.from([tag]), lenBytes, body])
    }
    const posInt = (b: Buffer): Buffer => der(0x02, b[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b)
    const rsaKey = der(0x30, Buffer.concat([posInt(n), posInt(e)]))
    const algId = Buffer.from('300d06092a864886f70d0101010500', 'hex')
    const bitStr = der(0x03, Buffer.concat([Buffer.from([0]), rsaKey]))
    return der(0x30, Buffer.concat([algId, bitStr]))
  }

  throw new Error(`unsupported COSE key type ${String(kty)}`)
}

function checkClientData(
  clientDataJSON: Buffer,
  expected: { type: string; challenge: string; origin: string }
): void {
  let parsed: { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean }
  try {
    parsed = JSON.parse(clientDataJSON.toString('utf8'))
  } catch {
    throw new Error('clientDataJSON is not valid JSON')
  }
  if (parsed.type !== expected.type) throw new Error(`clientData.type is "${parsed.type}", expected "${expected.type}"`)
  // Timing-safe compare on the challenge: it is the freshness proof, and a non-constant-time
  // compare on a value an attacker supplies is exactly where a byte-at-a-time oracle lives.
  const a = Buffer.from(String(parsed.challenge))
  const b = Buffer.from(expected.challenge)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('challenge mismatch')
  if (parsed.origin !== expected.origin) throw new Error(`origin is "${parsed.origin}", expected "${expected.origin}"`)
  if (parsed.crossOrigin === true) throw new Error('cross-origin assertion refused')
}

function checkRpIdHash(authData: Buffer, rpId: string): void {
  const { rpIdHash } = parseAuthData(authData)
  const want = crypto.createHash('sha256').update(rpId).digest()
  if (!crypto.timingSafeEqual(rpIdHash, want)) throw new Error('RP ID hash mismatch')
}

/** Verify a registration and return the credential to store. Throws with a specific reason. */
export function verifyRegistration(input: {
  attestationObject: string
  clientDataJSON: string
  expectedChallenge: string
  expectedOrigin: string
  rpId: string
  label: string
}): StoredCredential {
  const clientData = b64urlToBuf(input.clientDataJSON)
  checkClientData(clientData, { type: 'webauthn.create', challenge: input.expectedChallenge, origin: input.expectedOrigin })

  const att = cborDecodeFirst(b64urlToBuf(input.attestationObject))
  if (!(att instanceof Map)) throw new Error('attestationObject is not a CBOR map')
  const authData = att.get('authData')
  if (!Buffer.isBuffer(authData)) throw new Error('attestationObject has no authData')

  checkRpIdHash(authData, input.rpId)
  const parsed = parseAuthData(authData)
  if (!parsed.userPresent) throw new Error('user-present flag was not set')
  if (!parsed.hasAttestedData) throw new Error('no attested credential data in authData')

  // Attested credential data: 16-byte AAGUID, 2-byte credential id length, the id, then the
  // COSE public key occupying the remainder.
  const rest = parsed.rest
  if (rest.length < 18) throw new Error('attested credential data is truncated')
  const idLen = rest.readUInt16BE(16)
  const credId = rest.subarray(18, 18 + idLen)
  if (credId.length !== idLen) throw new Error('credential id is truncated')
  const cose = cborDecodeFirst(rest.subarray(18 + idLen))
  if (!(cose instanceof Map)) throw new Error('COSE public key is not a CBOR map')

  return {
    id: bufToB64url(credId),
    publicKeySpki: coseToSpki(cose).toString('base64'),
    counter: parsed.counter,
    label: input.label,
    createdAt: Date.now()
  }
}

/**
 * Verify a login assertion against a stored credential. Returns the new counter to persist.
 * Throws with a specific reason on any failure — the caller turns that into a generic message for
 * the user, but the specific one belongs in the server log.
 */
export function verifyAssertion(input: {
  credential: StoredCredential
  authenticatorData: string
  clientDataJSON: string
  signature: string
  expectedChallenge: string
  expectedOrigin: string
  rpId: string
}): { newCounter: number } {
  const clientData = b64urlToBuf(input.clientDataJSON)
  checkClientData(clientData, { type: 'webauthn.get', challenge: input.expectedChallenge, origin: input.expectedOrigin })

  const authData = b64urlToBuf(input.authenticatorData)
  checkRpIdHash(authData, input.rpId)
  const parsed = parseAuthData(authData)
  if (!parsed.userPresent) throw new Error('user-present flag was not set')

  const spki = Buffer.from(input.credential.publicKeySpki, 'base64')
  const key = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' })
  const signed = Buffer.concat([authData, crypto.createHash('sha256').update(clientData).digest()])
  const sig = b64urlToBuf(input.signature)

  // Node picks the right scheme from the key type; both ES256 and RS256 sign SHA-256 here. The
  // DER-encoded ECDSA signature a WebAuthn authenticator emits is what verify() expects by
  // default, so no re-encoding is needed.
  const ok = crypto.verify('sha256', signed, key, sig)
  if (!ok) throw new Error('signature did not verify')

  // A counter that goes backwards means two copies of one credential are in circulation. A
  // constant zero is normal and explicitly allowed — most platform passkeys never increment.
  if (parsed.counter !== 0 && parsed.counter <= input.credential.counter) {
    throw new Error(
      `signature counter did not advance (${input.credential.counter} -> ${parsed.counter}); ` +
        'the credential may have been cloned'
    )
  }
  return { newCounter: parsed.counter }
}
