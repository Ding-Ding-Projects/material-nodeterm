/**
 * Typed contract for exposing a locally hosted service through a Cloudflare Tunnel.
 *
 * This module contains intent and state only. It never stores a token, account session,
 * tunnel id, connector process state, or machine path. Those values belong to the local
 * provider binding that lives beside serviceConnection in the machine-local index.
 */

export type HostedServiceKind = 'gitlab' | 'nextcloud' | 'open-webui'
export type HostedServiceOriginScheme = 'http' | 'https'
export type HostedServiceOriginSource = 'configured-endpoint' | 'container-port' | 'health-discovery'

export interface HostedServiceOrigin {
  scheme: HostedServiceOriginScheme
  hostname: string
  port?: number
  path: string
}

export interface HostedServiceOriginCandidate {
  id: string
  label: string
  origin: HostedServiceOrigin
  source: HostedServiceOriginSource
  health: 'unknown' | 'checking' | 'healthy' | 'unhealthy'
  checkedAt?: string
  latencyMs?: number
  detail?: string
}

/** Safe intent that may travel in a schema 3 project projection. */
export interface HostedServiceTunnelIntent {
  provider: 'cloudflare-tunnel'
  exposure: 'private-first'
  access: 'required'
  healthPath: string
}

/** Local-only account, zone and hostname selection. No credential or provider session is here. */
export interface HostedServiceTunnelBinding {
  accountId: string
  zoneId: string
  hostname: string
  access: 'required'
  origin: HostedServiceOrigin
  state: HostedServiceTunnelState
  updatedAt: string
}

export interface HostedServiceTunnelHandoffInput {
  serviceKind: HostedServiceKind
  origin: HostedServiceOrigin
  accountId: string
  zoneId: string
  hostname: string
  access: 'required'
}

export type HostedServiceTunnelState =
  | 'unbound'
  | 'discovering-origin'
  | 'checking-local-health'
  | 'ready'
  | 'handing-off'
  | 'connected'
  | 'failed'
  | 'rolled-back'

export interface HostedServiceTunnelStatus {
  state: HostedServiceTunnelState
  message: string
  origin?: HostedServiceOrigin
  hostname?: string
  access: 'required'
  checkedAt?: string
  errorCode?: 'origin-invalid' | 'health-failed' | 'selection-incomplete' | 'handoff-failed'
}

const HOSTNAME = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]{0,1023}$/

export function validateHostedServiceHostname(value: unknown): value is string {
  return typeof value === 'string' && HOSTNAME.test(value.trim()) && value.length <= 253
}

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value)
}

/** Parse a service origin without accepting credentials, fragments, query strings, or file URLs. */
export function parseHostedServiceOrigin(value: unknown): HostedServiceOrigin | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.username || parsed.password || parsed.hash || parsed.search) return null
  if (!HOSTNAME.test(parsed.hostname)) return null
  const port = parsed.port ? Number(parsed.port) : undefined
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) return null
  const path = parsed.pathname || '/'
  if (!PATH.test(path)) return null
  return {
    scheme: parsed.protocol === 'https:' ? 'https' : 'http',
    hostname: parsed.hostname.toLowerCase(),
    ...(port !== undefined ? { port } : {}),
    path
  }
}

export function formatHostedServiceOrigin(origin: HostedServiceOrigin): string {
  const port = origin.port === undefined ? '' : `:${origin.port}`
  return `${origin.scheme}://${origin.hostname}${port}${origin.path || '/'}`
}

/**
 * Keep a candidate list deterministic and typed. A malformed candidate is omitted, never repaired
 * into a different origin. The caller can show that no usable origin was discovered.
 */
export function normalizeHostedServiceCandidates(
  candidates: readonly Partial<HostedServiceOriginCandidate>[]
): HostedServiceOriginCandidate[] {
  return candidates
    .filter((candidate): candidate is HostedServiceOriginCandidate =>
      boundedId(candidate.id) &&
      typeof candidate.label === 'string' && candidate.label.length > 0 && candidate.label.length <= 256 &&
      !!candidate.origin &&
      !!parseHostedServiceOrigin(formatHostedServiceOrigin(candidate.origin)) &&
      ['configured-endpoint', 'container-port', 'health-discovery'].includes(String(candidate.source)) &&
      ['unknown', 'checking', 'healthy', 'unhealthy'].includes(String(candidate.health))
    )
    .map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      origin: candidate.origin,
      source: candidate.source,
      health: candidate.health,
      ...(candidate.checkedAt ? { checkedAt: candidate.checkedAt } : {}),
      ...(candidate.latencyMs !== undefined && Number.isFinite(candidate.latencyMs) ? { latencyMs: candidate.latencyMs } : {}),
      ...(candidate.detail ? { detail: candidate.detail.slice(0, 512) } : {})
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
}

export interface HostedServiceDiscoveryInput {
  configuredEndpoint?: string
  containerPorts?: Array<{
    id: string
    label: string
    hostname: string
    port: number
    scheme?: HostedServiceOriginScheme
    path?: string
  }>
}

/**
 * Build the origin catalogue from typed observations only. A container record contributes a
 * candidate, but it never contributes an image, command, socket, or connector authority.
 */
