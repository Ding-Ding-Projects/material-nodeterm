/**
 * A terminal session's user-chosen icon: one grapheme, or a local image path.
 *
 * The value is stored in the shared project file, so it is hand-editable and must be treated as
 * hostile at both serializer seams. Invalid data degrades to no icon rather than becoming a path
 * or a large string that every session surface renders.
 */

export const NODE_ICON_MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  avif: 'image/avif'
}

export type NodeIcon =
  | { type: 'emoji'; value: string }
  | { type: 'image'; path: string }

const EMOJI_MAX_UNITS = 24

const isControlCodePoint = (cp: number): boolean => cp < 0x20 || cp === 0x7f

const stripControl = (value: string): string =>
  Array.from(value)
    .filter((char) => !isControlCodePoint(char.codePointAt(0) ?? 0))
    .join('')

const hasControl = (value: string): boolean =>
  Array.from(value).some((char) => isControlCodePoint(char.codePointAt(0) ?? 0))

interface GraphemeSegmenter {
  segment(input: string): Iterable<{ segment: string }>
}

const isAbsolutePath = (value: string): boolean =>
  value.startsWith('/') || value.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(value)

export function nodeIconMime(path: string): string | undefined {
  const name = path.split(/[\\/]/).pop() ?? ''
  if (!name.includes('.')) return undefined
  return NODE_ICON_MIME[name.split('.').pop()!.toLowerCase()]
}

function firstGrapheme(raw: string): string {
  const clean = stripControl(raw).trim()
  if (!clean) return ''
  const ctor = (
    Intl as unknown as {
      Segmenter?: new (locale?: string, options?: { granularity: string }) => GraphemeSegmenter
    }
  ).Segmenter
  if (ctor) {
    for (const segment of new ctor(undefined, { granularity: 'grapheme' }).segment(clean)) {
      return segment.segment
    }
    return ''
  }
  return clean.slice(0, EMOJI_MAX_UNITS)
}

function isSafeRelativePath(relative: string): boolean {
  return relative.split('/').every((segment) => segment !== '' && segment !== '..' && segment !== '.')
}

/** Normalize untrusted persisted data. Unknown values become no icon. */
export function normalizeNodeIcon(raw: unknown): NodeIcon | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as { type?: unknown; value?: unknown; path?: unknown }
  if (value.type === 'emoji') {
    if (typeof value.value !== 'string') return undefined
    const emoji = firstGrapheme(value.value)
    return emoji ? { type: 'emoji', value: emoji } : undefined
  }
  if (value.type !== 'image' || typeof value.path !== 'string') return undefined
  const path = value.path.trim()
  if (!path || hasControl(path) || !nodeIconMime(path)) return undefined
  if (path.startsWith('./')) {
    const relative = path.slice(2).replace(/\\/g, '/')
    return isSafeRelativePath(relative) ? { type: 'image', path: `./${relative}` } : undefined
  }
  return isAbsolutePath(path) ? { type: 'image', path } : undefined
}

/** Store project-local paths in the same portable ./ form used by node working directories. */
export function portableIconPath(absPath: string, projectCwd?: string): string {
  if (!projectCwd) return absPath
  const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '')
  const root = normalize(projectCwd)
  const absolute = normalize(absPath)
  const comparisonRoot = root.toLowerCase()
  const comparisonPath = absolute.toLowerCase()
  if (!root || !comparisonPath.startsWith(`${comparisonRoot}/`)) return absPath
  const relative = absolute.slice(root.length + 1)
  return relative && isSafeRelativePath(relative) ? `./${relative}` : absPath
}

/** Resolve a validated icon path for the project that owns it. */
export function resolveIconPath(storedPath: string, projectCwd?: string): string | undefined {
  if (!storedPath.startsWith('./')) return isAbsolutePath(storedPath) ? storedPath : undefined
  const relative = storedPath.slice(2).replace(/\\/g, '/')
  if (!isSafeRelativePath(relative) || !projectCwd) return undefined
  const root = projectCwd.replace(/[\\/]+$/, '')
  return `${root}/${relative}`
}
