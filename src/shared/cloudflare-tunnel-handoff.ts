/**
 * Shared contracts for handing a locally healthy hosted service to Cloudflare Tunnel.
 *
 * The project file carries only the user's safe routing intent. Account, zone, tunnel,
 * connector, credential, process, host, and origin endpoint details stay machine-local.
 */

export const CLOUDFLARE_TUNNEL_INTENT_VERSION = 1 as const

export type HostedServiceHealthState = 'unknown' | 'checking' | 'healthy' | 'unhealthy' | 'unavailable'
export type TunnelExternalState = 'not-started' | 'awaiting-confirmation' | 'creating' | 'connector-unverified' | 'reachable' | 'unreachable'

export interface HostedServiceOrigin {
  id: string
  label: string
  /** Loopback URL of the locally published service. Never a public URL. */
  endpoint: string
  healthPath: string
  port: number
}

export interface HostedServiceHealth {
  originId: string
  state: HostedServiceHealthState
  checkedAt: number | null
  latencyMs: number | null
  reason: string | null
}

/** Safe routing intent that may travel in schema 3. It contains no provider identity or secret. */
export interface CloudflareTunnelIntent {
  schemaVersion: typeof CLOUDFLARE_TUNNEL_INTENT_VERSION
  featureId: 'cloudflare-tunnel-handoff'
  serviceId: string
  originId: string
  hostnameHint: string
  pathPrefix: string
  exposure: 'explicit-after-local-health'
  bindMode: 'private-origin'
}

/** Machine-local summaries returned by the provider adapter. These are not portable state. */
export interface CloudflareAccountSummary {
  id: string
  label: string
  available: boolean
  reason: string | null
}

export interface CloudflareZoneSummary {
  id: string
  name: string
  accountId: string
  available: boolean
  reason: string | null
}

export interface CloudflareTunnelCapabilities {
  available: boolean
  canCreateTunnel: boolean
  canStartConnector: boolean
  canVerifyExternal: boolean
  reason: string | null
}

export interface CloudflareTunnelHandoffState {
  nodeId: string
  localHealth: HostedServiceHealth
  selectedOriginId: string | null
  intent: CloudflareTunnelIntent
  external: TunnelExternalState
  tunnelId: string | null
  connectorState: 'not-started' | 'starting' | 'running' | 'unhealthy' | 'unknown'
  reason: string | null
}

export type CloudflareTunnelHandoffStage =
  | 'checking-local-health'
  | 'local-health-failed'
  | 'awaiting-exposure-confirmation'
  | 'validating-provider-binding'
  | 'creating-tunnel'
  | 'starting-connector'
  | 'verifying-external-reachability'
  | 'completed'
  | 'partial'
  | 'cancelled'
  | 'failed'

export interface CloudflareTunnelHandoffProgress {
  operationId: string
  stage: CloudflareTunnelHandoffStage
  progress: number
  message: string
}

export interface CloudflareTunnelHandoffRequest {
  nodeId: string
  intent: CloudflareTunnelIntent
  originId: string
  accountId: string
  zoneId: string
  confirmExternalExposure: boolean
}

export interface CloudflareTunnelHandoffResult {
  ok: boolean
  state: CloudflareTunnelHandoffState
  binding: {
    accountId: string
    zoneId: string
    tunnelId: string
    connectorId: string
  } | null
  error: string | null
}

export interface CloudflareTunnelHandoffApi {
  origins(nodeId: string): Promise<HostedServiceOrigin[]>
  health(nodeId: string, originId: string): Promise<HostedServiceHealth>
  capabilities(): Promise<CloudflareTunnelCapabilities>
  accounts(): Promise<CloudflareAccountSummary[]>
  zones(accountId: string): Promise<CloudflareZoneSummary[]>
  handoff(request: CloudflareTunnelHandoffRequest): Promise<CloudflareTunnelHandoffResult>
  cancel(operationId: string): void
  onProgress(listener: (progress: CloudflareTunnelHandoffProgress) => void): () => void
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function safeText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || [...value].some((char) => {
    const code = char.charCodeAt(0)
    return code < 0x20 || code === 0x7f
  })) throw new Error(`${label} is invalid.`)
  return value
}

function safeId(value: unknown, label: string): string {
  const text = safeText(value, label, 128)
  if (!SAFE_ID.test(text)) throw new Error(`${label} is invalid.`)
  return text
}

function safeLoopbackEndpoint(value: unknown): string {
  const endpoint = safeText(value, 'Hosted-service origin endpoint', 2048)
  let url: URL
  try { url = new URL(endpoint) } catch { throw new Error('Hosted-service origin endpoint is invalid.') }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)) {
    throw new Error('Hosted-service origin must use loopback HTTP.')
  }
  if (url.username || url.password) throw new Error('Hosted-service origin must not contain credentials.')
  return url.href
}