export function discoverHostedServiceOrigins(input: HostedServiceDiscoveryInput): HostedServiceOriginCandidate[] {
  const candidates: Partial<HostedServiceOriginCandidate>[] = []
  if (input.configuredEndpoint) {
    const origin = parseHostedServiceOrigin(input.configuredEndpoint)
    if (origin) candidates.push({ id: 'configured-origin', label: 'Configured service origin', origin, source: 'configured-endpoint', health: 'unknown' })
  }
  for (const port of input.containerPorts ?? []) {
    if (!boundedId(port.id) || typeof port.label !== 'string' || port.label.length === 0 || !validateHostedServiceHostname(port.hostname) || !Number.isInteger(port.port) || port.port < 1 || port.port > 65535) continue
    const origin = parseHostedServiceOrigin(formatHostedServiceOrigin({ scheme: port.scheme ?? 'http', hostname: port.hostname, port: port.port, path: port.path ?? '/' }))
    if (origin) candidates.push({ id: port.id, label: port.label, origin, source: 'container-port', health: 'unknown' })
  }
  return normalizeHostedServiceCandidates(candidates)
}

export function validateHostedServiceTunnelIntent(value: unknown): HostedServiceTunnelIntent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.provider !== 'cloudflare-tunnel' || raw.exposure !== 'private-first' || raw.access !== 'required') return null
  if (typeof raw.healthPath !== 'string' || !PATH.test(raw.healthPath)) return null
  return { provider: 'cloudflare-tunnel', exposure: 'private-first', access: 'required', healthPath: raw.healthPath }
}

export function validateHostedServiceTunnelBinding(value: unknown): HostedServiceTunnelBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  let origin: HostedServiceOrigin | null = null
  if (typeof raw.origin === 'string') {
    origin = parseHostedServiceOrigin(raw.origin)
  } else if (raw.origin && typeof raw.origin === 'object' && !Array.isArray(raw.origin)) {
    const candidate = raw.origin as Record<string, unknown>
    if ((candidate.scheme === 'http' || candidate.scheme === 'https') && typeof candidate.hostname === 'string' && typeof candidate.path === 'string' && (candidate.port === undefined || typeof candidate.port === 'number')) {
      origin = parseHostedServiceOrigin(formatHostedServiceOrigin(candidate as unknown as HostedServiceOrigin))
    }
  }
  if (!boundedId(raw.accountId) || !boundedId(raw.zoneId) || !validateHostedServiceHostname(raw.hostname) || !origin) return null
  if (raw.access !== 'required' || typeof raw.updatedAt !== 'string' || !Number.isFinite(Date.parse(raw.updatedAt))) return null
  if (!['unbound', 'discovering-origin', 'checking-local-health', 'ready', 'handing-off', 'connected', 'failed', 'rolled-back'].includes(String(raw.state))) return null
  return {
    accountId: raw.accountId,
    zoneId: raw.zoneId,
    hostname: raw.hostname.toLowerCase(),
    access: 'required',
    origin,
    state: raw.state as HostedServiceTunnelState,
    updatedAt: raw.updatedAt
  }
}

export function handoffStatusFor(
  state: HostedServiceTunnelState,
  origin?: HostedServiceOrigin,
  hostname?: string,
  message?: string,
  errorCode?: HostedServiceTunnelStatus['errorCode']
): HostedServiceTunnelStatus {
  return {
    state,
    message: message ?? defaultTunnelMessage(state),
    access: 'required',
    ...(origin ? { origin } : {}),
    ...(hostname ? { hostname } : {}),
    ...(errorCode ? { errorCode } : {})
  }
}

function defaultTunnelMessage(state: HostedServiceTunnelState): string {
  switch (state) {
    case 'unbound': return 'No Cloudflare Tunnel binding is selected.'
    case 'discovering-origin': return 'Finding a typed local service origin.'
    case 'checking-local-health': return 'Checking local service health before exposure.'
    case 'ready': return 'Local health verified. The service is ready for a private Cloudflare handoff.'
    case 'handing-off': return 'Handing off the verified origin to Cloudflare with Access required.'
    case 'connected': return 'Cloudflare handoff is connected with Access required.'
    case 'failed': return 'Cloudflare handoff failed. The local service remains unchanged.'
    case 'rolled-back': return 'Cloudflare handoff was rolled back. The local service remains unchanged.'
  }
}

export interface LocalHealthProbeResult {
  ok: boolean
  status?: number
  latencyMs?: number
  detail?: string
}

export type LocalHealthProbe = (origin: HostedServiceOrigin, signal: AbortSignal) => Promise<LocalHealthProbeResult>

/** Run the local check with a bounded deadline. It never mutates provider state. */
export async function verifyHostedServiceHealth(
  origin: HostedServiceOrigin,
  probe: LocalHealthProbe,
  timeoutMs = 8_000
): Promise<HostedServiceTunnelStatus> {
  const controller = new AbortController()
  const boundedTimeout = Math.max(250, Math.min(timeoutMs, 30_000))
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, boundedTimeout)
  try {
    const result = await Promise.race([
      probe(origin, controller.signal),
      new Promise<LocalHealthProbeResult>((_, reject) => setTimeout(() => reject(new Error('Local health check timed out.')), boundedTimeout))
    ])
    if (result.ok) return { ...handoffStatusFor('ready', origin), checkedAt: new Date().toISOString() }
    return { ...handoffStatusFor('failed', origin, undefined, result.detail ?? `Local health returned HTTP ${result.status ?? 'unknown'}.`, 'health-failed'), checkedAt: new Date().toISOString() }
  } catch (error) {
    const detail = timedOut || controller.signal.aborted ? 'Local health check timed out.' : error instanceof Error ? error.message : String(error)
    return { ...handoffStatusFor('failed', origin, undefined, detail, 'health-failed'), checkedAt: new Date().toISOString() }
  } finally {
    clearTimeout(timer)
  }
}
