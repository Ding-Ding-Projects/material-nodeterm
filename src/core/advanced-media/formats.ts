import { createHash } from 'node:crypto'
import { openContainer, packContainer, type ContainerEntry } from '../project-archive-container'
import type { AdvancedMediaFormat, AdvancedMediaLimits } from '../../shared/advanced-media'

const ZIP_CENTRAL = 0x02014b50
const ZIP_END = 0x06054b50
const TAR_BLOCK = 512

export interface MediaFileInfo {
  format: AdvancedMediaFormat
  mime: string
  bytes: number
  width?: number
  height?: number
  pages?: number
  note?: string
}

function u32(bytes: Buffer, offset: number): number {
  return bytes.readUInt32LE(offset)
}

function ascii(bytes: Buffer, offset: number, length: number): string {
  return bytes.subarray(offset, Math.min(bytes.length, offset + length)).toString('ascii')
}

function readBigEndian(bytes: Buffer, offset: number, length: number): number {
  let value = 0
  for (let i = 0; i < length; i++) value = value * 256 + bytes[offset + i]
  return value
}

function imageInfo(bytes: Buffer, limits: AdvancedMediaLimits): MediaFileInfo {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    if (width === 0 || height === 0 || width * height > limits.maxDecodedPixels) throw new Error('PNG dimensions exceed the decoded-pixel budget.')
    return { format: 'png', mime: 'image/png', bytes: bytes.length, width, height }
  }
  if (bytes.length >= 10 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) {
    const width = bytes.readUInt16LE(6)
    const height = bytes.readUInt16LE(8)
    if (width === 0 || height === 0 || width * height > limits.maxDecodedPixels) throw new Error('GIF dimensions exceed the decoded-pixel budget.')
    return { format: 'gif', mime: 'image/gif', bytes: bytes.length, width, height, note: 'Animation is inspected but not decoded by this metadata adapter.' }
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    if (ascii(bytes, 12, 4) === 'VP8X' && bytes.length >= 30) {
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16)
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
      if (width * height > limits.maxDecodedPixels) throw new Error('WebP dimensions exceed the decoded-pixel budget.')
      return { format: 'webp', mime: 'image/webp', bytes: bytes.length, width, height }
    }
    return { format: 'webp', mime: 'image/webp', bytes: bytes.length, note: 'WebP dimensions are not present in the bounded header.' }
  }
  if (bytes.length >= 26 && ascii(bytes, 0, 2) === 'BM') {
    const width = Math.abs(bytes.readInt32LE(18))
    const height = Math.abs(bytes.readInt32LE(22))
    if (width === 0 || height === 0 || width * height > limits.maxDecodedPixels) throw new Error('BMP dimensions exceed the decoded-pixel budget.')
    return { format: 'bmp', mime: 'image/bmp', bytes: bytes.length, width, height }
  }
  if (bytes.length >= 6 && (ascii(bytes, 0, 4) === '\x00\x00\x01\x00' || bytes.readUInt16LE(0) === 0)) {
    const type = bytes.readUInt16LE(0)
    const count = bytes.readUInt16LE(4)
    if ((type === 0 || type === 1) && count > 0 && count <= 64 && bytes.length >= 6 + count * 16) {
      const width = bytes[6] || 256
      const height = bytes[7] || 256
      return { format: 'ico', mime: 'image/x-icon', bytes: bytes.length, width, height }
    }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let offset = 2
    let width: number | undefined
    let height: number | undefined
    while (offset + 9 < bytes.length && offset < 64 * 1024) {
      if (bytes[offset] !== 0xff) {
        offset++
        continue
      }
      const marker = bytes[offset + 1]
      offset += 2
      if (marker === 0xd8 || marker === 0xd9) continue
      if (offset + 2 > bytes.length) break
      const size = bytes.readUInt16BE(offset)
      if (size < 2 || offset + size > bytes.length) break
      if (marker >= 0xc0 && marker <= 0xc3) {
        height = bytes.readUInt16BE(offset + 3)
        width = bytes.readUInt16BE(offset + 5)
        break
      }
      offset += size
    }
    if (width && height && width * height <= limits.maxDecodedPixels) return { format: 'jpeg', mime: 'image/jpeg', bytes: bytes.length, width, height }
    return { format: 'jpeg', mime: 'image/jpeg', bytes: bytes.length, note: 'JPEG dimensions were not present in the bounded header.' }
  }
  throw new Error('The bytes are not a supported image format.')
}

