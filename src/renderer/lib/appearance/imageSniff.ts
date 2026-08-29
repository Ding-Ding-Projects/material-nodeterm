/**
 * Minimal, dependency-free binary sniffing for the app-logo upload (docs/app-logo.md § Security).
 *
 * The whole point is to answer "what does this file's BYTES actually say it is" before anything
 * tries to decode it — never trust a file's extension or the browser's MIME guess, both of which
 * are just the filename/whatever the OS handed over. Every check here reads the real magic bytes
 * and, where the format allows it cheaply, the real declared dimensions and multi-frame markers —
 * enough to reject an animated image, an absurd declared size (a decompression-bomb guard BEFORE
 * any decode is attempted), or a file that simply isn't one of the allowlisted formats.
 */

export type SniffedFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'svg' | 'unknown'

export interface SniffResult {
  format: SniffedFormat
  /** Declared pixel dimensions read directly from the header, when the format makes that cheap
   *  (PNG/GIF/BMP/JPEG SOF marker). Absent for formats where that needs a full parse (WebP VP8L
   *  is checked separately below) or wasn't found. */
  width?: number
  height?: number
  /** True when the format's own animation marker is present (GIF multiple image descriptors,
   *  animated WebP's ANIM chunk, APNG's acTL chunk). Animated input is rejected outright. */
  animated: boolean
}

function readU16BE(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1]
}
function readU32BE(b: Uint8Array, o: number): number {
  return (b[o] * 0x1000000) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]
}
function readU32LE(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000)
}
function ascii(b: Uint8Array, o: number, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[o + i])
  return s
}

function sniffPng(b: Uint8Array): SniffResult | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (b.length < 33 || !sig.every((v, i) => b[i] === v)) return null
  // IHDR is always the first chunk, immediately after the signature: length(4) 'IHDR'(4) w(4) h(4).
  const width = readU32BE(b, 16)
  const height = readU32BE(b, 20)
  // Walk chunks looking for an 'acTL' (APNG animation control) chunk before 'IDAT'.
  let offset = 8
  let animated = false
  while (offset + 8 <= b.length) {
    const len = readU32BE(b, offset)
    const type = ascii(b, offset + 4, 4)
    if (type === 'acTL') {
      animated = true
      break
    }
    if (type === 'IDAT') break // animation control must precede image data
    offset += 12 + len // length + type + data + crc
    if (len < 0 || offset > b.length) break
  }
  return { format: 'png', width, height, animated }
}

function sniffGif(b: Uint8Array): SniffResult | null {
  if (b.length < 13) return null
  const header = ascii(b, 0, 6)
  if (header !== 'GIF87a' && header !== 'GIF89a') return null
  const width = b[6] | (b[7] << 8)
  const height = b[8] | (b[9] << 8)
  // Count image descriptor blocks (0x2C) — more than one means an animated GIF. A shallow scan
  // bounded by the input length; malformed GIFs simply stop early rather than looping forever.
  let frames = 0
  let i = 13
  const gctFlag = (b[10] & 0x80) !== 0
  if (gctFlag) i += 3 * (2 << (b[10] & 0x07))
  let guard = 0
  while (i < b.length && guard < 100000) {
    guard++
    const marker = b[i]
    if (marker === 0x3b) break // trailer
    if (marker === 0x21) {
      // Extension block: skip label + sub-blocks.
      i += 2
      while (i < b.length && b[i] !== 0) i += b[i] + 1
      i += 1
    } else if (marker === 0x2c) {
      frames++
      if (frames > 1) break
      // Image descriptor: 9 bytes header, then optional local colour table, then LZW min code +
      // sub-blocks.
      const lctFlag = (b[i + 9] & 0x80) !== 0
      i += 10
      if (lctFlag) i += 3 * (2 << (b[i - 1] & 0x07))
      i += 1 // LZW minimum code size
      while (i < b.length && b[i] !== 0) i += b[i] + 1
      i += 1
    } else {
      break
    }
  }
  return { format: 'gif', width, height, animated: frames > 1 }
}

function sniffJpeg(b: Uint8Array): SniffResult | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) {
      i++
      continue
    }
    const marker = b[i + 1]
    // SOF0/1/2/3/5/6/7/9/10/11/13/14/15 carry dimensions; skip everything else.
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    const len = readU16BE(b, i + 2)
    if (isSof && i + 9 <= b.length) {
      const height = readU16BE(b, i + 5)
      const width = readU16BE(b, i + 7)
      return { format: 'jpeg', width, height, animated: false }
    }
    if (marker === 0xd8 || marker === 0xd9) break
    i += 2 + len
  }
  return { format: 'jpeg', animated: false }
}

function sniffWebp(b: Uint8Array): SniffResult | null {
  if (b.length < 16 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null
  let width: number | undefined
  let height: number | undefined
  let animated = false
  let offset = 12
  while (offset + 8 <= b.length) {
    const chunkType = ascii(b, offset, 4)
    const chunkLen = readU32LE(b, offset + 4)
    const dataStart = offset + 8
    if (chunkType === 'VP8X' && dataStart + 10 <= b.length) {
      animated = (b[dataStart] & 0x02) !== 0
      width = 1 + (b[dataStart + 4] | (b[dataStart + 5] << 8) | (b[dataStart + 6] << 16))
      height = 1 + (b[dataStart + 7] | (b[dataStart + 8] << 8) | (b[dataStart + 9] << 16))
    } else if (chunkType === 'ANIM') {
      animated = true
    } else if (chunkType === 'VP8 ' && dataStart + 10 <= b.length && width == null) {
      width = readU16BE(b, dataStart + 6) & 0x3fff
      height = readU16BE(b, dataStart + 8) & 0x3fff
    } else if (chunkType === 'VP8L' && dataStart + 5 <= b.length && width == null) {
      const bits = readU32LE(b, dataStart + 1)
      width = (bits & 0x3fff) + 1
      height = ((bits >> 14) & 0x3fff) + 1
    }
    offset = dataStart + chunkLen + (chunkLen % 2)
  }
  return { format: 'webp', width, height, animated }
}

function sniffBmp(b: Uint8Array): SniffResult | null {
  if (b.length < 26 || b[0] !== 0x42 || b[1] !== 0x4d) return null
  const width = readU32LE(b, 18)
  const heightRaw = readU32LE(b, 22)
  return { format: 'bmp', width, height: Math.abs(heightRaw | 0), animated: false }
}

function looksLikeSvg(b: Uint8Array): boolean {
  // Decode only the first bytes as ASCII/UTF-8-ish text for the sniff — an SVG is XML text, not a
  // binary format, so "verify actual bytes" here means "does it actually start like XML/SVG"
  // rather than trusting a `.svg` extension.
  const head = ascii(b, 0, Math.min(b.length, 512)).trimStart().toLowerCase()
  return head.startsWith('<?xml') || head.startsWith('<svg') || head.includes('<svg')
}

/** Bounded, allowlist-only sniff. Returns `{format:'unknown', animated:false}` for anything that
 *  doesn't match a known signature — the caller must reject that, never guess. */
export function sniffImage(bytes: Uint8Array): SniffResult {
  return (
    sniffPng(bytes) ??
    sniffGif(bytes) ??
    sniffWebp(bytes) ??
    sniffBmp(bytes) ??
    sniffJpeg(bytes) ??
    (looksLikeSvg(bytes) ? { format: 'svg', animated: false } : { format: 'unknown', animated: false })
  )
}
