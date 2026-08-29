/** Portable, bounded metadata and byte inspection for board-log comment attachments. */

export type BoardLogAttachmentKind = 'file' | 'image' | 'audio' | 'video'

export interface BoardLogAttachment {
  /** Stable collision-safe id, never a machine path. */
  id: string
  /** Project-relative archive reference under `.nodeterm/board-attachments/`. */
  ref: string
  displayName: string
  kind: BoardLogAttachmentKind
  mimeType?: string
  bytes: number
  sha256: string
}

export interface BoardLogAttachmentUpload {
  sessionId: string
  displayName: string
  mimeType?: string
  dataBase64: string
}

export interface BoardLogAttachmentSession {
  id: string
  expiresAt: number
}

export const BOARD_LOG_ATTACHMENT_LIMITS = {
  // Keep base64 RPC payloads below the existing 8 MiB frame ceiling without changing it.
  maxBytes: 4 * 1024 * 1024,
  maxNameBytes: 240,
  maxPerComment: 20,
  maxTotalBytes: 64 * 1024 * 1024
} as const

const SHA256 = /^[0-9a-f]{64}$/
const SAFE_ID = /^[a-f0-9-]{36}$/i

function bytesOf(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || bytesOf(value) > BOARD_LOG_ATTACHMENT_LIMITS.maxNameBytes) return null
  if ([...value].some((ch) => ch < ' ' || ch === '\u007f' || ch === '/' || ch === '\\')) return null
  return value
}

function cleanMime(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0 || bytesOf(value) > 128 || [...value].some((ch) => ch < ' ' || ch === '\u007f')) return undefined
  return value
}

function has(bytes: Uint8Array, at: number, values: number[]): boolean {
  return values.every((value, offset) => bytes[at + offset] === value)
}

/** Detect the actual byte signature, with MIME/name only used as a fallback label. */
export function detectBoardLogAttachmentKind(bytes: Uint8Array, _name = '', _mime = ''): BoardLogAttachmentKind {
  if (has(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || has(bytes, 0, [0xff, 0xd8, 0xff]) || has(bytes, 0, [0x47, 0x49, 0x46, 0x38])) return 'image'
  if (has(bytes, 0, [0x49, 0x44, 0x33]) || has(bytes, 0, [0xff, 0xfb]) || has(bytes, 0, [0x4f, 0x67, 0x67, 0x53])) return 'audio'
  if (has(bytes, 4, [0x66, 0x74, 0x79, 0x70]) || has(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) return 'video'
  // A claimed MIME type or extension never upgrades unknown bytes to executable media. Such an
  // item is still a valid generic attachment, but receives no privileged preview.
  return 'file'
}

/** Validate metadata received from a project file or board-log line. */
export function validBoardLogAttachment(value: unknown): value is BoardLogAttachment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const a = value as Record<string, unknown>
  const allowed = new Set(['id', 'ref', 'displayName', 'kind', 'mimeType', 'bytes', 'sha256'])
  if (Object.keys(a).some((key) => !allowed.has(key))) return false
  if (!SAFE_ID.test(String(a.id)) || typeof a.ref !== 'string' || a.ref !== `.nodeterm/board-attachments/${String(a.id)}.bin`) return false
  if (a.ref.includes('..') || a.ref.includes('\\') || a.ref.includes('\0')) return false
  if (!cleanName(a.displayName) || !['file', 'image', 'audio', 'video'].includes(String(a.kind))) return false
  if (a.mimeType !== undefined && !cleanMime(a.mimeType)) return false
  return Number.isSafeInteger(a.bytes) && Number(a.bytes) >= 0 && Number(a.bytes) <= BOARD_LOG_ATTACHMENT_LIMITS.maxBytes && typeof a.sha256 === 'string' && SHA256.test(a.sha256)
}

export function validateBoardLogAttachmentUpload(upload: BoardLogAttachmentUpload, bytes: Uint8Array): { kind: BoardLogAttachmentKind; name: string } {
  const name = cleanName(upload.displayName)
  if (!name) throw new Error('Attachment name is invalid or too long.')
  if (upload.mimeType !== undefined && !cleanMime(upload.mimeType)) throw new Error('Attachment MIME type is invalid.')
  if (bytes.byteLength === 0 || bytes.byteLength > BOARD_LOG_ATTACHMENT_LIMITS.maxBytes) throw new Error(`Attachment exceeds the ${BOARD_LOG_ATTACHMENT_LIMITS.maxBytes} byte limit.`)
  return { name, kind: detectBoardLogAttachmentKind(bytes, name) }
}
