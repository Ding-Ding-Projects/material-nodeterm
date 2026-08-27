import type { BrowserProfile, BrowserTab } from './types'

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

/** User-visible lifecycle state for a portal, independent of its local browser session. */
export type BrowserPortalLifecycle = 'ready' | 'closed'

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

