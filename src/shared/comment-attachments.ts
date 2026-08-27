/** Path-free attachment records used by the Comments & Activity board log. */

export type BoardAttachmentKind = 'file' | 'image' | 'audio' | 'video'

export const BOARD_ATTACHMENT_LIMITS = {
  maxBytes: 6 * 1024 * 1024,
  maxEncodedChars: 8 * 1024 * 1024,
  maxCount: 16,
  maxNameBytes: 255,
  maxMimeBytes: 128,
  maxArchivePathBytes: 4096,
  maxReferenceBytes: 256
} as const

export interface BoardAttachmentRef {
  /** Collision-safe content address plus a random suffix when duplicate names are retained. */
  id: string
  /** Original display name, reduced to a basename and never used as a write target. */
  name: string
  kind: BoardAttachmentKind
  mime: string
  bytes: number
  sha256: string
  /** Stable opaque reference used by the board-log entry and archive importer. */
  reference: string
  /** Portable relative carrier, never an absolute machine path. */
  archivePath: string
  /** Optional media facts proved by a decoder before posting. */
  width?: number
  height?: number
  durationMs?: number
  frames?: number
}

/** A source path is consumed once by the privileged host and is never persisted. */
export interface BoardAttachmentDraft {
  name: string
  sourcePath: string
}

export type BoardLogAppendFailure =
  | 'unsupported'
  | 'invalid-entry'
  | 'invalid-attachment'
  | 'empty-attachment'
  | 'read-failed'
  | 'write-failed'
  | 'log-failed'

export type BoardLogAppendResult =
  | { ok: true; entry: import('./types').BoardLogEntry }
  | { ok: false; reason: BoardLogAppendFailure; message: string }

export type BoardAttachmentReadResult =
  | { ok: true; attachment: BoardAttachmentRef; dataBase64: string }
  | { ok: false; reason: 'unsupported' | 'missing' | 'read-failed' | 'integrity-failed'; message: string }

const SHA256 = /^[0-9a-f]{64}$/
const SAFE_ID = /^[a-f0-9]{64}(?:-[a-f0-9]{32})?$/
const SAFE_REFERENCE = /^board-attachment:[a-f0-9]{64}(?:-[a-f0-9]{32})?$/
const SAFE_MIME = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,127}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,127}$/

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function safeName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && utf8Bytes(value) <= BOARD_ATTACHMENT_LIMITS.maxNameBytes &&
    !value.includes('\0') && !/[\\/\r\n]/.test(value) && value !== '.' && value !== '..' && !/[ .]$/.test(value)
}

/** Validate the persisted reference without reading its carrier. */
export function validateBoardAttachmentRef(value: unknown): asserts value is BoardAttachmentRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Board attachment reference is invalid.')
  const item = value as Record<string, unknown>
  const allowed = new Set(['id', 'name', 'kind', 'mime', 'bytes', 'sha256', 'reference', 'archivePath', 'width', 'height', 'durationMs', 'frames'])
  if (Object.keys(item).some((key) => !allowed.has(key) || ['__proto__', 'prototype', 'constructor'].includes(key))) {
    throw new Error('Board attachment reference contains an unknown field.')
  }
  if (typeof item.id !== 'string' || !SAFE_ID.test(item.id) || typeof item.sha256 !== 'string' || !SHA256.test(item.sha256) || !item.id.startsWith(item.sha256)) throw new Error('Board attachment reference has an invalid content address.')
  if (!safeName(item.name)) throw new Error('Board attachment name is invalid.')
  if (!['file', 'image', 'audio', 'video'].includes(String(item.kind))) throw new Error('Board attachment kind is invalid.')
  if (typeof item.mime !== 'string' || utf8Bytes(item.mime) > BOARD_ATTACHMENT_LIMITS.maxMimeBytes || !SAFE_MIME.test(item.mime)) throw new Error('Board attachment MIME is invalid.')
  if (!Number.isSafeInteger(item.bytes) || Number(item.bytes) <= 0 || Number(item.bytes) > BOARD_ATTACHMENT_LIMITS.maxBytes) throw new Error('Board attachment byte count is invalid.')
  if (typeof item.reference !== 'string' || utf8Bytes(item.reference) > BOARD_ATTACHMENT_LIMITS.maxReferenceBytes || !SAFE_REFERENCE.test(item.reference) || item.reference !== `board-attachment:${item.id}`) throw new Error('Board attachment reference id is invalid.')
  if (typeof item.archivePath !== 'string' || utf8Bytes(item.archivePath) > BOARD_ATTACHMENT_LIMITS.maxArchivePathBytes || item.archivePath !== `assets/attachments/${item.id}.bin`) throw new Error('Board attachment archive path is invalid.')
  for (const key of ['width', 'height', 'durationMs', 'frames']) {
    if (item[key] !== undefined && (!Number.isSafeInteger(item[key]) || Number(item[key]) <= 0)) throw new Error(`Board attachment ${key} is invalid.`)
  }
}

/** Safe name for presentation and archive identity. It never returns a path segment from input. */
export function boardAttachmentDisplayName(value: string): string {
  const basename = String(value ?? '').split(/[\\/]/).pop() ?? ''
  const clean = basename.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/[ .]+$/, '')
  if (!clean || clean === '.' || clean === '..') return 'attachment'
  return [...clean].slice(0, 120).join('') || 'attachment'
}

/** MIME and kind are derived from bounded bytes. Unknown but non-empty data remains generic. */
export function detectBoardAttachmentKind(data: Uint8Array): { kind: BoardAttachmentKind; mime: string } {
  const ascii = (offset: number, text: string): boolean => offset + text.length <= data.length && [...text].every((char, index) => data[offset + index] === char.charCodeAt(0))
  const head = new TextDecoder('ascii').decode(data.subarray(0, Math.min(data.length, 4096)))
  if (data.length >= 8 && data[0] === 0x89 && ascii(1, 'PNG') && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return { kind: 'image', mime: 'image/png' }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' }
  if (data.length >= 6 && (ascii(0, 'GIF87a') || ascii(0, 'GIF89a'))) return { kind: 'image', mime: 'image/gif' }
  if (data.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { kind: 'image', mime: 'image/webp' }
  if (data.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WAVE')) return { kind: 'audio', mime: 'audio/wav' }
  if (data.length >= 4 && ascii(0, 'fLaC')) return { kind: 'audio', mime: 'audio/flac' }
  if (data.length >= 3 && ascii(0, 'ID3')) return { kind: 'audio', mime: 'audio/mpeg' }
  if (data.length >= 4 && ascii(0, 'OggS') && (head.includes('OpusHead') || head.includes('vorbis'))) return { kind: 'audio', mime: 'audio/ogg' }
  if (data.length >= 12 && ascii(4, 'ftyp')) {
    const brand = String.fromCharCode(...data.slice(8, 12)).toLowerCase()
    if (['mp4', 'isom', 'iso2', 'avc1', 'mp41', 'mp42'].includes(brand)) return { kind: 'video', mime: 'video/mp4' }
    if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime' }
  }
  if (data.length >= 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3 && head.toLowerCase().includes('webm')) return { kind: 'video', mime: 'video/webm' }
  return { kind: 'file', mime: 'application/octet-stream' }
}

export function boardAttachmentArchivePath(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error('Board attachment id is invalid.')
  return `assets/attachments/${id}.bin`
}

export function boardAttachmentReference(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error('Board attachment id is invalid.')
  return `board-attachment:${id}`
}
