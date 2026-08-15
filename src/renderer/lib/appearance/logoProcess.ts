import { sniffImage } from './imageSniff'
import type { AppLogoCrop, AppLogoCustomImage } from '@shared/types'

/**
 * Local, bounded, private processing for a custom app logo (docs/app-logo.md § Security).
 *
 * Nothing here ever leaves the machine: the source bytes are read from the `File` object the
 * user's own file picker handed us, decoded and composited entirely in an in-memory `<canvas>`,
 * and the RESULT (never the original) is what gets persisted to settings.json as a data URL. No
 * network request, no CDN, no remote conversion service.
 */

export const MAX_SOURCE_BYTES = 12 * 1024 * 1024 // 12 MB
export const MAX_SOURCE_DIMENSION = 6000
export const MAX_SOURCE_PIXELS = 30_000_000 // decompression-bomb guard, checked BEFORE decode
export const OUTPUT_SIZE = 512

const ALLOWED_FORMATS = new Set(['png', 'jpeg', 'gif', 'webp', 'bmp'])

export interface LogoValidationError {
  code:
    | 'too-large'
    | 'unsupported-format'
    | 'animated'
    | 'dimensions-too-large'
    | 'malformed'
    | 'decode-failed'
  message: string
}

export type LogoProcessResult =
  | { ok: true; image: AppLogoCustomImage }
  | { ok: false; error: LogoValidationError }

export const DEFAULT_CROP: AppLogoCrop = { x: 0, y: 0, width: 1, height: 1 }

/** Draws the source bitmap (already crop/fit/background aware) into an OUTPUT_SIZE canvas and
 *  returns the composited PNG data URL. Exported separately so the settings UI can re-render a
 *  LIVE preview as the user adjusts crop/fit/background without re-decoding the source each time. */
export function compositeToDataUrl(
  bitmap: ImageBitmap,
  crop: AppLogoCrop,
  fit: 'contain' | 'cover' | 'fill',
  backgroundColor: string
): string {
  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
  if (backgroundColor && backgroundColor !== 'transparent') {
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
  }
  const sx = Math.max(0, crop.x * bitmap.width)
  const sy = Math.max(0, crop.y * bitmap.height)
  const sw = Math.max(1, crop.width * bitmap.width)
  const sh = Math.max(1, crop.height * bitmap.height)

  if (fit === 'fill') {
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
  } else {
    const srcRatio = sw / sh
    let dw = OUTPUT_SIZE
    let dh = OUTPUT_SIZE
    if (fit === 'contain') {
      if (srcRatio > 1) dh = OUTPUT_SIZE / srcRatio
      else dw = OUTPUT_SIZE * srcRatio
    } else {
      // cover
      if (srcRatio > 1) dw = OUTPUT_SIZE * srcRatio
      else dh = OUTPUT_SIZE / srcRatio
    }
    const dx = (OUTPUT_SIZE - dw) / 2
    const dy = (OUTPUT_SIZE - dh) / 2
    if (fit === 'cover') {
      // Clip to the output box so an oversized draw can't paint outside it.
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
      ctx.clip()
      ctx.drawImage(bitmap, sx, sy, sw, sh, dx, dy, dw, dh)
      ctx.restore()
    } else {
      ctx.drawImage(bitmap, sx, sy, sw, sh, dx, dy, dw, dh)
    }
  }
  return canvas.toDataURL('image/png')
}

/** Validates + decodes + composites a user-selected file into a persistable `AppLogoCustomImage`.
 *  Every rejection reason is reported (never a silent generic failure), and a rejection never
 *  partially applies — the caller only writes `image` when `ok: true`. */
export async function processLogoFile(
  file: File,
  fit: 'contain' | 'cover' | 'fill' = 'contain',
  backgroundColor = '#00000000',
  crop: AppLogoCrop = DEFAULT_CROP
): Promise<LogoProcessResult> {
  if (file.size > MAX_SOURCE_BYTES) {
    return {
      ok: false,
      error: {
        code: 'too-large',
        message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_SOURCE_BYTES / 1024 / 1024} MB.`
      }
    }
  }
  const buf = new Uint8Array(await file.arrayBuffer())
  const sniff = sniffImage(buf)
  if (!ALLOWED_FORMATS.has(sniff.format)) {
    return {
      ok: false,
      error: {
        code: 'unsupported-format',
        message:
          sniff.format === 'svg'
            ? "SVG isn't accepted for the custom logo (it can carry embedded scripts) — export a PNG/JPEG/WebP version instead."
            : "That file's bytes don't match a supported image format (PNG, JPEG, GIF, WebP, BMP) — renaming a file doesn't change what it is."
      }
    }
  }
  if (sniff.animated) {
    return {
      ok: false,
      error: { code: 'animated', message: 'Animated images (GIF/APNG/animated WebP) are not accepted for a static app logo.' }
    }
  }
  if (sniff.width != null && sniff.height != null) {
    if (sniff.width > MAX_SOURCE_DIMENSION || sniff.height > MAX_SOURCE_DIMENSION) {
      return {
        ok: false,
        error: {
          code: 'dimensions-too-large',
          message: `That image is ${sniff.width}×${sniff.height} — the limit is ${MAX_SOURCE_DIMENSION}px per side.`
        }
      }
    }
    if (sniff.width * sniff.height > MAX_SOURCE_PIXELS) {
      return {
        ok: false,
        error: { code: 'dimensions-too-large', message: 'That image has too many pixels to process safely.' }
      }
    }
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(new Blob([buf]))
  } catch {
    return { ok: false, error: { code: 'decode-failed', message: "That file's bytes claimed to be an image but couldn't actually be decoded." } }
  }
  // Cross-check the DECODED size against the sniffed header and the bounds again — a header can
  // lie, and only the decoder's own answer is trustworthy for what's about to be drawn.
  if (bitmap.width * bitmap.height > MAX_SOURCE_PIXELS || bitmap.width > MAX_SOURCE_DIMENSION * 2 || bitmap.height > MAX_SOURCE_DIMENSION * 2) {
    bitmap.close()
    return { ok: false, error: { code: 'dimensions-too-large', message: 'The decoded image is too large to process safely.' } }
  }

  const dataUrl = compositeToDataUrl(bitmap, crop, fit, backgroundColor)
  const width = OUTPUT_SIZE
  const height = OUTPUT_SIZE
  bitmap.close()
  if (!dataUrl) {
    return { ok: false, error: { code: 'decode-failed', message: 'Could not render the processed image (no 2D canvas context available).' } }
  }
  return {
    ok: true,
    image: {
      dataUrl,
      mime: 'image/png',
      width,
      height,
      sourceName: file.name.slice(0, 200),
      fit,
      backgroundColor,
      crop
    }
  }
}