export function inspectImage(bytes: Buffer, limits: AdvancedMediaLimits): MediaFileInfo {
  return imageInfo(bytes, limits)
}

export function safeArchivePath(value: string): string {
  if (!value || value.includes('\0') || value.includes('\\')) throw new Error('Archive entry has an unsafe path.')
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) throw new Error('Archive entry must be relative.')
  const parts = value.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) throw new Error('Archive entry contains traversal segments.')
  return value
}

function zipEndOffset(bytes: Buffer): number {
  if (bytes.length < 22) throw new Error('ZIP end-of-directory record is missing.')
  const floor = Math.max(0, bytes.length - 22 - 0xffff)
  for (let offset = bytes.length - 22; offset >= floor; offset--) if (offset >= 0 && u32(bytes, offset) === ZIP_END) return offset
  throw new Error('ZIP end-of-directory record is missing.')
}

export interface ArchiveEntryInfo {
  path: string
  compressedBytes: number
  uncompressedBytes: number
  method: 'store' | 'deflate'
}

export function listZipEntries(bytes: Buffer, limits: AdvancedMediaLimits): ArchiveEntryInfo[] {
  const end = zipEndOffset(bytes)
  const count = bytes.readUInt16LE(end + 10)
  const centralSize = u32(bytes, end + 12)
  const centralStart = u32(bytes, end + 16)
  if (count > limits.maxEntries || centralStart + centralSize > end) throw new Error('ZIP central directory exceeds the archive limits.')
  const entries: ArchiveEntryInfo[] = []
  let cursor = centralStart
  let total = 0
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > centralStart + centralSize || u32(bytes, cursor) !== ZIP_CENTRAL) throw new Error('ZIP central directory is truncated.')
    const flags = bytes.readUInt16LE(cursor + 8)
    const method = bytes.readUInt16LE(cursor + 10)
    const compressedBytes = u32(bytes, cursor + 20)
    const uncompressedBytes = u32(bytes, cursor + 24)
    const nameBytes = bytes.readUInt16LE(cursor + 28)
    const extraBytes = bytes.readUInt16LE(cursor + 30)
    const commentBytes = bytes.readUInt16LE(cursor + 32)
    if (flags & 1 || flags & 8 || (method !== 0 && method !== 8)) throw new Error('ZIP encryption, data descriptors, or unsupported compression are not allowed.')
    if (uncompressedBytes > limits.maxOutputBytes || (total += uncompressedBytes) > limits.maxOutputBytes) throw new Error('ZIP extraction exceeds the output budget.')
    const path = safeArchivePath(bytes.subarray(cursor + 46, cursor + 46 + nameBytes).toString('utf8'))
    entries.push({ path, compressedBytes, uncompressedBytes, method: method === 0 ? 'store' : 'deflate' })
    cursor += 46 + nameBytes + extraBytes + commentBytes
  }
  return entries
}

export function extractZip(bytes: Buffer, limits: AdvancedMediaLimits): Map<string, Buffer> {
  const entries = listZipEntries(bytes, limits)
  const all = openContainer(bytes, {
    maxArchiveBytes: limits.maxInputBytes,
    maxTotalBytes: limits.maxOutputBytes,
    maxEntryBytes: limits.maxOutputBytes,
    maxEntries: limits.maxEntries
  })
  for (const entry of entries) if (!all.has(entry.path)) throw new Error('ZIP entry validation did not produce every listed entry.')
  return all
}

