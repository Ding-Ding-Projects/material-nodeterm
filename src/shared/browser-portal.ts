/**
 * Pure contracts for Browser Portal nodes.
 *
 * A portal is deliberately separate from the ordinary browser node. Its session partition is
 * always namespaced to the portal node and never falls back to Electron's default session or to a
 * project's ordinary browser profile. The only values that may travel in project content are safe
 * display intent such as the URL, title, and preset id. Cookies, storage, credentials, process
 * ids, and profile metadata remain local to the host that opens the portal.
 */

export type BrowserPortalLifecycle = 'idle' | 'loading' | 'ready' | 'suspended' | 'error'

export interface BrowserPortalPreset {
  id: string
  label: string
  description: string
  /** An empty URL keeps the portal at its guided setup surface. */
  url: string
}

/** Safe, shipped destinations. Presets are intent only and are not fetched during node creation. */
export const BROWSER_PORTAL_PRESETS: readonly BrowserPortalPreset[] = [
  {
    id: 'blank',
    label: 'Blank portal',
    description: 'Choose an HTTP(S) destination when you are ready.',
    url: ''
  },
  {
    id: 'local-dashboard',
    label: 'Local dashboard',
    description: 'A local service dashboard, entered explicitly by you.',
    url: 'http://localhost'
  },
  {
    id: 'documentation',
    label: 'Documentation',
    description: 'A public HTTPS documentation destination.',
    url: 'https://developer.mozilla.org/'
  }
] as const

const PORTAL_PARTITION_PREFIX = 'persist:browser-portal-'
const MAX_PARTITION_COMPONENT = 96
const MAX_LOCAL_PROFILES = 64

function safeComponent(value: string, fallback: string): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_PARTITION_COMPONENT)
  return normalized || fallback
}

/**
 * Derive the portal's persistent Electron session. A node id is part of the key so every portal
 * starts isolated, even when two projects happen to use the same local profile label.
 */
export function browserPortalPartitionFor(projectId: string, nodeId: string, profileId: string): string {
  return `${PORTAL_PARTITION_PREFIX}${safeComponent(projectId, 'project')}-${safeComponent(nodeId, 'node')}-${safeComponent(profileId, 'profile')}`
}

/** Validate a portal destination at the point of use, not only when it first enters the UI. */
export function validateBrowserPortalUrl(value: string): string | null {
  const raw = value.trim()
  if (!raw || [...raw].some((character) => character < ' ' || character === '\u007f')) return null
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) return null
  if (parsed.username || parsed.password) return null
  return parsed.href
}

/**
 * The portal profile list is intentionally a local browser record, not a project-file record.
 * Keep this shape small and credential-free. A malformed local value degrades to an empty list.
 */
export interface BrowserPortalLocalProfile {
  id: string
  name: string
  color: string
}

export const BROWSER_PORTAL_PROFILE_SCHEMA_VERSION = 1 as const

export function normalizeBrowserPortalLocalProfiles(value: unknown): BrowserPortalLocalProfile[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: BrowserPortalLocalProfile[] = []
  for (const candidate of value.slice(0, MAX_LOCAL_PROFILES)) {
    if (!candidate || typeof candidate !== 'object') continue
    const row = candidate as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.color !== 'string') continue
    const id = safeComponent(row.id, '')
    const name = row.name.trim().slice(0, 120)
    if (!id || !name || seen.has(id) || !/^#[0-9a-f]{6,8}$/i.test(row.color)) continue
    seen.add(id)
    out.push({ id, name, color: row.color })
  }
  return out
}

export function browserPortalPreset(id: string | undefined): BrowserPortalPreset {
  return BROWSER_PORTAL_PRESETS.find((preset) => preset.id === id) ?? BROWSER_PORTAL_PRESETS[0]
}
