// Text decoding shared by every wsl.exe-driven module.
//
// wsl.exe is inconsistent about the encoding it writes to stdout/stderr: the native Windows-side
// subcommands (--list, --status, --install) commonly emit UTF-16LE, sometimes with a BOM and
// sometimes without one, while a command that execs straight into the Linux side (wslpath, a
// guest shell) emits UTF-8. Guessing wrong turns every other name into mojibake, so every reader in
// this package goes through one sniffing decoder instead of assuming a fixed codec.

// Built from character codes rather than a literal BOM/replacement-char escape in source: this file has
// twice had those escapes silently materialize into the real Unicode character on disk instead of
// staying a four-character escape sequence, which then makes the "strip a leading BOM" regex
// literally start with a BOM instead of matching one. Building the string at runtime sidesteps
// whatever in the authoring pipeline does that.
const BOM_CHAR = String.fromCharCode(0xfeff)
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd)
const NUL_CHAR = String.fromCharCode(0)

/** Matches an ASCII control character: 0x00-0x1F or 0x7F. Written with \x, never \u (see above). */
const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/

/**
 * Decode a raw wsl.exe command result buffer into text.
 *
 * Order of decisions:
 *  1. A UTF-16LE BOM (FF FE) or UTF-8 BOM (EF BB BF) is authoritative when present.
 *  2. Otherwise, sniff: UTF-16LE text is dense with NUL bytes at odd offsets (ASCII text encoded
 *     as UTF-16LE has a NUL every other byte), and a CRLF line ending encoded as UTF-16LE produces
 *     the literal 4-byte sequence 0D 00 0A 00. Either signal selects UTF-16LE; the absence of both
 *     defaults to UTF-8, which is also what a zero-length or short buffer decodes to.
 *
 * Never silently drops an interior NUL after decoding: a NUL surviving into the decoded string
 * means the sniff picked the wrong codec (or the source data is corrupt), and folding it away
 * would risk turning hostile or truncated bytes into a plausible-looking but wrong name.
 */
export function decodeWslText(raw: Buffer): string {
  if (raw.length === 0) return ''

  let encoding: 'utf16le' | 'utf8' = 'utf8'
  let start = 0
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    encoding = 'utf16le'
    start = 2
  } else if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    start = 3
  } else {
    let oddPositions = 0
    let oddNuls = 0
    for (let i = 1; i < raw.length; i += 2) {
      oddPositions++
      if (raw[i] === 0) oddNuls++
    }
    const hasUtf16Crlf = raw.includes(Buffer.from([0x0d, 0x00, 0x0a, 0x00]))
    if (hasUtf16Crlf || (oddPositions >= 4 && oddNuls / oddPositions >= 0.5)) {
      encoding = 'utf16le'
    }
  }

  const body = raw.subarray(start)
  if (encoding === 'utf16le' && body.length % 2 !== 0) {
    throw new Error('wsl.exe returned truncated UTF-16 output')
  }
  let decoded = body.toString(encoding)
  if (decoded.startsWith(BOM_CHAR)) decoded = decoded.slice(1)
  if (decoded.includes(REPLACEMENT_CHAR)) {
    throw new Error('wsl.exe returned output that could not be decoded as text')
  }
  if (decoded.includes(NUL_CHAR)) {
    throw new Error('wsl.exe returned a NUL character inside decoded text')
  }
  return decoded
}

/** Split decoded text into non-empty logical lines, tolerant of CRLF, LF, and bare CR. */
export function wslLines(decoded: string): string[] {
  return decoded.split(/\r\n|\n|\r/).filter((line) => line.length > 0)
}

/** True when `value` contains an ASCII control character (0x00-0x1F or 0x7F). */
export function hasControlCharacter(value: string): boolean {
  return CONTROL_CHAR_PATTERN.test(value)
}

/**
 * Render a value for inclusion in a user-facing error message: strips control characters and
 * caps length. Never used to decide behavior, only to keep a refusal message readable and safe to
 * show, without smuggling a NUL or escape byte into a UI string.
 */
export function printableWslText(value: string, maxLength = 200): string {
  const safe = value
    .replace(new RegExp(CONTROL_CHAR_PATTERN.source, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (safe.length <= maxLength) return safe
  return `${safe.slice(0, Math.max(0, maxLength - 3))}...`
}
