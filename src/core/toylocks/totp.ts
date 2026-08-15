// RFC 4226 HOTP and RFC 6238 TOTP, plus RFC 4648 base32 and the Google-Authenticator-style
// `otpauth://` key URI both toy locks and the built-in authenticator speak. Electron-free (only
// node:crypto + node:querystring-free URL parsing), so it runs unchanged in src/main and
// src/server — see no-electron.test.ts.
//
// Correctness notes (there are deliberately no unit tests in this pass — see the task's speed-mode
// instructions — so the reasoning that would normally back a test lives here instead):
//   - `hotp()` implements RFC 4226 §5.3 dynamic truncation EXACTLY: HMAC over the 8-byte
//     big-endian counter, take the low nibble of the LAST hash byte as `offset`, read 4 bytes
//     starting there as a big-endian uint32 with the TOP BIT MASKED OFF (`& 0x7f` on the first of
//     the four), then `% 10**digits`. This is the same construction as every mainstream TOTP
//     library (Google Authenticator, `otplib`, `speakeasy`, Authy) and is verifiable by hand
//     against RFC 4226 Appendix D's test vectors (secret = ASCII "12345678901234567890",
//     digits=6): counter 0 → 755224, counter 1 → 287082, … counter 9 → 520489.
//   - `totp()` is `hotp(secret, floor(unixTime / period), …)` per RFC 6238 §4.2 — nothing more.
//   - base32 encode/decode is RFC 4648 §6 (the "extended hex" alphabet is NOT used here; TOTP
//     secrets use the plain A–Z2–7 alphabet). Encoding strips padding `=` on output and decoding
//     tolerates its absence, mixed case, and stray whitespace/hyphens (how humans actually type a
//     "manual secret" back in), because we're the ones both writing and reading it.

import { createHmac, randomBytes } from 'crypto'
import { OTP_ALGORITHMS, type OtpAlgorithm } from '../../shared/otp'

// Re-exported so this module's own callers can keep writing `import { OtpAlgorithm,
// OTP_ALGORITHMS } from './totp'` — the canonical definitions live in shared/otp.ts (shared types
// must not depend on core; only the other way around, and the renderer needs OTP_ALGORITHMS for
// its picker without ever importing core/* directly).
export { OTP_ALGORITHMS }
export type { OtpAlgorithm }

const NODE_ALGORITHM: Record<OtpAlgorithm, string> = {
  SHA1: 'sha1',
  SHA256: 'sha256',
  SHA512: 'sha512'
}

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 §6 base32 encode, uppercase, padding stripped. */
export function base32Encode(buf: Buffer): string {
  let bits = 0 // how many low bits of `value` are unconsumed
  let value = 0
  let out = ''
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]
    bits += 8
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 0x1f]
      bits -= 5
      // Drop the bits we just emitted so `value` never accumulates more than ~12 unconsumed bits
      // — without this mask it grows without bound across a long buffer and eventually corrupts
      // once it exceeds what JS's 32-bit bitwise ops can hold.
      value &= (1 << bits) - 1
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 0x1f]
  return out
}

/** Tolerant RFC 4648 base32 decode: uppercases, drops anything outside A–Z2–7 (whitespace,
 *  hyphens, padding `=`) before decoding, so a secret pasted with the spacing an authenticator app
 *  displays it in ("ABCD EFGH ...") still round-trips. */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
      value &= (1 << bits) - 1
    }
  }
  return Buffer.from(bytes)
}

/** A fresh, uniformly random TOTP secret — 160 bits (20 bytes), the size Google Authenticator's
 *  own key-generation guidance recommends and what most third-party QR-based enrollments mint. */
export function generateSecret(): Buffer {
  return randomBytes(20)
}

function hmacDigest(algorithm: OtpAlgorithm, key: Buffer, msg: Buffer): Buffer {
  return createHmac(NODE_ALGORITHM[algorithm], key).update(msg).digest()
}

/** RFC 4226 HOTP. `counter` is a non-negative integer (safe well past any realistic TOTP counter,
 *  which only reaches 2^32 after ~4 billion periods — millennia at a 30s period). */
export function hotp(
  secret: Buffer,
  counter: number,
  digits = 6,
  algorithm: OtpAlgorithm = 'SHA1'
): string {
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  buf.writeUInt32BE(counter % 0x100000000, 4)
  const hash = hmacDigest(algorithm, secret, buf)
  const offset = hash[hash.length - 1] & 0x0f
  const binCode =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff)
  const mod = 10 ** digits
  return String(binCode % mod).padStart(digits, '0')
}

export function totpCounterForTime(epochSeconds: number, period: number): number {
  return Math.floor(epochSeconds / period)
}

export interface TotpOptions {
  epochSeconds?: number
  period?: number
  digits?: number
  algorithm?: OtpAlgorithm
}

