// site/app/shared/crypto.js
//
// Small SubtleCrypto helpers used by School mode's PIN and by toy locks.
// Nothing here is a real security boundary (both features say so in their
// own copy) — it exists so the site never stores a PIN/password in the
// clear, and verifies against a hash instead. All of it runs locally;
// nothing is ever sent anywhere.

function toHex(buffer) {
  const bytes = new Uint8Array(buffer)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export async function sha256Hex(text) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error('crypto.subtle is unavailable in this browser')
  }
  const data = new TextEncoder().encode(text)
  const digest = await window.crypto.subtle.digest('SHA-256', data)
  return toHex(digest)
}

export function randomSaltHex(byteLength = 16) {
  const bytes = new Uint8Array(byteLength)
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes)
  } else {
    // Extremely unlikely fallback (very old browser) — still never blocks
    // the page. Not cryptographically strong, but this is a toy lock, not
    // a security boundary, so a degraded fallback is honest here.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return toHex(bytes.buffer)
}

/** Hashes a secret with a per-credential salt. Never store the secret itself. */
export async function hashSecret(secret, saltHex) {
  return sha256Hex(saltHex + ':' + secret)
}

export async function verifySecret(secret, saltHex, expectedHashHex) {
  const actual = await hashSecret(secret, saltHex)
  return timingSafeEqual(actual, expectedHashHex)
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function randomId(prefix = 'id') {
  const bytes = new Uint8Array(8)
  if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return prefix + '-' + toHex(bytes.buffer)
}
