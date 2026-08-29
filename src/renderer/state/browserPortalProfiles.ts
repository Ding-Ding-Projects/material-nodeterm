import {
  BROWSER_PORTAL_PROFILE_SCHEMA_VERSION,
  normalizeBrowserPortalLocalProfiles,
  type BrowserPortalLocalProfile
} from '@shared/browser-portal'

const STORAGE_KEY = 'nodeterm.browser-portal-profiles.v1'
const MAX_ASSIGNMENTS = 1024
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

type StoredProfiles = {
  schemaVersion: typeof BROWSER_PORTAL_PROFILE_SCHEMA_VERSION
  profiles: BrowserPortalLocalProfile[]
  assignments?: Record<string, string>
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function safeAssignments(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ASSIGNMENTS)) {
    if (SAFE_ID.test(key) && typeof candidate === 'string' && SAFE_ID.test(candidate)) out[key] = candidate
  }
  return out
}

/** Read only this machine/browser's portal metadata. No cookies or credential values are read. */
export function loadBrowserPortalProfiles(): BrowserPortalLocalProfile[] {
  const store = storage()
  if (!store) return []
  try {
    const parsed: unknown = JSON.parse(store.getItem(STORAGE_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object') return []
    const record = parsed as Record<string, unknown>
    if (record.schemaVersion !== BROWSER_PORTAL_PROFILE_SCHEMA_VERSION) return []
    return normalizeBrowserPortalLocalProfiles(record.profiles)
  } catch {
    return []
  }
}

export function loadBrowserPortalProfileForNode(nodeId: string): string | undefined {
  const store = storage()
  if (!store) return undefined
  try {
    const parsed: unknown = JSON.parse(store.getItem(STORAGE_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object') return undefined
    const record = parsed as Record<string, unknown>
    if (record.schemaVersion !== BROWSER_PORTAL_PROFILE_SCHEMA_VERSION) return undefined
    const assignments = record.assignments
    if (!assignments || typeof assignments !== 'object') return undefined
    const value = (assignments as Record<string, unknown>)[nodeId]
    return typeof value === 'string' && SAFE_ID.test(value) ? value : undefined
  } catch {
    return undefined
  }
}

export function saveBrowserPortalProfiles(profiles: BrowserPortalLocalProfile[]): void {
  const store = storage()
  if (!store) return
  const previous = (() => {
    try {
      const raw = store.getItem(STORAGE_KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : null
      return parsed && typeof parsed === 'object' && parsed !== null
        ? safeAssignments((parsed as Record<string, unknown>).assignments)
        : {}
    } catch {
      return {}
    }
  })()
  const value: StoredProfiles = {
    schemaVersion: BROWSER_PORTAL_PROFILE_SCHEMA_VERSION,
    profiles: normalizeBrowserPortalLocalProfiles(profiles),
    assignments: previous
  }
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // A storage quota or privacy-mode refusal must not stop the portal itself. The caller keeps
    // the in-memory selection and the UI can explain that local metadata could not be persisted.
  }
}

export function saveBrowserPortalProfileForNode(nodeId: string, profileId: string): void {
  const store = storage()
  if (!store || !nodeId || !profileId) return
  try {
    const raw = store.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    const record = parsed && typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
    const assignments = safeAssignments(record.assignments)
    if (!SAFE_ID.test(nodeId) || !SAFE_ID.test(profileId)) return
    assignments[nodeId] = profileId
    store.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: BROWSER_PORTAL_PROFILE_SCHEMA_VERSION,
      profiles: normalizeBrowserPortalLocalProfiles(record.profiles),
      assignments
    } satisfies StoredProfiles))
  } catch {
    // Local storage is a convenience for metadata only. The isolated session remains active in
    // memory when a browser profile refuses persistence.
  }
}
