// The `.nodeterm-project` V2 CONTAINER: a genuine ZIP archive, the way a .docx is one. Rename the
// file to .zip and any archive tool opens it — that property is deliberate (a save file a user can
// inspect is a save file they can trust), and the round-trip test proves it by reading our output
// with the independently written `unzipper`.
//
// Why not reuse `shared/export/zip.ts` wholesale: that writer is pure and browser-safe on purpose
// (STORE only, number[] chunks), which is right for the export surface's small payloads and wrong
// for a save file that can carry hundreds of MB of working files — STORE would ship source text
// uncompressed, and the number[]-spread building is memory-quadratic at this scale. This module is
// Node-only (core), so it compresses with `node:zlib` DEFLATE and builds with Buffers, while
// reusing the shared module's `crc32` and `sanitizeZipPath` so there is exactly one definition of
// each.
//
// The READER is deliberately bounded and fail-closed: entry-count cap, per-entry and total
// uncompressed budgets enforced BEFORE inflating (and `maxOutputLength` while inflating, so a
// forged central directory cannot lie its way past the budget), methods STORE/DEFLATE only, no
// zip64, no data-descriptor entries, CRC verified per entry, and a name that sanitizes to anything
// other than itself (traversal, absolute, drive-letter) is refused rather than quietly renamed.
// It only ever reads `.nodeterm-project` files — hostile bytes are an expected input, a clever
// archive feature is not.

import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { crc32, sanitizeZipPath } from '../shared/export/zip'

export interface ContainerEntry {
  /** Relative path inside the archive, forward-slash separated. */
  path: string
  data: Buffer
}

export interface ContainerReadLimits {
  /** Cap on the container file itself (bytes). */
  maxArchiveBytes: number
  /** Cap on the SUM of declared uncompressed sizes (decompression-bomb bound). */
  maxTotalBytes: number
  /** Cap on one entry's uncompressed size. */
  maxEntryBytes: number
  maxEntries: number
}

const ZIP_UTF8_FLAG = 0x0800
const METHOD_STORE = 0
const METHOD_DEFLATE = 8
const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const EOCD_MIN = 22
const MAX_COMMENT = 0xffff
const MAX_NAME_BYTES = 4096

function u16(v: number): Buffer {
  const b = Buffer.allocUnsafe(2)
  b.writeUInt16LE(v & 0xffff, 0)
  return b
}

function u32(v: number): Buffer {
  const b = Buffer.allocUnsafe(4)
  b.writeUInt32LE(v >>> 0, 0)
  return b
}

function dosDateTime(d: Date): { time: number; date: number } {
  const time =
    ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f)
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0xf) << 5) |
    (d.getDate() & 0x1f)
  return { time, date }
}

/** True when the buffer starts with the ZIP local-file-header magic (`PK\x03\x04`) — how import
 *  tells a V2 container from a V1 JSON text archive. */
export function looksLikeContainer(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.readUInt32LE(0) === LOCAL_SIG
}

/**
 * Build the container. Each entry is DEFLATE-compressed when that actually shrinks it and STORE'd
 * when it does not (a git bundle is already zlib packfile data — deflating it again wastes CPU for
 * ~0 bytes). Entry paths must already be relative and clean; a path that `sanitizeZipPath` would
 * change is a programmer error here, not user input, so it throws.
 */
export function packContainer(entries: ContainerEntry[]): Buffer {
  const now = dosDateTime(new Date())
  const localChunks: Buffer[] = []
  const centralChunks: Buffer[] = []
  const seen = new Set<string>()
  let offset = 0

  for (const entry of entries) {
    if (sanitizeZipPath(entry.path) !== entry.path) {
      throw new Error(`Container entry path is not clean: ${entry.path}`)
    }
    if (seen.has(entry.path)) throw new Error(`Duplicate container entry: ${entry.path}`)
    seen.add(entry.path)
    const nameBytes = Buffer.from(entry.path, 'utf-8')
    if (nameBytes.length > MAX_NAME_BYTES) {
      throw new Error(`Container entry path is too long: ${entry.path}`)
    }
    const raw = entry.data
    const deflated = deflateRawSync(raw)
    const useDeflate = deflated.length < raw.length
    const stored = useDeflate ? deflated : raw
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE
    const crc = crc32(raw)

    const localHeader = Buffer.concat([
      u32(LOCAL_SIG),
      u16(20),
      u16(ZIP_UTF8_FLAG),
      u16(method),
      u16(now.time),
      u16(now.date),
      u32(crc),
      u32(stored.length),
      u32(raw.length),
      u16(nameBytes.length),
      u16(0)
    ])
    localChunks.push(localHeader, nameBytes, stored)

    centralChunks.push(
      Buffer.concat([
        u32(CENTRAL_SIG),
        u16(20),
        u16(20),
        u16(ZIP_UTF8_FLAG),
        u16(method),
        u16(now.time),
        u16(now.date),
        u32(crc),
        u32(stored.length),
        u32(raw.length),
        u16(nameBytes.length),
        u16(0), // extra
        u16(0), // comment
        u16(0), // disk number start
        u16(0), // internal attrs
        u32(0), // external attrs
        u32(offset)
      ]),
      nameBytes
    )
    offset += localHeader.length + nameBytes.length + stored.length
  }

  const central = Buffer.concat(centralChunks)
  const eocd = Buffer.concat([
    u32(EOCD_SIG),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(offset),
    u16(0)
  ])
  return Buffer.concat([...localChunks, central, eocd])
}

function fail(reason: string): never {
  throw new Error(`This is not a readable nodeterm project file (${reason}).`)
}