function octal(bytes: Buffer, offset: number, length: number): number {
  const text = bytes.subarray(offset, offset + length).toString('ascii').replace(/\0.*$/, '').trim()
  return text ? parseInt(text, 8) : 0
}

function validTarChecksum(header: Buffer): boolean {
  const expected = octal(header, 148, 8)
  let actual = 0
  for (let i = 0; i < header.length; i++) actual += i >= 148 && i < 156 ? 32 : header[i]
  return expected > 0 && actual === expected
}

export function listTarEntries(bytes: Buffer, limits: AdvancedMediaLimits): ArchiveEntryInfo[] {
  const entries: ArchiveEntryInfo[] = []
  let offset = 0
  let total = 0
  while (offset + TAR_BLOCK <= bytes.length) {
    const header = bytes.subarray(offset, offset + TAR_BLOCK)
    if (header.every((value) => value === 0)) break
    if (!validTarChecksum(header)) throw new Error('TAR header checksum is invalid.')
    const path = safeArchivePath(header.subarray(0, 100).toString('utf8').replace(/\0.*$/, ''))
    const size = octal(header, 124, 12)
    const type = header[156]
    if (type !== 0 && type !== 48) throw new Error('TAR links, devices, and special entries are not allowed.')
    if (size > limits.maxOutputBytes || (total += size) > limits.maxOutputBytes || entries.length >= limits.maxEntries) throw new Error('TAR extraction exceeds the archive limits.')
    entries.push({ path, compressedBytes: size, uncompressedBytes: size, method: 'store' })
    offset += TAR_BLOCK + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK
  }
  if (offset > bytes.length) throw new Error('TAR entry data is truncated.')
  return entries
}

export function extractTar(bytes: Buffer, limits: AdvancedMediaLimits): Map<string, Buffer> {
  const entries = listTarEntries(bytes, limits)
  const out = new Map<string, Buffer>()
  let offset = 0
  for (const entry of entries) {
    const dataStart = offset + TAR_BLOCK
    const data = Buffer.from(bytes.subarray(dataStart, dataStart + entry.uncompressedBytes))
    if (data.length !== entry.uncompressedBytes) throw new Error('TAR entry data is truncated.')
    out.set(entry.path, data)
    offset = dataStart + Math.ceil(entry.uncompressedBytes / TAR_BLOCK) * TAR_BLOCK
  }
  return out
}

function tarField(value: string | number, length: number): Buffer {
  const text = typeof value === 'number' ? value.toString(8).padStart(length - 1, '0') + '\0' : value
  const out = Buffer.alloc(length)
  out.write(text.slice(0, length), 0, 'ascii')
  return out
}

export function createTar(entries: readonly ContainerEntry[], limits: AdvancedMediaLimits): Buffer {
  if (entries.length > limits.maxEntries) throw new Error('Too many TAR entries.')
  let total = 0
  const chunks: Buffer[] = []
  for (const entry of entries) {
    const path = safeArchivePath(entry.path)
    if (Buffer.byteLength(path) > 99) throw new Error('TAR entry path is too long.')
    if (entry.data.length > limits.maxOutputBytes || (total += entry.data.length) > limits.maxOutputBytes) throw new Error('TAR output exceeds the byte budget.')
    const header = Buffer.alloc(TAR_BLOCK)
    tarField(path, 100).copy(header, 0)
    tarField(0o644, 8).copy(header, 100)
    tarField(0, 8).copy(header, 108)
    tarField(0, 8).copy(header, 116)
    tarField(entry.data.length, 12).copy(header, 124)
    tarField(0, 12).copy(header, 136)
    header[156] = 48
    Buffer.from('ustar\0').copy(header, 257)
    header.fill(32, 148, 156)
    let checksum = 0
    for (const byte of header) checksum += byte
    tarField(checksum, 8).copy(header, 148)
    chunks.push(header, entry.data, Buffer.alloc((TAR_BLOCK - (entry.data.length % TAR_BLOCK)) % TAR_BLOCK))
  }
  chunks.push(Buffer.alloc(TAR_BLOCK * 2))
  return Buffer.concat(chunks)
}

