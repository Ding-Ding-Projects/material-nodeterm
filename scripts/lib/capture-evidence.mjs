import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
export const MIN_CAPTURE_BYTES = 6_000

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const crc32 = (bytes) => { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return (c ^ 0xffffffff) >>> 0 }

/**
 * Decode enough of a PNG to prove it is a real, bounded, non-interlaced raster.
 *
 * A signature and byte floor only prove that a file resembles a screenshot. Inflating the IDAT
 * payload catches truncated chunks and records the actual dimensions without trusting filename
 * metadata. CDP's PNG output is RGBA, non-interlaced; refusing another encoding is intentional.
 */
export function inspectPng(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('capture is not a PNG')
  }
  let offset = PNG_SIGNATURE.length
  let width = 0
  let height = 0
  let bitDepth = 0
  let colourType = 0
  let interlace = 0
  const idat = []
  let sawIend = false
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    const end = offset + 12 + length
    if (end > bytes.length) throw new Error(`PNG ${type} chunk is truncated`)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (bytes.readUInt32BE(offset + 8 + length) !== crc32(Buffer.concat([Buffer.from(type), data]))) throw new Error(`PNG ${type} chunk CRC is invalid`)
    if (type === 'IHDR') {
      if (length !== 13 || width || height) throw new Error('PNG has an invalid IHDR chunk')
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colourType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') { sawIend = true; offset = end; break }
    offset = end
  }
  if (!width || !height || !sawIend || idat.length === 0) throw new Error('PNG is missing required raster chunks')
  if (offset !== bytes.length) throw new Error('PNG has trailing bytes after IEND')
  if (bitDepth !== 8 || ![2, 6].includes(colourType) || interlace !== 0) {
    throw new Error(`PNG encoding ${bitDepth}-bit colourType=${colourType} interlace=${interlace} is not a CDP raster`)
  }
  const channels = colourType === 6 ? 4 : 3
  const expected = height * (1 + width * channels)
  const decoded = inflateSync(Buffer.concat(idat))
  if (decoded.length !== expected) throw new Error(`PNG decoded payload is ${decoded.length} bytes; expected ${expected}`)
  const stride = width * channels
  let previous = Buffer.alloc(stride)
  let uniform = true
  let first = null
  for (let row = 0; row < height; row += 1) {
    const at = row * (stride + 1)
    const filter = decoded[at]
    if (filter > 4) throw new Error(`PNG has invalid filter type ${filter}`)
    const line = Buffer.from(decoded.subarray(at + 1, at + 1 + stride))
    for (let i = 0; i < line.length; i += 1) {
      const left = i >= channels ? line[i - channels] : 0
      const up = previous[i]
      const upperLeft = i >= channels ? previous[i - channels] : 0
      if (filter === 1) line[i] = (line[i] + left) & 255
      else if (filter === 2) line[i] = (line[i] + up) & 255
      else if (filter === 3) line[i] = (line[i] + Math.floor((left + up) / 2)) & 255
      else if (filter === 4) { const p = left + up - upperLeft; const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upperLeft); line[i] = (line[i] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft)) & 255 }
    }
    for (let i = 0; i < line.length; i += channels) { const pixel = line.subarray(i, i + channels).toString('hex'); if (first === null) first = pixel; else if (pixel !== first) uniform = false }
    previous = line
  }
  if (uniform) throw new Error('PNG decodes to a uniform raster')
  return { width, height, bytes: bytes.length, sha256: sha256(bytes) }
}

const clone = (value) => JSON.parse(JSON.stringify(value))

/** Convert legacy v1 manifest rows into independently-provenanced entries. */
export function normaliseCaptureManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { schemaVersion: 2, entries: {} }
  if (manifest.schemaVersion === 2 && manifest.entries && typeof manifest.entries === 'object' && !Array.isArray(manifest.entries)) {
    return { ...clone(manifest), entries: clone(manifest.entries) }
  }
  const entries = {}
  for (const row of Array.isArray(manifest.captured) ? manifest.captured : []) {
    if (!row || typeof row.id !== 'string') continue
    entries[row.id] = {
      ...clone(row),
      capturedAt: manifest.capturedAt ?? null,
      tuple: manifest.tuple ?? null,
      provenance: {
        commit: manifest.commit ?? null,
        method: manifest.method ?? null,
        receipt: manifest.receipt ?? null
      }
    }
  }
  return { schemaVersion: 2, entries }
}

/**
 * Merge only the rows captured in this run. `captured` remains an array so older consumers can
 * read a v2 manifest, but every row now owns the method, commit, receipt and tuple that created it.
 */
export function mergeCaptureManifest(previous, updates, updatedAt) {
  const next = normaliseCaptureManifest(previous)
  for (const update of updates) next.entries[update.id] = clone(update)
  const captured = Object.values(next.entries).sort((a, b) => a.id.localeCompare(b.id))
  return { schemaVersion: 2, updatedAt, entries: next.entries, captured }
}

export function captureIsCurrent(entry, { commit, tuple }) {
  if (!entry || typeof entry !== 'object') return false
  const recorded = entry.provenance?.commit ?? entry.commit
  if (recorded !== commit) return false
  return JSON.stringify(entry.tuple ?? null) === JSON.stringify(tuple ?? null)
}

/** Refuse a claimed external target unless its receipt proves the approved hidden route. */
export function validateExternalCaptureReceipt(receipt, expectedCommit) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('capture receipt is not a JSON object')
  if (receipt.schemaVersion !== 1 || receipt.route !== 'cheap-lowlevel-headless' || typeof receipt.method !== 'string' || !receipt.method.includes('cheap Lowlevel MCP headless')) {
    throw new Error('capture receipt does not name the cheap Lowlevel MCP headless route')
  }
  const commit = receipt.source?.gitHead ?? receipt.commit
  if (commit !== expectedCommit || typeof receipt.source?.workingTreeDigest !== 'string' || typeof receipt.source?.provenanceSha256 !== 'string') throw new Error(`capture receipt source provenance does not match ${expectedCommit}`)
  if (typeof receipt.candidate?.sha256 !== 'string' || typeof receipt.candidate?.appAsarSha256 !== 'string') throw new Error('capture receipt lacks candidate and app.asar hashes')
  const launch = receipt.launch ?? receipt
  if (launch.ok !== true || launch.focusStealing !== false || launch.terminalWindow !== false || typeof launch.desktop !== 'string' || launch.desktop.length === 0) {
    throw new Error('capture receipt lacks a successful non-visible named-headless-desktop launch')
  }
  return clone(receipt)
}

export function validateAttachedTarget(receipt, target, port) {
  if (!receipt?.launch?.pid || !receipt?.cdp || receipt.cdp.count !== 1) throw new Error('capture receipt lacks one live process-bound CDP target')
  if (receipt.cdp.id !== target.id || receipt.cdp.url !== target.url) throw new Error('attached CDP target does not match the receipt target')
  const socket = new URL(String(target.webSocketDebuggerUrl))
  if (socket.hostname !== '127.0.0.1' || Number(socket.port) !== Number(port)) throw new Error('attached CDP target is not on the receipt loopback endpoint')
}
