/**
 * Portable intent and bounded local state for an isolated debugging browser.
 *
 * This module is intentionally platform-free. A project may describe how a debugging browser
 * should be configured, but it may never carry the machine-specific proxy secret, certificate
 * path, browser executable, process handle, or captured page data. The Electron host consumes
 * the intent and owns the live session lifecycle.
 */

export type DebugBrowserIsolation = 'ephemeral' | 'persistent'
export type DebugBrowserProxyKind = 'direct' | 'http' | 'socks5'
export type DebugBrowserCertificateMode = 'system' | 'reject-invalid' | 'custom'
export type DebugBrowserPhase =
  | 'unbound'
  | 'configuring'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'recovery'
  | 'error'

export interface DebugBrowserProxyIntent {
  kind: DebugBrowserProxyKind
  /** Host and port are safe connection intent. Authentication is a local vault reference only. */
  host?: string
  port?: number
  bypass?: string[]
  requiresAuthentication: boolean
}

export interface DebugBrowserProfile {
  id: string
  name: string
  color: string
  isolation: DebugBrowserIsolation
  proxy: DebugBrowserProxyIntent
  certificateMode: DebugBrowserCertificateMode
  /** A portable label only. The actual user-agent string remains a host-local choice. */
  userAgentLabel?: string
}

/** Safe project-file intent. No certificate path, secret, executable path, or process state. */
export interface DebugBrowserIntent {
  profileId: string
  targetUrl: string
  isolation: DebugBrowserIsolation
  proxy: DebugBrowserProxyIntent
  certificateMode: DebugBrowserCertificateMode
  /** Explicitly asks the host to expose its debugging protocol on a loopback-only endpoint. */
  debuggingEnabled: true
}

export interface DebugBrowserLocalBinding {
  /** Stable vault key, never the secret itself. */
  proxyCredentialRef?: string
  /** The selected certificate path stays local to this computer. */
  certificatePath?: string
  browserExecutable?: string
  userDataDirectory?: string
}

export interface DebugBrowserDiagnostic {
  at: number
  level: 'info' | 'warning' | 'error'
  code: string
  message: string
}

export interface DebugBrowserStatus {
  id: string
  phase: DebugBrowserPhase
  intent: DebugBrowserIntent | null
  localBinding: {
    credentialConfigured: boolean
    certificateConfigured: boolean
    browserConfigured: boolean
  }
  /** Bounded, redacted diagnostics. URLs, credentials, paths and response bodies are excluded. */
  diagnostics: DebugBrowserDiagnostic[]
  progress: number
  reason?: string
  recoveryAction?: 'configure' | 'rebind' | 'locate-certificate' | 'retry' | 'stop'
}

export type DebugBrowserResolution =
  | { ok: true; partition: string; proxy: DebugBrowserProxyIntent; certificateMode: DebugBrowserCertificateMode }
  | { ok: false; phase: 'unbound' | 'recovery' | 'error'; reason: string; nextAction: NonNullable<DebugBrowserStatus['recoveryAction']> }

export const DEFAULT_DEBUG_BROWSER_PROXY: DebugBrowserProxyIntent = {
  kind: 'direct',
  requiresAuthentication: false
}

export const DEFAULT_DEBUG_BROWSER_PROFILE: DebugBrowserProfile = {
  id: 'debug-default',
  name: 'Debug browser',
  color: '#6750A4',
  isolation: 'ephemeral',
  proxy: DEFAULT_DEBUG_BROWSER_PROXY,
  certificateMode: 'reject-invalid'
}

export const MAX_DEBUG_BROWSER_PROFILES = 64
export const MAX_DEBUG_BROWSER_DIAGNOSTICS = 80
export const MAX_DEBUG_BROWSER_BYPASS_ENTRIES = 32
export const MAX_DEBUG_BROWSER_TEXT = 512

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length <= MAX_DEBUG_BROWSER_TEXT && !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : fallback
}

function safeId(value: unknown): string | null {
  const id = boundedText(value)
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) ? id : null
}

function safePort(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535 ? value : undefined
}

function safeProxy(value: unknown): DebugBrowserProxyIntent {
  if (!record(value)) return { ...DEFAULT_DEBUG_BROWSER_PROXY }
  const kind = value.kind === 'http' || value.kind === 'socks5' ? value.kind : 'direct'
  const host = boundedText(value.host)
  const bypass = Array.isArray(value.bypass)
    ? value.bypass.slice(0, MAX_DEBUG_BROWSER_BYPASS_ENTRIES).map((entry) => boundedText(entry)).filter(Boolean)
    : undefined
  return {
    kind,
    ...(kind === 'direct' || !host ? {} : { host }),
    ...(kind === 'direct' || !safePort(value.port) ? {} : { port: safePort(value.port) }),
    ...(bypass?.length ? { bypass } : {}),
    requiresAuthentication: value.requiresAuthentication === true
  }
}

