// A pure, dependency-free ZIP writer (STORE method — no compression). No Node/Electron/DOM API is
// used, so this runs identically in the renderer (Desktop AND the Server Edition browser build)
// and in the main/core process. Every path is kept RELATIVE and sanitized so an extraction cannot
// escape the destination directory (Zip Slip) — see `sanitizeZipPath`.
//
// 7z is NOT offered: this project ships no 7z-capable dependency (a 7z writer needs a native LZMA
// codec — see the earlier "no fake 7z option" decision documented in docs/exports.md). ZIP with
// STORE is unglamorous but genuinely correct, needs nothing beyond bytes-in-bytes-out, and works
// in a browser tab with no filesystem access at all.

export interface ZipEntry {
  /** Relative path inside the archive, forward-slash separated. */
  path: string
  data: Uint8Array
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Strip a leading drive/slash, resolve `..`/`.` segments, and drop empty segments — so a
 *  malicious or accidental absolute path or `../../etc/passwd` entry can never write outside the
 *  archive root. Extraction tools honour relative paths only when they are actually relative. */
export function sanitizeZipPath(path: string): string {
  const parts = path
    .replace(/\\/g, '/')
    .replace(/^[A-Za-z]:/, '')
    .split('/')
    .filter((p) => p.length > 0 && p !== '.')
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/') || 'file'
}

// General-purpose bit 11 tells ZIP readers that entry names are UTF-8 rather than the legacy
// CP437 default. TextEncoder always writes UTF-8, so omitting this bit corrupts Cantonese/emoji
// filenames in conforming readers even though permissive readers may happen to guess correctly.
const ZIP_UTF8_FLAG = 0x0800

function dosDateTime(d: Date): { time: number; date: number } {
  const time =
    ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f)
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f)
  return { time, date }
}

function textEncode(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff]
}
function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]
}

function concatBytes(chunks: number[][]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

/** Build a ZIP archive (STORE — no compression) from a list of entries. Returns the complete
 *  archive bytes, ready to save or hand to a Blob. Duplicate paths (after sanitizing) are kept —
 *  the caller (`buildArchive`) is expected to have already de-duplicated filenames. */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const now = dosDateTime(new Date())
  const localParts: number[][] = []
  const centralParts: number[][] = []
  let offset = 0

  for (const entry of entries) {
    const path = sanitizeZipPath(entry.path)
    const nameBytes = textEncode(path)
    const data = entry.data
    const crc = crc32(data)
    const size = data.length

    const localHeader = concatBytes([
      u32(0x04034b50),
      u16(20), // version needed
      u16(ZIP_UTF8_FLAG), // flags: UTF-8 filename
      u16(0), // method: STORE
      u16(now.time),
      u16(now.date),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0) // extra field length
    ])
    const local = concatBytes([[...localHeader], [...nameBytes], [...data]])
    localParts.push([...local])

    const centralHeader = concatBytes([
      u32(0x02014b50),
      u16(20), // version made by
      u16(20), // version needed
      u16(ZIP_UTF8_FLAG),
      u16(0),
      u16(now.time),
      u16(now.date),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0), // extra length
      u16(0), // comment length
      u16(0), // disk number start
      u16(0), // internal attrs
      u32(0), // external attrs
      u32(offset)
    ])
    centralParts.push([...concatBytes([[...centralHeader], [...nameBytes]])])
    offset += local.length
  }

  const centralStart = offset
  const central = concatBytes(centralParts)
  const centralSize = central.length

  const end = concatBytes([
    u32(0x06054b50),
    u16(0), // disk number
    u16(0), // disk with central dir
    u16(entries.length),
    u16(entries.length),
    u32(centralSize),
    u32(centralStart),
    u16(0) // comment length
  ])

  return concatBytes([[...concatBytes(localParts)], [...central], [...end]])
}