export function validateHostedServiceOrigin(value: unknown): HostedServiceOrigin {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Hosted-service origin is invalid.')
  const input = value as Record<string, unknown>
  const allowed = new Set(['id', 'label', 'endpoint', 'healthPath', 'port'])
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`Hosted-service origin contains an unknown field: ${key}`)
  const healthPath = safeText(input.healthPath, 'Hosted-service health path', 256)
  if (!healthPath.startsWith('/') || healthPath.includes('\\') || healthPath.includes('?') || healthPath.includes('#')) {
    throw new Error('Hosted-service health path must be a local path.')
  }
  if (typeof input.port !== 'number' || !Number.isSafeInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error('Hosted-service origin port is invalid.')
  }
  return {
    id: safeId(input.id, 'Hosted-service origin id'),
    label: safeText(input.label, 'Hosted-service origin label', 256),
    endpoint: safeLoopbackEndpoint(input.endpoint),
    healthPath,
    port: input.port
  }
}

/** Validate the only state that may be written into a portable project projection. */
export function validateCloudflareTunnelIntent(value: unknown): CloudflareTunnelIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Cloudflare Tunnel intent is invalid.')
  const input = value as Record<string, unknown>
  const allowed = new Set(['schemaVersion', 'featureId', 'serviceId', 'originId', 'hostnameHint', 'pathPrefix', 'exposure', 'bindMode'])
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`Cloudflare Tunnel intent contains an unknown field: ${key}`)
  if (input.schemaVersion !== CLOUDFLARE_TUNNEL_INTENT_VERSION || input.featureId !== 'cloudflare-tunnel-handoff') {
    throw new Error('Cloudflare Tunnel intent version or feature id is unsupported.')
  }
  if (input.exposure !== 'explicit-after-local-health' || input.bindMode !== 'private-origin') {
    throw new Error('Cloudflare Tunnel intent requires explicit exposure after local health.')
  }
  const hostnameHint = safeText(input.hostnameHint, 'Cloudflare hostname hint', 253).toLowerCase()
  if (!HOSTNAME.test(hostnameHint)) throw new Error('Cloudflare hostname hint is invalid.')
  const pathPrefix = safeText(input.pathPrefix, 'Cloudflare path prefix', 256)
  if (!pathPrefix.startsWith('/') || pathPrefix.includes('\\') || pathPrefix.includes('?') || pathPrefix.includes('#')) {
    throw new Error('Cloudflare path prefix is invalid.')
  }
  return {
    schemaVersion: 1,
    featureId: 'cloudflare-tunnel-handoff',
    serviceId: safeId(input.serviceId, 'Hosted-service id'),
    originId: safeId(input.originId, 'Hosted-service origin id'),
    hostnameHint,
    pathPrefix,
    exposure: 'explicit-after-local-health',
    bindMode: 'private-origin'
  }
}

export function validateCloudflareTunnelHandoffRequest(value: unknown): CloudflareTunnelHandoffRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Cloudflare Tunnel handoff request is invalid.')
  const input = value as Record<string, unknown>
  const allowed = new Set(['nodeId', 'intent', 'originId', 'accountId', 'zoneId', 'confirmExternalExposure'])
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`Cloudflare Tunnel handoff request contains an unknown field: ${key}`)
  if (typeof input.confirmExternalExposure !== 'boolean') throw new Error('Cloudflare exposure confirmation is required.')
  const intent = validateCloudflareTunnelIntent(input.intent)
  return {
    nodeId: safeId(input.nodeId, 'Cloudflare handoff node id'),
    intent,
    originId: safeId(input.originId, 'Hosted-service origin id'),
    accountId: safeId(input.accountId, 'Cloudflare account id'),
    zoneId: safeId(input.zoneId, 'Cloudflare zone id'),
    confirmExternalExposure: input.confirmExternalExposure
  }
}

/** Local health is the hard prerequisite. Provider state can never upgrade an unhealthy origin. */
export function canStartCloudflareHandoff(
  health: HostedServiceHealth,
  origin: HostedServiceOrigin,
  intent: CloudflareTunnelIntent,
  request: CloudflareTunnelHandoffRequest
): { ok: true } | { ok: false; reason: string } {
  const cleanOrigin = validateHostedServiceOrigin(origin)
  const cleanIntent = validateCloudflareTunnelIntent(intent)
  const cleanRequest = validateCloudflareTunnelHandoffRequest(request)
  if (cleanRequest.originId !== cleanOrigin.id || cleanIntent.originId !== cleanOrigin.id) return { ok: false, reason: 'The selected origin does not match the portable intent.' }
  if (cleanRequest.intent.serviceId !== cleanIntent.serviceId) return { ok: false, reason: 'The selected service does not match the portable intent.' }
  if (health.originId !== cleanOrigin.id || health.state !== 'healthy') return { ok: false, reason: health.reason ?? 'Verify the local service health before exposing it.' }
  if (!request.confirmExternalExposure) return { ok: false, reason: 'Explicitly confirm external exposure after reviewing the healthy local origin.' }
  return { ok: true }
}