export function normalizeDebugBrowserProfile(value: unknown): DebugBrowserProfile | null {
  if (!record(value)) return null
  const id = safeId(value.id)
  const name = boundedText(value.name)
  const color = boundedText(value.color)
  if (!id || !name || !color) return null
  const proxy = safeProxy(value.proxy)
  if (proxy.kind !== 'direct' && (!proxy.host || !proxy.port)) return null
  return {
    id,
    name,
    color,
    isolation: value.isolation === 'persistent' ? 'persistent' : 'ephemeral',
    proxy,
    certificateMode: value.certificateMode === 'custom' || value.certificateMode === 'system'
      ? value.certificateMode
      : 'reject-invalid',
    ...(boundedText(value.userAgentLabel) ? { userAgentLabel: boundedText(value.userAgentLabel) } : {})
  }
}

export function normalizeDebugBrowserProfiles(value: unknown): DebugBrowserProfile[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const profiles = value.slice(0, MAX_DEBUG_BROWSER_PROFILES).flatMap((entry) => {
    const profile = normalizeDebugBrowserProfile(entry)
    if (!profile || seen.has(profile.id)) return []
    seen.add(profile.id)
    return [profile]
  })
  return profiles.length ? profiles : undefined
}

export function normalizeDebugBrowserIntent(value: unknown): DebugBrowserIntent | null {
  if (!record(value)) return null
  const profileId = safeId(value.profileId)
  const targetUrl = boundedText(value.targetUrl)
  if (!profileId || !targetUrl || value.debuggingEnabled !== true) return null
  try {
    const parsed = new URL(targetUrl)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) return null
  } catch {
    return null
  }
  const proxy = safeProxy(value.proxy)
  if (proxy.kind !== 'direct' && (!proxy.host || !proxy.port)) return null
  return {
    profileId,
    targetUrl,
    isolation: value.isolation === 'persistent' ? 'persistent' : 'ephemeral',
    proxy,
    certificateMode: value.certificateMode === 'custom' || value.certificateMode === 'system'
      ? value.certificateMode
      : 'reject-invalid',
    debuggingEnabled: true
  }
}

/** Stable partition for one project and debugging profile, never the ordinary browser partition. */
export function debugBrowserPartition(projectId: string, profileId: string): string {
  const safe = (value: string): string => value.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'x'
  return `persist:debug-browser-${safe(projectId)}-${safe(profileId)}`
}

/**
 * Resolve the local half before creating a session. Missing local material is a recovery state,
 * never a silent switch to an ordinary browser or to a different proxy.
 */
export function resolveDebugBrowserSession(
  projectId: string,
  intent: DebugBrowserIntent | null,
  local: DebugBrowserLocalBinding | null
): DebugBrowserResolution {
  if (!intent) return { ok: false, phase: 'unbound', reason: 'This debugging browser is not configured on this computer.', nextAction: 'configure' }
  const normalized = normalizeDebugBrowserIntent(intent)
  if (!normalized) return { ok: false, phase: 'error', reason: 'The saved debugging browser intent is invalid and was not applied.', nextAction: 'configure' }
  if (!local?.browserExecutable) return { ok: false, phase: 'recovery', reason: 'The debugging browser executable is not bound on this computer.', nextAction: 'rebind' }
  if (normalized.certificateMode === 'custom' && !local.certificatePath) {
    return { ok: false, phase: 'recovery', reason: 'A custom certificate was selected but no local certificate is bound.', nextAction: 'locate-certificate' }
  }
  if (normalized.proxy.requiresAuthentication && !local.proxyCredentialRef) {
    return { ok: false, phase: 'recovery', reason: 'This proxy requires a local credential before the session can start.', nextAction: 'configure' }
  }
  return {
    ok: true,
    partition: debugBrowserPartition(projectId, normalized.profileId),
    proxy: normalized.proxy,
    certificateMode: normalized.certificateMode
  }
}

export function appendDebugBrowserDiagnostic(
  current: readonly DebugBrowserDiagnostic[],
  diagnostic: DebugBrowserDiagnostic
): DebugBrowserDiagnostic[] {
  const message = boundedText(diagnostic.message, 'Debug browser operation reported an unavailable detail.')
  const code = safeId(diagnostic.code) ?? 'unknown'
  return [...current, { ...diagnostic, message, code }].slice(-MAX_DEBUG_BROWSER_DIAGNOSTICS)
}

/** Scrub local-only values before a status record crosses a renderer or project boundary. */
export function redactDebugBrowserStatus(status: DebugBrowserStatus): DebugBrowserStatus {
  return {
    ...status,
    localBinding: {
      credentialConfigured: status.localBinding.credentialConfigured,
      certificateConfigured: status.localBinding.certificateConfigured,
      browserConfigured: status.localBinding.browserConfigured
    },
    diagnostics: status.diagnostics.slice(-MAX_DEBUG_BROWSER_DIAGNOSTICS).map((entry) => ({
      at: Number.isFinite(entry.at) ? entry.at : 0,
      level: entry.level,
      code: safeId(entry.code) ?? 'unknown',
      message: boundedText(entry.message, 'Debug browser operation reported an unavailable detail.')
    }))
  }
}

