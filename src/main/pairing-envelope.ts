// Pure authenticated-envelope helpers for the LAN phone-pairing exchange.
//
// The QR authenticates the host's long-lived NaCl public key by showing it on the machine being
// paired. The client uses a fresh ephemeral key for this request, and both request and response
// are sealed under the resulting shared key. Keeping the envelope decision here makes it
// impossible for the HTTP service to accidentally parse a plaintext success request when it has
// advertised `hostKey`.

import { decrypt, deriveSharedKey, encrypt, type KeyPair } from './remote/e2ee'

export interface PairingRequestBody {
  token?: unknown
  publicKey?: unknown
  deviceName?: unknown
  deviceId?: unknown
  priorDeviceToken?: unknown
}

export type PairingEnvelopeOpenResult =
  | { ok: true; body: PairingRequestBody; sharedKey: Uint8Array }
  | {
      ok: false
      reason: 'encrypted pairing required' | 'bad epk' | 'decrypt failed' | 'bad json'
    }

/**
 * Buffer.from(value, 'base64') is intentionally permissive: it ignores junk characters and
 * accepts non-canonical padding. A pairing envelope is a security boundary, so accept exactly the
 * standard-base64 spelling our peers emit and nothing else.
 */
function decodeCanonicalBase64(value: string): Uint8Array | null {
  if (!value || value.length % 4 !== 0) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) return null
  return Uint8Array.from(decoded)
}

/**
 * Open the mandatory `{epk,box}` request envelope. There is deliberately no plaintext branch:
 * once a QR advertises `hostKey`, accepting `{token,publicKey}` directly would return the
 * long-lived agent and relay bearers over unauthenticated LAN HTTP.
 */
export function openPairingEnvelope(
  outer: unknown,
  hostKeys: KeyPair
): PairingEnvelopeOpenResult {
  if (!outer || typeof outer !== 'object' || Array.isArray(outer)) {
    return { ok: false, reason: 'encrypted pairing required' }
  }
  const envelope = outer as { epk?: unknown; box?: unknown }
  if (typeof envelope.epk !== 'string' || typeof envelope.box !== 'string') {
    return { ok: false, reason: 'encrypted pairing required' }
  }
  if (!decodeCanonicalBase64(envelope.epk)) return { ok: false, reason: 'bad epk' }
  const box = decodeCanonicalBase64(envelope.box)
  if (!box) return { ok: false, reason: 'decrypt failed' }

  let sharedKey: Uint8Array
  try {
    sharedKey = deriveSharedKey(envelope.epk, hostKeys.secretKey)
  } catch {
    return { ok: false, reason: 'bad epk' }
  }
  const plain = decrypt(box, sharedKey)
  if (!plain) return { ok: false, reason: 'decrypt failed' }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(plain).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'bad json' }
    }
    return { ok: true, body: parsed as PairingRequestBody, sharedKey }
  } catch {
    return { ok: false, reason: 'bad json' }
  }
}

/** Seal a success response. The only JSON field outside the ciphertext is the box itself. */
export function sealPairingResponse(
  response: Record<string, unknown>,
  sharedKey: Uint8Array
): { box: string } {
  const plain = Uint8Array.from(Buffer.from(JSON.stringify(response), 'utf8'))
  return { box: Buffer.from(encrypt(plain, sharedKey)).toString('base64') }
}
