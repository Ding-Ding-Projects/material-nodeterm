/**
 * Portable and local state for kiosk and installed-web-app sessions.
 *
 * The portable half is deliberately boring: it describes what the user wants opened, not how
 * this computer opens it. Profile storage, permission grants, window handles, process ids,
 * browser cache, and last-run state stay in the host-owned local record.
 */

export const KIOSK_PWA_SCHEMA_VERSION = 1 as const

export type KioskPwaMode = 'kiosk' | 'pwa'
export type KioskPwaLifecycle = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'unavailable' | 'error'

export type KioskPwaPermission = 'notifications' | 'camera' | 'microphone' | 'geolocation' | 'clipboard-read'
export const KIOSK_PWA_PERMISSIONS: readonly KioskPwaPermission[] = [
  'notifications',
  'camera',
  'microphone',
  'geolocation',
  'clipboard-read'
] as const

export type KioskPwaTarget =
  | { kind: 'url'; url: string }
  | { kind: 'app'; appId: string; startUrl: string; name: string }

/** The only fields that are allowed to cross a project or export boundary. */
export interface PortableKioskPwaIntent {
  schemaVersion: typeof KIOSK_PWA_SCHEMA_VERSION
  mode: KioskPwaMode
  target: KioskPwaTarget
  displayName: string
  requestedPermissions: readonly KioskPwaPermission[]
}

/** Host-local state. It must never be serialized into a project file or portable archive. */
export interface KioskPwaLocalProfile {
  profileId: string
  displayName: string
  createdAt: number
  lastUsedAt?: number
  grantedPermissions: readonly KioskPwaPermission[]
}

export interface KioskPwaSession {
  sessionId: string
  ownerNodeId: string
  intent: PortableKioskPwaIntent
  profile: KioskPwaLocalProfile
  lifecycle: KioskPwaLifecycle
  unavailableReason?: string
  error?: string
}

export interface KioskPwaAppCandidate {
  appId: string
  name: string
  startUrl: string
  installed: boolean
}

export type KioskPwaValidationCode =
  | 'invalid-schema'
  | 'invalid-mode'
  | 'invalid-display-name'
  | 'invalid-target'
  | 'invalid-url'
  | 'insecure-url'
  | 'invalid-app-id'
  | 'invalid-permissions'

export interface KioskPwaValidationFailure {
  ok: false
  code: KioskPwaValidationCode
  message: string
}

export interface KioskPwaValidationSuccess {
  ok: true
  value: PortableKioskPwaIntent
}

export type KioskPwaValidation = KioskPwaValidationFailure | KioskPwaValidationSuccess

const MAX_DISPLAY_NAME = 120
const MAX_URL = 2048
const MAX_APP_ID = 128
const SAFE_APP_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u
const INTENT_KEYS = new Set(['schemaVersion', 'mode', 'target', 'displayName', 'requestedPermissions'])
const URL_TARGET_KEYS = new Set(['kind', 'url'])
const APP_TARGET_KEYS = new Set(['kind', 'appId', 'startUrl', 'name'])
const CONTROL = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * HTTPS is required for remote targets. HTTP is retained only for loopback development targets,
 * where the browser host is on the same computer and the user has deliberately selected it.
 * Credentials, fragments, and non-web schemes never enter the portable intent.
 */
export function normalizeKioskPwaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL || CONTROL(value)) return undefined
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined
  if (!parsed.hostname || parsed.username || parsed.password) return undefined
  if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) return undefined
  return parsed.href
}

function validDisplayName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_DISPLAY_NAME && !CONTROL(value)
}

function validPermissionList(value: unknown): value is readonly KioskPwaPermission[] {
  if (!Array.isArray(value) || value.length > KIOSK_PWA_PERMISSIONS.length) return false
  const allowed = new Set(KIOSK_PWA_PERMISSIONS)
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.has(item as KioskPwaPermission) || seen.has(item)) return false
    seen.add(item)
  }
  return true
}

