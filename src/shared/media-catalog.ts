/** Portable media catalogue primitives shared by canvas, export and the browser surface.
 *
 * A reference identifies bytes by SHA-256 and carries only portable metadata. `sourcePath` is
 * intentionally local and transient, so a project file can move computers without leaking a
 * user's disk layout. Signature checks are bounded to the supplied prefix.
 */
export type MediaNodeKind = 'photo' | 'video' | 'gallery'

export interface MediaAssetReference {
  assetId: string
  kind: 'photo' | 'video'
  portablePath: string
  mime: string
  bytes: number
  sha256: string
  width?: number
  height?: number
  durationMs?: number
  missing?: boolean
  /** Machine-local resolver hint. Stripped before portable export and project save. */
  sourcePath?: string
}

const MEDIA_EXTENSIONS = { photo: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'], video: ['mp4', 'webm', 'mov', 'm4v'] } as const
const MEDIA_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v' }

export function normalizeMediaReference(input: unknown): MediaAssetReference | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const value = input as Record<string, unknown>
  const allowed = new Set(['assetId', 'kind', 'portablePath', 'mime', 'bytes', 'sha256', 'width', 'height', 'durationMs', 'missing'])
  if (Object.keys(value).some((key) => !allowed.has(key))) return undefined
  if (typeof value.sourcePath === 'string') return undefined
  const kind = value.kind === 'photo' || value.kind === 'video' ? value.kind : undefined
  const sha256 = typeof value.sha256 === 'string' ? value.sha256.toLowerCase() : ''
  const assetId = typeof value.assetId === 'string' ? value.assetId.toLowerCase() : ''
  const portablePath = typeof value.portablePath === 'string' ? value.portablePath : ''
  const ext = portablePath.match(/^\.\/assets\/media\/([a-f0-9]{64})\.([a-z0-9]+)$/i)
  const extension = ext?.[2]?.toLowerCase()
  if (!kind || !/^[a-f0-9]{64}$/.test(sha256) || assetId !== sha256 || !ext || ext[1].toLowerCase() !== sha256) return undefined
  if (!extension || !(MEDIA_EXTENSIONS[kind] as readonly string[]).includes(extension) || MEDIA_MIME[extension] !== value.mime) return undefined
  if (!Number.isSafeInteger(value.bytes) || Number(value.bytes) < 1 || Number(value.bytes) > 2_000_000_000) return undefined
  for (const key of ['width', 'height', 'durationMs']) if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0)) return undefined
  if (value.width !== undefined && (Number(value.width) < 1 || Number(value.width) > 100_000)) return undefined
  if (value.height !== undefined && (Number(value.height) < 1 || Number(value.height) > 100_000)) return undefined
  if (value.durationMs !== undefined && Number(value.durationMs) > 86_400_000) return undefined
  return { assetId: sha256, kind, portablePath: `./assets/media/${sha256}.${extension}`, mime: String(value.mime), bytes: Number(value.bytes), sha256, ...(value.width === undefined ? {} : { width: Number(value.width) }), ...(value.height === undefined ? {} : { height: Number(value.height) }), ...(value.durationMs === undefined ? {} : { durationMs: Number(value.durationMs) }), ...(value.missing === true ? { missing: true } : {}) }
}

export const mediaMimeForExtension = (extension: string): string | undefined => MEDIA_MIME[extension.toLowerCase()]

export interface MediaCatalogEntry {
  kind: MediaNodeKind
  label: string
  description: string
  extensions: readonly string[]
  accepts: readonly ('photo' | 'video')[]
}

export const MEDIA_CATALOG: readonly MediaCatalogEntry[] = [
  { kind: 'photo', label: 'Photo', description: 'A single bounded local image asset', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'], accepts: ['photo'] },
  { kind: 'video', label: 'Video', description: 'A single local video with native playback controls', extensions: ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv', 'avi'], accepts: ['video'] },
  { kind: 'gallery', label: 'Gallery', description: 'An ordered mixed photo and video collection', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv', 'avi'], accepts: ['photo', 'video'] }
]

const PHOTO_EXTENSIONS = new Set(MEDIA_CATALOG[0].extensions)
const VIDEO_EXTENSIONS = new Set(MEDIA_CATALOG[1].extensions)

export function mediaKindForPath(filePath: string): 'photo' | 'video' | undefined {
  const name = filePath.split(/[\\/]/).pop() ?? ''
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  if (PHOTO_EXTENSIONS.has(ext)) return 'photo'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  return undefined
}

export function isPortableMediaPath(value: string): boolean {
  return value.startsWith('./') && !value.includes('\\') && !value.split('/').some((part) => part === '..' || part === '')
}

export function validateMediaSignature(bytes: Uint8Array, kind: 'photo' | 'video'): { ok: true; mime: string } | { ok: false; reason: string } {
  if (bytes.byteLength === 0) return { ok: false, reason: 'The file is empty.' }
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value)
  const ascii = (offset: number, text: string) => Array.from(text, (char) => char.charCodeAt(0)).every((value, index) => bytes[offset + index] === value)
  if (kind === 'photo') {
    if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { ok: true, mime: 'image/png' }
    if (starts(0xff, 0xd8, 0xff)) return { ok: true, mime: 'image/jpeg' }
    if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return { ok: true, mime: 'image/gif' }
    if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { ok: true, mime: 'image/webp' }
    if (starts(0x42, 0x4d)) return { ok: true, mime: 'image/bmp' }
  } else {
    // WebM is EBML, not RIFF. The DocType element is bounded and must explicitly say webm.
    if (starts(0x1a, 0x45, 0xdf, 0xa3) && new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 4096))).toLowerCase().includes('webm')) return { ok: true, mime: 'video/webm' }
    if (ascii(0, 'OggS')) return { ok: true, mime: 'video/ogg' }
    if (bytes.byteLength >= 12 && ascii(4, 'ftyp')) return { ok: true, mime: 'video/mp4' }
    // Generic Matroska and AVI are deliberately not advertised until their bounded parsers exist.
  }
  return { ok: false, reason: 'The bytes do not match a supported media signature.' }
}

export function mediaReferenceIsPortable(reference: MediaAssetReference): boolean {
  return normalizeMediaReference(reference) !== undefined
}
