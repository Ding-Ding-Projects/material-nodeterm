// site/app/shared/crypto.js
//
// Local-only crypto helpers used by the toy-lock gate (SHA-256 password
// hashing) and the built-in authenticator (base32 decode + HMAC-SHA1 TOTP,
// RFC 6238 / RFC 4226). Nothing here ever leaves the browser: no network
// call, no telemetry.

export async function sha256Hex(text) {
  try {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)))
    return Array.from(new Uint8Array(bytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch (_err) {
    // Web Crypto unavailable (very old browser, or a non-secure context).
    // Fail to a clearly-not-a-real-hash marker rather than throwing, so a
    // toy lock still "works" (as a speed bump) instead of crashing the page.
    return 'plain:' + text
  }
}

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function b32decode(input) {
  const clean = String(input).toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = ''
  for (let i = 0; i < clean.length; i++) {
    const v = B32_ALPHABET.indexOf(clean[i])
    if (v < 0) continue
    bits += v.toString(2).padStart(5, '0')
  }
  const out = []
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2))
  return new Uint8Array(out)
}

// A TOTP code (RFC 6238) over the given base32 secret, using the current
// 30-second time step and SHA-1 (the near-universal default every real
// authenticator app also uses for compatibility).
export async function totp(secretBase32) {
  try {
    const key = await crypto.subtle.importKey('raw', b32decode(secretBase32), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
    const counter = Math.floor(Date.now() / 30000)
    const buf = new ArrayBuffer(8)
    const view = new DataView(buf)
    view.setUint32(0, Math.floor(counter / 4294967296))
    view.setUint32(4, counter >>> 0)
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf))
    const offset = sig[sig.length - 1] & 0xf
    const bin = ((sig[offset] & 0x7f) << 24) | (sig[offset + 1] << 16) | (sig[offset + 2] << 8) | sig[offset + 3]
    return String(bin % 1000000).padStart(6, '0')
  } catch (_err) {
    return '––––––'
  }
}

// Seconds remaining until the current 30s TOTP window rolls over — drives
// the "Ns left" countdown on each code row.
export function totpSecondsLeft() {
  return 30 - (Math.floor(Date.now() / 1000) % 30)
}