function validateTarget(value: unknown): KioskPwaTarget | KioskPwaValidationFailure {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, code: 'invalid-target', message: 'Choose a web address or an installed web app.' }
  }
  const target = value as Record<string, unknown>
  if (target.kind === 'url') {
    if (Object.keys(target).some((key) => !URL_TARGET_KEYS.has(key))) return { ok: false, code: 'invalid-target', message: 'The URL target contains an unsupported field.' }
    const url = normalizeKioskPwaUrl(target.url)
    return url
      ? { kind: 'url', url }
      : { ok: false, code: 'invalid-url', message: 'Use an HTTPS address, or HTTP on localhost for development.' }
  }
  if (target.kind === 'app') {
    if (Object.keys(target).some((key) => !APP_TARGET_KEYS.has(key))) return { ok: false, code: 'invalid-target', message: 'The installed-app target contains an unsupported field.' }
    if (typeof target.appId !== 'string' || target.appId.length > MAX_APP_ID || !SAFE_APP_ID.test(target.appId)) {
      return { ok: false, code: 'invalid-app-id', message: 'Choose an installed app with a valid stable id.' }
    }
    const startUrl = normalizeKioskPwaUrl(target.startUrl)
    if (!startUrl || typeof target.name !== 'string' || !validDisplayName(target.name)) {
      return { ok: false, code: 'invalid-url', message: 'The selected app has no usable secure start address.' }
    }
    return { kind: 'app', appId: target.appId, startUrl, name: target.name.trim() }
  }
  return { ok: false, code: 'invalid-target', message: 'Choose a web address or an installed web app.' }
}

export function validateKioskPwaIntent(input: unknown): KioskPwaValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'invalid-schema', message: 'This session intent is not an object.' }
  }
  const raw = input as Record<string, unknown>
  if (Object.keys(raw).some((key) => !INTENT_KEYS.has(key))) {
    return { ok: false, code: 'invalid-schema', message: 'This session intent contains an unsupported field.' }
  }
  if (raw.schemaVersion !== KIOSK_PWA_SCHEMA_VERSION) {
    return { ok: false, code: 'invalid-schema', message: 'This kiosk or PWA intent uses an unsupported schema version.' }
  }
  if (raw.mode !== 'kiosk' && raw.mode !== 'pwa') {
    return { ok: false, code: 'invalid-mode', message: 'Choose Kiosk or PWA mode.' }
  }
  if (!validDisplayName(raw.displayName)) {
    return { ok: false, code: 'invalid-display-name', message: 'Enter a display name before opening the session.' }
  }
  const target = validateTarget(raw.target)
  if ('ok' in target && target.ok === false) return target
  if (!validPermissionList(raw.requestedPermissions)) {
    return { ok: false, code: 'invalid-permissions', message: 'Permission requests must come from the supported local list.' }
  }
  return {
    ok: true,
    value: {
      schemaVersion: KIOSK_PWA_SCHEMA_VERSION,
      mode: raw.mode,
      target: target as KioskPwaTarget,
      displayName: raw.displayName.trim(),
      requestedPermissions: [...raw.requestedPermissions] as KioskPwaPermission[]
    }
  }
}

/** The portable projection is validated again before publication, never trusted from memory. */
export function portableKioskPwaIntent(input: unknown): PortableKioskPwaIntent | undefined {
  const result = validateKioskPwaIntent(input)
  return result.ok ? result.value : undefined
}

/** A permission is denied unless the user explicitly requested it for this session. */
export function permissionAllowed(intent: PortableKioskPwaIntent, permission: KioskPwaPermission): boolean {
  return intent.requestedPermissions.includes(permission)
}

const LIFECYCLE_TRANSITIONS: Readonly<Record<KioskPwaLifecycle, readonly KioskPwaLifecycle[]>> = {
  idle: ['starting', 'unavailable'],
  starting: ['stopping', 'running', 'stopped', 'unavailable', 'error'],
  running: ['stopping', 'error', 'unavailable'],
  stopping: ['stopped', 'error'],
  stopped: ['starting', 'unavailable'],
  unavailable: ['starting', 'stopped'],
  error: ['starting', 'stopped', 'unavailable']
}

export function canTransitionKioskPwa(from: KioskPwaLifecycle, to: KioskPwaLifecycle): boolean {
  return LIFECYCLE_TRANSITIONS[from].includes(to)
}

export function availableKioskPwaTargets(candidates: readonly KioskPwaAppCandidate[]): KioskPwaAppCandidate[] {
  return candidates
    .filter((candidate) => candidate.installed && !!normalizeKioskPwaUrl(candidate.startUrl) && SAFE_APP_ID.test(candidate.appId))
    .map((candidate) => ({ ...candidate, startUrl: normalizeKioskPwaUrl(candidate.startUrl)! }))
}
