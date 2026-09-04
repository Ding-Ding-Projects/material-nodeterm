/** Pure contracts for Kiosk and installable PWA session nodes.
 *
 * The project file carries only the user's intent: a safe URL, display title, selected mode and
 * the small amount of manifest metadata needed to explain what will be reopened. Cookies,
 * service-worker state, local storage, profile directories and live web contents deliberately stay
 * outside this module and outside project.json.
 */

export type KioskDisplayMode = 'bounded' | 'fullscreen'

export interface KioskManifestMetadata {
  url: string
  name: string
  shortName?: string
  startUrl?: string
  display?: 'fullscreen' | 'standalone' | 'minimal-ui' | 'browser' | 'window-controls-overlay' | 'unknown'
  iconUrl?: string
}

export interface PortableKioskMetadata {
  schemaVersion: 1
  url: string
  title: string
  mode: KioskDisplayMode
  profileLabel?: string
  manifest?: KioskManifestMetadata
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const MAX_URL_LENGTH = 4096
const MAX_TITLE_LENGTH = 160
const MAX_MANIFEST_NAME_LENGTH = 160

/** Accept only ordinary HTTP(S) navigation, with no embedded identity or control characters. */
export function normalizeKioskUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw || raw.length > MAX_URL_LENGTH || CONTROL_CHARS.test(raw)) return null
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.username || parsed.password || !parsed.hostname) return null
  return parsed.href
}

/** Resolve a manifest or icon reference without allowing file, javascript, data or user-info URLs. */
export function resolveKioskResource(pageUrl: unknown, reference: unknown): string | null {
  const page = normalizeKioskUrl(pageUrl)
  if (!page || typeof reference !== 'string' || reference.length > MAX_URL_LENGTH) return null
  try {
    return normalizeKioskUrl(new URL(reference, page).href)
  } catch {
    return null
  }
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text || text.length > max || CONTROL_CHARS.test(text)) return undefined
  return text
}

function displayMode(value: unknown): KioskManifestMetadata['display'] {
  if (value === 'fullscreen' || value === 'standalone' || value === 'minimal-ui' || value === 'browser' || value === 'window-controls-overlay') return value
  return value === undefined ? undefined : 'unknown'
}

/** Validate untrusted manifest data returned by a page, retaining only useful safe metadata. */
export function sanitizeKioskManifest(value: unknown, pageUrl: string): KioskManifestMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const url = normalizeKioskUrl(pageUrl) ?? resolveKioskResource(pageUrl, raw.url)
  const name = boundedText(raw.name, MAX_MANIFEST_NAME_LENGTH)
  if (!url || !name) return null
  const shortName = boundedText(raw.short_name, MAX_MANIFEST_NAME_LENGTH)
  const startUrl = resolveKioskResource(pageUrl, raw.start_url)
  const icons = Array.isArray(raw.icons) ? raw.icons : []
  const firstIcon = icons.find((item) => item && typeof item === 'object' && resolveKioskResource(url, (item as Record<string, unknown>).src)) as Record<string, unknown> | undefined
  const iconUrl = firstIcon ? resolveKioskResource(url, firstIcon.src) ?? undefined : undefined
  return {
    url,
    name,
    ...(shortName ? { shortName } : {}),
    ...(startUrl ? { startUrl } : {}),
    ...(displayMode(raw.display) ? { display: displayMode(raw.display) } : {}),
    ...(iconUrl ? { iconUrl } : {})
  }
}

/** Build the git-shared node projection. No local profile identifier or live page state enters it. */
export function portableKioskMetadata(input: {
  url: unknown
  title: unknown
  mode: unknown
  profileLabel?: unknown
  manifest?: unknown
}): PortableKioskMetadata | null {
  const url = normalizeKioskUrl(input.url)
  const title = boundedText(input.title, MAX_TITLE_LENGTH)
  const mode: KioskDisplayMode = input.mode === 'fullscreen' ? 'fullscreen' : 'bounded'
  if (!url || !title) return null
  const profileLabel = boundedText(input.profileLabel, MAX_TITLE_LENGTH)
  const manifest = sanitizeKioskManifest(input.manifest, url)
  return {
    schemaVersion: 1,
    url,
    title,
    mode,
    ...(profileLabel ? { profileLabel } : {}),
    ...(manifest ? { manifest } : {})
  }
}

/** A profile id stored only in this machine's local browser storage. */
export function kioskLocalProfileStorageKey(projectId: string, nodeId: string): string {
  return `nodeterm:kiosk-profile:${projectId}:${nodeId}`
}

export const KIOSK_DEFAULT_TITLE = 'Kiosk session'
export const KIOSK_MAX_URL_LENGTH = MAX_URL_LENGTH