/**
 * Open a container, fail-closed. Returns entry name → uncompressed bytes. Every limit violation,
 * malformed structure, unsupported feature (zip64, data descriptors, other compression methods,
 * encryption) and CRC mismatch throws — a save file that cannot be FULLY read is refused whole
 * rather than partially imported.
 */
export function openContainer(
  bytes: Buffer,
  limits: ContainerReadLimits,
  /** When given, only entries it approves are inflated and returned — a cheap PEEK (inspect reads
   *  the manifest alone). Structure and size budgets are still validated for every entry; the
   *  full-read pass (import) remains the gate that proves every byte inflates and checksums. */
  pick?: (name: string) => boolean
): Map<string, Buffer> {
  if (bytes.length > limits.maxArchiveBytes) {
    throw new Error(
      `The project file is ${bytes.length.toLocaleString()} bytes — over the ` +
        `${limits.maxArchiveBytes.toLocaleString()}-byte limit.`
    )
  }
  if (bytes.length < EOCD_MIN || !looksLikeContainer(bytes)) fail('missing ZIP signature')

  // End-of-central-directory: scan back over a possible trailing comment (bounded by the format
  // itself at 65,535 bytes).
  let eocd = -1
  const scanFloor = Math.max(0, bytes.length - EOCD_MIN - MAX_COMMENT)
  for (let i = bytes.length - EOCD_MIN; i >= scanFloor; i--) {
    if (bytes.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) fail('no end-of-central-directory record')
  if (bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0) {
    fail('multi-disk archives are not supported')
  }
  const entryCount = bytes.readUInt16LE(eocd + 10)
  if (bytes.readUInt16LE(eocd + 8) !== entryCount) fail('inconsistent entry counts')
  if (entryCount > limits.maxEntries) {
    throw new Error(
      `The project file declares ${entryCount.toLocaleString()} entries — over the ` +
        `${limits.maxEntries.toLocaleString()}-entry limit.`
    )
  }
  const centralSize = bytes.readUInt32LE(eocd + 12)
  const centralStart = bytes.readUInt32LE(eocd + 16)
  if (centralStart === 0xffffffff || entryCount === 0xffff) fail('zip64 is not supported')
  if (centralStart + centralSize > eocd) fail('central directory overruns the file')

  const out = new Map<string, Buffer>()
  let cursor = centralStart
  let totalDeclared = 0
  for (let n = 0; n < entryCount; n++) {
    if (cursor + 46 > centralStart + centralSize) fail('truncated central directory')
    if (bytes.readUInt32LE(cursor) !== CENTRAL_SIG) fail('bad central-directory signature')
    const flags = bytes.readUInt16LE(cursor + 8)
    const method = bytes.readUInt16LE(cursor + 10)
    const crc = bytes.readUInt32LE(cursor + 16)
    const compressedSize = bytes.readUInt32LE(cursor + 20)
    const uncompressedSize = bytes.readUInt32LE(cursor + 24)
    const nameLen = bytes.readUInt16LE(cursor + 28)
    const extraLen = bytes.readUInt16LE(cursor + 30)
    const commentLen = bytes.readUInt16LE(cursor + 32)
    const localOffset = bytes.readUInt32LE(cursor + 42)
    if (flags & 0x0001) fail('encrypted entries are not supported')
    if (flags & 0x0008) fail('data-descriptor entries are not supported')
    if (method !== METHOD_STORE && method !== METHOD_DEFLATE) {
      fail(`unsupported compression method ${method}`)
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      fail('zip64 is not supported')
    }
    if (nameLen === 0 || nameLen > MAX_NAME_BYTES) fail('bad entry name length')
    if (uncompressedSize > limits.maxEntryBytes) {
      throw new Error(
        `One entry declares ${uncompressedSize.toLocaleString()} bytes — over the per-entry limit.`
      )
    }
    totalDeclared += uncompressedSize
    if (totalDeclared > limits.maxTotalBytes) {
      throw new Error('The project file declares more uncompressed data than the read budget allows.')
    }
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf-8')
    if (sanitizeZipPath(name) !== name || name.endsWith('/')) fail(`unsafe entry path: ${name}`)
    if (out.has(name)) fail(`duplicate entry: ${name}`)
    if (pick && !pick(name)) {
      cursor += 46 + nameLen + extraLen + commentLen
      continue
    }

    // Local header: trust the CENTRAL sizes (the authoritative copy), take only the local
    // name/extra lengths needed to find the data.
    if (localOffset + 30 > bytes.length) fail('entry data overruns the file')
    if (bytes.readUInt32LE(localOffset) !== LOCAL_SIG) fail('bad local-header signature')
    const localNameLen = bytes.readUInt16LE(localOffset + 26)
    const localExtraLen = bytes.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    if (dataStart + compressedSize > bytes.length) fail('entry data overruns the file')
    const stored = bytes.subarray(dataStart, dataStart + compressedSize)

    let data: Buffer
    if (method === METHOD_STORE) {
      if (compressedSize !== uncompressedSize) fail('stored entry size mismatch')
      data = Buffer.from(stored)
    } else {
      try {
        data = inflateRawSync(stored, { maxOutputLength: uncompressedSize })
      } catch {
        fail(`entry does not inflate: ${name}`)
      }
      if (data.length !== uncompressedSize) fail(`entry size mismatch: ${name}`)
    }
    if (crc32(data) !== crc) fail(`entry checksum mismatch: ${name}`)
    out.set(name, data)
    cursor += 46 + nameLen + extraLen + commentLen
  }
  return out
}