export function createZip(entries: readonly ContainerEntry[], limits: AdvancedMediaLimits): Buffer {
  if (entries.length > limits.maxEntries) throw new Error('Too many ZIP entries.')
  const total = entries.reduce((sum, entry) => sum + entry.data.length, 0)
  if (total > limits.maxOutputBytes) throw new Error('ZIP output exceeds the byte budget.')
  for (const entry of entries) safeArchivePath(entry.path)
  return packContainer(entries.map((entry) => ({ path: entry.path, data: entry.data })))
}

export interface PdfInfo {
  format: 'pdf'
  pages: number
  textCharacters: number
  encrypted: boolean
}

export function inspectPdf(bytes: Buffer, limits: AdvancedMediaLimits): PdfInfo {
  if (bytes.length < 5 || ascii(bytes, 0, 5) !== '%PDF-') throw new Error('The bytes are not a PDF.')
  const text = bytes.toString('latin1')
  const pages = (text.match(/\/Type\s*\/Page(?:\s|\/|>>)/g) ?? []).length
  if (pages <= 0 || pages > limits.maxPages) throw new Error('The PDF page count is outside the supported range.')
  const encrypted = /\/Encrypt\b/.test(text)
  return { format: 'pdf', pages, textCharacters: encrypted ? 0 : extractPdfText(bytes, limits).length, encrypted }
}

export function extractPdfText(bytes: Buffer, limits: AdvancedMediaLimits): string {
  if (bytes.length > limits.maxInputBytes || bytes.length < 5 || ascii(bytes, 0, 5) !== '%PDF-') throw new Error('The bytes are not a supported PDF.')
  const text = bytes.toString('latin1')
  const chunks: string[] = []
  let collected = 0
  for (let i = 0; i < text.length && collected < limits.maxTextCharacters; i++) {
    if (text[i] !== '(') continue
    let value = ''
    let depth = 1
    for (let j = i + 1; j < text.length && depth > 0; j++) {
      const char = text[j]
      if (char === '\\') {
        const next = text[++j]
        if (next === 'n') value += '\n'
        else if (next === 'r') value += '\r'
        else if (next === 't') value += '\t'
        else value += next
      } else if (char === '(') {
        depth++
        value += char
      } else if (char === ')') {
        depth--
        if (depth > 0) value += char
      } else value += char
    }
    if (depth === 0 && value.trim()) {
      chunks.push(value)
      collected += value.length
    }
    i += value.length + 1
  }
  const out = chunks.join('\n').slice(0, limits.maxTextCharacters)
  if (out.length === 0 && /\/Encrypt\b/.test(text)) throw new Error('Encrypted PDFs need a user-supplied password and are not read by this adapter.')
  return out
}

export function validateMediaOutput(bytes: Buffer, format: AdvancedMediaFormat, limits: AdvancedMediaLimits): string | null {
  if (bytes.length > limits.maxOutputBytes) return 'Produced media exceeds the output byte budget.'
  try {
    if (format === 'zip') listZipEntries(bytes, limits)
    else if (format === 'tar') listTarEntries(bytes, limits)
    else if (format === 'pdf') inspectPdf(bytes, limits)
    else if (format === 'png' || format === 'jpeg' || format === 'gif' || format === 'webp' || format === 'bmp' || format === 'ico') imageInfo(bytes, limits)
    else if (format === 'text') {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        return 'Produced text is not valid UTF-8.'
      }
    }
  } catch (error) {
    return `Produced ${format} failed validation: ${(error as Error).message}`
  }
  return null
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