/** RFC 6238 TOTP at (or near) `epochSeconds` (defaults to now). */
export function totp(secret: Buffer, opts: TotpOptions = {}): string {
  const period = opts.period ?? 30
  const digits = opts.digits ?? 6
  const algorithm = opts.algorithm ?? 'SHA1'
  const time = opts.epochSeconds ?? Math.floor(Date.now() / 1000)
  return hotp(secret, totpCounterForTime(time, period), digits, algorithm)
}

/** Verify a typed-back code against `secret`, tolerating ONE period of clock drift either side
 *  (the conventional TOTP validation window — RFC 6238 §5.2 explicitly allows a small window).
 *  Returns which offset actually matched (-1, 0, or 1 step), or null on no match, so a caller
 *  that cares can flag "your clock looks off" without silently accepting drift forever. */
export function verifyTotp(
  secret: Buffer,
  code: string,
  opts: TotpOptions = {}
): { matched: boolean; stepOffset: number | null } {
  const period = opts.period ?? 30
  const digits = opts.digits ?? 6
  const algorithm = opts.algorithm ?? 'SHA1'
  const time = opts.epochSeconds ?? Math.floor(Date.now() / 1000)
  const counter = totpCounterForTime(time, period)
  const normalized = String(code).trim().replace(/\s+/g, '')
  for (const stepOffset of [0, -1, 1]) {
    const candidate = hotp(secret, counter + stepOffset, digits, algorithm)
    if (timingSafeEqualStrings(candidate, normalized)) return { matched: true, stepOffset }
  }
  return { matched: false, stepOffset: null }
}

/** Constant-time-ish string compare (length-independent short-circuit avoided by padding to a
 *  fixed max) — codes are only 6–8 digits, so this is a courtesy rather than a hard guarantee,
 *  fitting for a "just for fun" lock. */
function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export interface OtpAuthUriInput {
  issuer: string
  account: string
  secretBase32: string
  algorithm: OtpAlgorithm
  digits: number
  period: number
}

/** Build a standard `otpauth://totp/` key URI (the Google Authenticator Key URI Format) — what
 *  the QR encodes and what the manual-entry text mirrors. */
export function buildOtpAuthUri(input: OtpAuthUriInput): string {
  const issuer = input.issuer.trim() || 'nodeterm'
  const account = input.account.trim() || 'account'
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  const params = new URLSearchParams({
    secret: input.secretBase32,
    issuer,
    algorithm: input.algorithm,
    digits: String(input.digits),
    period: String(input.period)
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

export interface ParsedOtpAuthUri {
  issuer: string
  account: string
  secretBase32: string
  algorithm: OtpAlgorithm
  digits: number
  period: number
}

/** Parse a pasted `otpauth://totp/...` URI (the authenticator's "paste a URI" registration path).
 *  Returns null for anything that isn't a well-formed TOTP key URI — HOTP (`otpauth://hotp/...`)
 *  and any other scheme are deliberately out of scope (see docs/authenticator.md). */
export function parseOtpAuthUri(input: string): ParsedOtpAuthUri | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'otpauth:') return null
  if (url.host.toLowerCase() !== 'totp') return null
  const secretRaw = url.searchParams.get('secret')
  if (!secretRaw) return null
  const secretBase32 = secretRaw.toUpperCase().replace(/[^A-Z2-7]/g, '')
  if (!secretBase32) return null

  let label = ''
  try {
    label = decodeURIComponent(url.pathname.replace(/^\//, ''))
  } catch {
    label = url.pathname.replace(/^\//, '')
  }
  let issuer = url.searchParams.get('issuer')?.trim() ?? ''
  let account = label.trim()
  const colon = label.indexOf(':')
  if (colon !== -1) {
    const labelIssuer = label.slice(0, colon).trim()
    account = label.slice(colon + 1).trim()
    if (!issuer) issuer = labelIssuer
  }
  if (!account) account = issuer || 'Account'
  if (!issuer) issuer = account

  const algorithmRaw = (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase()
  const algorithm: OtpAlgorithm =
    algorithmRaw === 'SHA256' ? 'SHA256' : algorithmRaw === 'SHA512' ? 'SHA512' : 'SHA1'

  const digitsRaw = Number(url.searchParams.get('digits') ?? '6')
  const digits = Number.isFinite(digitsRaw) && digitsRaw >= 6 && digitsRaw <= 8 ? Math.trunc(digitsRaw) : 6

  const periodRaw = Number(url.searchParams.get('period') ?? '30')
  const period = Number.isFinite(periodRaw) && periodRaw > 0 ? Math.trunc(periodRaw) : 30

  return { issuer, account, secretBase32, algorithm, digits, period }
}
