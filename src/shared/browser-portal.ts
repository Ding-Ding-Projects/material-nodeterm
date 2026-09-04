import type { BrowserProfile, BrowserTab } from './types'

/**
 * Pure contracts for Browser Portal nodes.
 *
 * A portal is deliberately separate from the ordinary browser node. Its session partition is
 * always namespaced to the portal node and never falls back to Electron's default session or to a
 * project's ordinary browser profile. The only values that may travel in project content are safe
 * display intent such as the URL, title, and preset id. Cookies, storage, credentials, process
 * ids, and profile metadata remain local to the host that opens the portal.
 *
 * Restored from its origin commit (751b10cbe, "feat(browser): add browser portal node"), which the
 * merge overwrote wholesale with a later, unrelated "portal intent / tabs" commit (d4bb9129a,
 * "feat(browser): add isolated Browser Portal lifecycle") that is kept intact below this block.
 * Every live consumer of this shape -- BrowserPortalNode.tsx, BrowserSurface.tsx, and
 * browserPortalProfiles.ts -- imports it by these exact unprefixed names.
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

/* ------------------------------------------------------------------------------------------- *
 * Later "portal intent / tabs" contracts (commit d4bb9129a, "feat(browser): add isolated Browser
 * Portal lifecycle" -- this is what the whole file contained before the block above was
 * restored). Kept because normalizeBrowserProfileName below is a genuine live import
 * (BrowserProfilePicker.tsx); every other export in this block currently has NO consumer anywhere
 * in the tree, verified by an exhaustive repo-wide search. Preserved rather than deleted in case a
 * future lane wires the shared project-projection "portal record" this block describes.
 *
 * `BrowserPortalLifecycle` is a direct name collision with the union declared above: this block's
 * original version ('ready' | 'closed') described whether a portal's INTENT RECORD is open or
 * closed in the project projection, not a browser guest's page-load state -- a different concept
 * that happens to share a name. Renamed to BrowserPortalRecordLifecycle so both flavors coexist;
 * a future consumer of the project-projection portal record should import it under that name.
 * ------------------------------------------------------------------------------------------- */

/** The schema version for browser portal intent stored in the shared project projection. */
export const BROWSER_PORTAL_INTENT_VERSION = 1 as const

/** Browser portal intent is safe to share. It deliberately contains no session or filesystem data. */
export interface BrowserPortalIntent {
  version: typeof BROWSER_PORTAL_INTENT_VERSION
  nodeId: string
  title: string
  url: string
  profileId?: string
}

/** User-visible lifecycle state for a portal record, independent of its local browser session.
 * Renamed from BrowserPortalLifecycle -- see the reconciliation note above this block. */
export type BrowserPortalRecordLifecycle = 'ready' | 'closed'

export const BROWSER_PORTAL_NAME_MAX = 80
export const BROWSER_PORTAL_URL_MAX = 4096

/**
 * Normalize a profile name at the guided creation boundary. Empty or over-sized names are
 * rejected instead of producing an object that cannot be selected reliably later.
 */
export function normalizeBrowserProfileName(value: string): string | null {
  const name = value.trim()
  if (name.length === 0 || name.length > BROWSER_PORTAL_NAME_MAX) return null
  if (/[\u0000-\u001f\u007f]/.test(name)) return null
  return name
}

/**
 * Keep only the portable facts of a browser node. Cookies, local storage, cache, extension paths,
 * process handles and machine-local partition strings must never enter project content.
 */
export function toBrowserPortalIntent(input: {
  nodeId: string
  title?: unknown
  url?: unknown
  browserProfileId?: unknown
}): BrowserPortalIntent | null {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(input.nodeId)) return null
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, BROWSER_PORTAL_NAME_MAX) : 'Browser'
  const url = typeof input.url === 'string' ? input.url.trim().slice(0, BROWSER_PORTAL_URL_MAX) : ''
  if (/[\u0000-\u001f\u007f]/.test(title) || /[\u0000-\u001f\u007f]/.test(url)) return null
  const profileId = typeof input.browserProfileId === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(input.browserProfileId)
    ? input.browserProfileId
    : undefined
  return {
    version: BROWSER_PORTAL_INTENT_VERSION,
    nodeId: input.nodeId,
    title: title || 'Browser',
    url,
    ...(profileId ? { profileId } : {})
  }
}

/**
 * A user navigation is owned by the visible browser node. Agent ownership is a separate control
 * lease and never becomes a reason to reject ordinary user navigation.
 */
export function browserPortalNavigationOwnedBy(nodeId: string, requestedNodeId: string): boolean {
  return nodeId.length > 0 && nodeId === requestedNodeId
}

/** Close/reset semantics for a browser node. Closing the final tab resets to one blank tab so the
 * node remains reachable; it never writes cookies or local storage into the shared intent. */
export function resetBrowserPortalTabs(nodeId: string): { tabs: BrowserTab[]; activeTabId: string } {
  const activeTabId = `${nodeId}-tab-reset`
  return { tabs: [{ id: activeTabId, url: '', title: 'New Tab' }], activeTabId }
}

/** A profile is valid for a portable selection only when it is still named by the project. */
export function browserPortalProfileIsAvailable(
  profiles: readonly BrowserProfile[] | undefined,
  profileId: string | undefined
): boolean {
  return profileId === undefined || !!profiles?.some((profile) => profile.id === profileId)
}
