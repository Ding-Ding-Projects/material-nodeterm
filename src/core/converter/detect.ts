// Bounded byte-inspection format detection. Reads only the first CONVERTER_SNIFF_BYTES of a file —
// never the whole thing — and classifies it from magic-byte signatures plus a small amount of
// content heuristics for the text-based structured formats we bundle adapters for. The filename
// extension is a HINT only, consulted after signature/content sniffing fails to decide, never
// trusted as the sole signal (a renamed file must sniff correctly).

import type { ConverterKind } from '../../shared/converter'

export interface SniffResult {
  kind: ConverterKind | null
  confidence: 'high' | 'medium' | 'low'
  note: string
}

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false
  for (let i = 0; i < bytes.length; i++) if (buf[offset + i] !== bytes[i]) return false
  return true
}

function asciiAt(buf: Buffer, offset: number, text: string): boolean {
  if (buf.length < offset + text.length) return false
  return buf.toString('latin1', offset, offset + text.length) === text
}

/** Binary magic-byte signatures we can name accurately even though no bundled adapter reads them —
 *  this is what lets the catalog's disabled rows say "this IS a PNG" instead of "unknown format". */
function sniffBinarySignature(buf: Buffer): SniffResult | null {
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { kind: 'pdf', confidence: 'high', note: 'PDF signature (%PDF-)' }
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'png', confidence: 'high', note: 'PNG signature' }
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { kind: 'jpeg', confidence: 'high', note: 'JPEG signature' }
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return { kind: 'gif', confidence: 'high', note: 'GIF signature' }
  if (startsWith(buf, [0x42, 0x4d])) return { kind: 'bmp', confidence: 'medium', note: 'BMP signature (BM)' }
  if (startsWith(buf, [0x00, 0x00, 0x01, 0x00])) return { kind: 'ico', confidence: 'medium', note: 'ICO signature' }
  if (startsWith(buf, [0x1f, 0x8b])) return { kind: 'gzip', confidence: 'high', note: 'Gzip signature' }
  if (asciiAt(buf, 0, 'PK\x03\x04') || asciiAt(buf, 0, 'PK\x05\x06')) return { kind: 'zip', confidence: 'high', note: 'ZIP local-file-header signature' }
  if (asciiAt(buf, 0, 'ID3') || startsWith(buf, [0xff, 0xfb]) || startsWith(buf, [0xff, 0xf3]) || startsWith(buf, [0xff, 0xf2])) {
    return { kind: 'mp3', confidence: 'medium', note: 'MP3 ID3/frame-sync signature' }
  }
  if (asciiAt(buf, 0, 'RIFF')) {
    if (asciiAt(buf, 8, 'WAVE')) return { kind: 'wav', confidence: 'high', note: 'RIFF/WAVE signature' }
    if (asciiAt(buf, 8, 'WEBP')) return { kind: 'webp', confidence: 'high', note: 'RIFF/WEBP signature' }
  }
  if (asciiAt(buf, 0, 'fLaC')) return { kind: 'flac', confidence: 'high', note: 'FLAC signature' }
  if (asciiAt(buf, 0, 'OggS')) return { kind: 'ogg', confidence: 'high', note: 'Ogg signature' }
  if (asciiAt(buf, 4, 'ftyp')) {
    const brand = buf.toString('latin1', 8, 12)
    if (brand.startsWith('qt')) return { kind: 'mov', confidence: 'high', note: 'QuickTime ftyp brand' }
    return { kind: 'mp4', confidence: 'high', note: 'ISO base media (ftyp) signature' }
  }
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'mkv', confidence: 'high', note: 'EBML/Matroska signature' }
  if (startsWith(buf, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { kind: 'sevenzip', confidence: 'high', note: '7-Zip signature' }
  if (asciiAt(buf, 0, 'PK\x03\x04') === false && asciiAt(buf, 0, 'PK')) return { kind: 'zip', confidence: 'medium', note: 'ZIP-family signature' }
  return null
}

/** True when the sampled bytes look like they belong to a binary (non-text) file — a NUL byte
 *  anywhere in a reasonably early sample is a strong signal no legitimate UTF-8/ASCII text file
 *  would ever contain. */
function looksBinary(buf: Buffer): boolean {
  const scan = buf.subarray(0, Math.min(buf.length, 8000))
  for (let i = 0; i < scan.length; i++) {
    const b = scan[i]
    if (b === 0) return true
    // Control characters other than tab/lf/cr are rare in real text.
    if (b < 0x09 || (b > 0x0d && b < 0x20)) {
      // Allow a small fraction (a stray byte from a mixed sample); a run of them is binary.
      let run = 1
      for (let j = i + 1; j < Math.min(scan.length, i + 8); j++) {
        if (scan[j] < 0x09 || (scan[j] > 0x0d && scan[j] < 0x20)) run++
      }
      if (run >= 4) return true
    }
  }
  return false
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function sniffTextContent(buf: Buffer, filename: string): SniffResult {
  const sample = buf.subarray(0, Math.min(buf.length, 16 * 1024))
  const text = stripBom(sample.toString('utf8')).trimStart()
  const lower = filename.toLowerCase()

  if (text.length === 0) return { kind: 'text', confidence: 'low', note: 'Empty or whitespace-only file' }

  // JSON: cheapest and most reliable check — try to parse the WHOLE sample as JSON when it's small
  // enough, else just check the first significant character.
  if (text[0] === '{' || text[0] === '[') {
    if (buf.length <= 16 * 1024) {
      try {
        JSON.parse(text)
        return { kind: 'json', confidence: 'high', note: 'Parsed as JSON' }
      } catch {
        // fall through — could still be JSON with content past the sample window
      }
    }
    return { kind: 'json', confidence: 'medium', note: 'Starts with { or [' }
  }

  // JSON Lines is intentionally checked before generic text and CSV heuristics.  Every non-empty
  // line must be a complete JSON value, which keeps a renamed .ndjson file detectable without
  // trusting its extension and avoids misclassifying quoted commas as a spreadsheet.
  const jsonLines = text.split(/\r\n|\n|\r/).map((line) => line.trim()).filter(Boolean)
  if (jsonLines.length >= 2 && jsonLines.every((line) => {
    try { JSON.parse(line); return true } catch { return false }
  })) {
    return { kind: 'jsonl', confidence: 'high', note: 'Every sampled non-empty line parsed as JSON' }
  }

  // An XML declaration is unambiguous even when the filename has a different extension.
  if (text.startsWith('<?xml')) {
    return { kind: 'xml', confidence: 'high', note: 'Starts with an XML declaration' }
  }

  // Markdown permits raw HTML blocks, so a generic leading tag cannot outrank a known Markdown
  // extension. Keep this ahead of the broader XML/HTML-style heuristic without special-casing a
  // particular filename such as README.md.
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return { kind: 'markdown', confidence: 'medium', note: 'Markdown extension' }
  }
  if (/^#{1,6}\s+\S/m.test(text) && /\n\n/.test(text)) {
    return { kind: 'markdown', confidence: 'low', note: 'Looks like Markdown (heading + blank line)' }
  }

  if (text[0] === '<' && /^<[a-zA-Z!?]/.test(text)) {
    return { kind: 'xml', confidence: 'high', note: 'Starts with an XML/HTML-style tag' }
  }

  if (text.startsWith('---\n') || text.startsWith('---\r\n')) {
    return { kind: 'yaml', confidence: 'medium', note: 'Starts with a YAML document marker (---)' }
  }

  const lines = text.split(/\r\n|\n/).slice(0, 20).filter((l) => l.trim().length > 0)
  const tomlLike = lines.filter((l) => /^\s*\[[\w.\-]+\]\s*$/.test(l) || /^[\w.\-]+\s*=\s*\S/.test(l))
  const yamlLike = lines.filter((l) => /^[\w.\-]+\s*:\s*\S?/.test(l) || /^\s*-\s+\S/.test(l))
  const commaCounts = lines.map((l) => (l.match(/,/g) || []).length)
  const tabCounts = lines.map((l) => (l.match(/\t/g) || []).length)

  if (
    lines.length >= 2 &&
    tabCounts.every((c) => c > 0 && c === tabCounts[0]) &&
    tabCounts[0] > 0
  ) {
    return { kind: 'tsv', confidence: 'medium', note: 'Consistent tab-delimited rows' }
  }
  if (
    lines.length >= 2 &&
    commaCounts.every((c) => c > 0 && c === commaCounts[0]) &&
    commaCounts[0] > 0
  ) {
    return { kind: 'csv', confidence: 'medium', note: 'Consistent comma-delimited rows' }
  }
  if (tomlLike.length >= Math.max(1, lines.length - 1) && tomlLike.length >= yamlLike.length) {
    return { kind: 'toml', confidence: 'low', note: 'Looks like TOML key=value / [section] lines' }
  }
  if (yamlLike.length >= Math.max(1, lines.length - 1)) {
    return { kind: 'yaml', confidence: 'low', note: 'Looks like YAML key: value lines' }
  }

  return { kind: 'text', confidence: 'low', note: 'Readable text with no recognized structure' }
}

/** Detect a file's format from a bounded byte sample. `buf` must already be capped by the caller to
 *  CONVERTER_SNIFF_BYTES — this function never reads further. */
export function sniffFormat(buf: Buffer, filename: string): SniffResult {
  const bin = sniffBinarySignature(buf)
  if (bin) return bin
  if (looksBinary(buf)) return { kind: null, confidence: 'low', note: 'Binary content with no recognized signature' }
  return sniffTextContent(buf, filename)
}
