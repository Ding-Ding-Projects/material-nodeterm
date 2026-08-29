/** A small, local-only identity mark for one canvas session. */
export type SessionIcon =
  | { type: 'emoji'; emoji: string }
  | { type: 'image'; dataUrl: string; width: number; height: number }

const MAX_EMOJI_CHARS = 16
const MAX_IMAGE_BYTES = 400 * 1024
const MAX_IMAGE_DIMENSION = 512
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/

/** Reject hand-edited or oversized persisted values before they reach an image element. */
export function sanitizeSessionIcon(value: unknown): SessionIcon | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Record<string, unknown>
  if (candidate.type === 'emoji') {
    return typeof candidate.emoji === 'string' && candidate.emoji.trim().length > 0 && candidate.emoji.length <= MAX_EMOJI_CHARS
      ? { type: 'emoji', emoji: candidate.emoji }
      : undefined
  }
  if (candidate.type !== 'image' || typeof candidate.dataUrl !== 'string') return undefined
  const dataUrl = candidate.dataUrl
  const comma = dataUrl.indexOf(',')
  const encoded = comma >= 0 ? dataUrl.slice(comma + 1) : ''
  const width = candidate.width
  const height = candidate.height
  const signatureOk = dataUrl.startsWith('data:image/png;base64,iVBORw0KGgo') ||
    dataUrl.startsWith('data:image/jpeg;base64,/9j/') ||
    dataUrl.startsWith('data:image/webp;base64,UklGR')
  if (!DATA_IMAGE.test(dataUrl) || !signatureOk || encoded.length === 0 || Math.ceil((encoded.length * 3) / 4) > MAX_IMAGE_BYTES) return undefined
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height)) return undefined
  if (width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) return undefined
  return { type: 'image', dataUrl, width, height }
}

export const SESSION_ICON_LIMITS = { maxImageBytes: MAX_IMAGE_BYTES, maxDimension: MAX_IMAGE_DIMENSION } as const
