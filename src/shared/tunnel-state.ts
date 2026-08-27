/**
 * Cloudflare Tunnel state is deliberately a six-part observation, not one optimistic "connected"
 * flag. Each facet has its own timestamp, detail and failure state so a stale DNS record cannot
 * make an unhealthy connector look ready, and an unavailable probe cannot be reported as absent.
 *
 * `TunnelPortableIntent` is safe to put in a schema 3 project projection. It contains user intent
 * only. Provider ids, credentials, machine paths, process ids, connector ids and probe results
 * belong to `TunnelLiveState`, which is local runtime data and must never be serialized into a
 * project file.
 */

export const TUNNEL_STATE_SCHEMA_VERSION = 1 as const

export const TUNNEL_FACETS = [
  'apiCreation',
  'dnsRouting',
  'connectorHealth',
  'accessPolicy',
  'originReachability',
  'externalReachability'
] as const

export type TunnelFacet = (typeof TUNNEL_FACETS)[number]

export const TUNNEL_FACET_LABELS: Record<TunnelFacet, string> = {
  apiCreation: 'API creation',
  dnsRouting: 'DNS routing',
  connectorHealth: 'Connector health',
  accessPolicy: 'Access policy',
  originReachability: 'Origin reachability',
  externalReachability: 'External reachability'
}

export type TunnelFacetStatus = 'unknown' | 'pending' | 'ready' | 'failed' | 'blocked'
export type TunnelOverallStatus = TunnelFacetStatus
export type TunnelFacetSource =
  | 'unavailable'
  | 'local-binding'
  | 'cloudflare-api'
  | 'dns-resolver'
  | 'connector-runtime'
  | 'access-api'
  | 'origin-probe'
  | 'external-probe'

export interface TunnelFacetState {
  status: TunnelFacetStatus
  /** Epoch milliseconds for the observation, or null when nothing has been observed. */
  checkedAt: number | null
  /** The bounded subsystem that supplied this observation, never a credential or path. */
  source: TunnelFacetSource
  /** Evidence is a short factual description of what was observed, not a success prediction. */
  evidence: string
  /** Bounded, non-secret explanation of the observation. */
  detail?: string
  /** Bounded, non-secret recovery reason when status is failed or blocked. */
  reason?: string
  /** Optional retry delay supplied by the provider, capped by the model. */
  retryAfterMs?: number
}

/**
 * User intent that may travel with a schema 3 project. `hostname` and `originPort` describe the
 * desired route, not a machine binding. The destination host and all provider account details are
 * deliberately absent and must be chosen again through Configure or Rebind after import.
 */
export interface TunnelPortableIntent {
  schemaVersion: typeof TUNNEL_STATE_SCHEMA_VERSION
  nodeId: string
  displayName: string
  hostname: string
  originProtocol: 'http' | 'https'
  originPort: number
  connectorMode: 'process' | 'windows-service' | 'docker'
  accessPolicyMode: 'unconfigured' | 'public' | 'protected'
  routeMode: 'unbound' | 'managed-hostname'
}

/** Local-only provider and machine binding facts. Never copy this into project.json. */
export interface TunnelLiveBinding {
  providerAccountLabel?: string
  zoneLabel?: string
  providerTunnelId?: string
  dnsRecordId?: string
  connectorId?: string
  processId?: number
  localConfigPath?: string
  hostLabel?: string
}

export interface TunnelLiveState {
  observedAt: number
  source: 'local'
  /** Monotonic per-node probe generation. Older replies must never replace a newer generation. */
  generation: number
  facets: Record<TunnelFacet, TunnelFacetState>
  /** Present only after the local binding has been selected and observed. */
  binding?: TunnelLiveBinding
}

export const DEFAULT_TUNNEL_PORTABLE_INTENT: TunnelPortableIntent = {
  schemaVersion: TUNNEL_STATE_SCHEMA_VERSION,
  nodeId: '',
  displayName: 'Cloudflare Tunnel',
  hostname: '',
  originProtocol: 'http',
  originPort: 8080,
  connectorMode: 'process',
  accessPolicyMode: 'unconfigured',
  routeMode: 'unbound'
}

export const TUNNEL_STATE_LIMITS = {
  nodeId: 128,
  displayName: 160,
  hostname: 253,
  detail: 512,
  reason: 512,
  evidence: 512,
  maxRetryAfterMs: 24 * 60 * 60 * 1000,
  minOriginPort: 1,
  maxOriginPort: 65535
} as const

const FACET_STATUS_SET: ReadonlySet<string> = new Set([
  'unknown',
  'pending',
  'ready',
  'failed',
  'blocked'
])

const CONNECTOR_MODE_SET: ReadonlySet<string> = new Set(['process', 'windows-service', 'docker'])
const ACCESS_POLICY_MODE_SET: ReadonlySet<string> = new Set(['unconfigured', 'public', 'protected'])
const ROUTE_MODE_SET: ReadonlySet<string> = new Set(['unbound', 'managed-hostname'])
const FACET_SOURCE_SET: ReadonlySet<string> = new Set([
  'unavailable',
  'local-binding',
  'cloudflare-api',
  'dns-resolver',
  'connector-runtime',
  'access-api',
  'origin-probe',
  'external-probe'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined
}

function validOriginPort(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= TUNNEL_STATE_LIMITS.minOriginPort &&
    value <= TUNNEL_STATE_LIMITS.maxOriginPort
  )
}

function validHostname(value: string): boolean {
  if (value.length > TUNNEL_STATE_LIMITS.hostname || value.includes('://')) return false
  if (value.startsWith('.') || value.endsWith('.') || value.includes('/') || value.includes('\\')) return false
  return value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
}

/** Return a fresh empty facet map so callers cannot accidentally share mutable state. */
export function createUnknownTunnelFacets(): Record<TunnelFacet, TunnelFacetState> {
  return Object.fromEntries(
    TUNNEL_FACETS.map((facet) => [facet, {
      status: 'unknown',
      checkedAt: null,
      source: 'unavailable',
      evidence: 'No trustworthy observation has been recorded.'
    }])
  ) as Record<TunnelFacet, TunnelFacetState>
}

export function createUnknownTunnelLiveState(observedAt = 0): TunnelLiveState {
  const safeObservedAt = Number.isSafeInteger(observedAt) && observedAt >= 0 ? observedAt : 0
  return { observedAt: safeObservedAt, source: 'local', generation: 0, facets: createUnknownTunnelFacets() }
}

/**
 * Sanitize portable data at the import boundary. Unknown fields are ignored, but malformed or
 * incomplete required fields return null. No network, provider, process or filesystem operation is
 * performed by this function.
 */
export function sanitizeTunnelPortableIntent(value: unknown): TunnelPortableIntent | null {
  if (!isRecord(value) || value.schemaVersion !== TUNNEL_STATE_SCHEMA_VERSION) return null
  const nodeId = boundedText(value.nodeId, TUNNEL_STATE_LIMITS.nodeId)
  const displayName = boundedText(value.displayName, TUNNEL_STATE_LIMITS.displayName)
  const hostname = boundedText(value.hostname, TUNNEL_STATE_LIMITS.hostname)
  const originProtocol = value.originProtocol
  const connectorMode = value.connectorMode
  const accessPolicyMode = value.accessPolicyMode
  const routeMode = value.routeMode
  if (!nodeId || !displayName || !hostname || !validHostname(hostname) || !validOriginPort(value.originPort)) return null
  if (originProtocol !== 'http' && originProtocol !== 'https') return null
  if (typeof connectorMode !== 'string' || !CONNECTOR_MODE_SET.has(connectorMode)) return null
  if (typeof accessPolicyMode !== 'string' || !ACCESS_POLICY_MODE_SET.has(accessPolicyMode)) return null
  if (typeof routeMode !== 'string' || !ROUTE_MODE_SET.has(routeMode)) return null
  return {
    schemaVersion: TUNNEL_STATE_SCHEMA_VERSION,
    nodeId,
    displayName,
    hostname: hostname.toLowerCase(),
    originProtocol,
    originPort: value.originPort,
    connectorMode: connectorMode as TunnelPortableIntent['connectorMode'],
    accessPolicyMode: accessPolicyMode as TunnelPortableIntent['accessPolicyMode'],
    routeMode: routeMode as TunnelPortableIntent['routeMode']
  }
}

/**
 * A transition may move only one facet at a time. In particular, unknown cannot jump straight to
 * ready, and a failed observation must be retried before it can become ready. The timestamp is
 * monotonic per facet, preventing a delayed response from replacing a newer live result.
 */
const ALLOWED_TRANSITIONS: Record<TunnelFacetStatus, readonly TunnelFacetStatus[]> = {
  unknown: ['pending'],
  pending: ['unknown', 'ready', 'failed', 'blocked'],
  ready: ['unknown', 'pending', 'failed', 'blocked'],
  failed: ['unknown', 'pending'],
  blocked: ['unknown', 'pending']
}

export type TunnelTransitionFailure =
  | 'invalid-status'
  | 'invalid-source'
  | 'invalid-timestamp'
  | 'stale-observation'
  | 'invalid-transition'
  | 'invalid-detail'
  | 'missing-reason'
  | 'invalid-retry-after'

export type TunnelFacetTransition =
  | { ok: true; state: TunnelFacetState }
  | { ok: false; state: TunnelFacetState; reason: TunnelTransitionFailure }

export interface TunnelFacetObservation {
  status: TunnelFacetStatus
  checkedAt: number
  source: TunnelFacetSource
  evidence: string
  detail?: string
  reason?: string
  retryAfterMs?: number
}

export function transitionTunnelFacet(
  current: TunnelFacetState,
  observation: TunnelFacetObservation
): TunnelFacetTransition {
  if (!FACET_STATUS_SET.has(observation.status)) {
    return { ok: false, state: current, reason: 'invalid-status' }
  }
  if (!FACET_SOURCE_SET.has(observation.source)) {
    return { ok: false, state: current, reason: 'invalid-source' }
  }
  if (!Number.isSafeInteger(observation.checkedAt) || observation.checkedAt < 0) {
    return { ok: false, state: current, reason: 'invalid-timestamp' }
  }
  if (current.checkedAt !== null && observation.checkedAt < current.checkedAt) {
    return { ok: false, state: current, reason: 'stale-observation' }
  }
  if (observation.status !== current.status && !ALLOWED_TRANSITIONS[current.status].includes(observation.status)) {
    return { ok: false, state: current, reason: 'invalid-transition' }
  }
  const detail = observation.detail === undefined ? undefined : boundedText(observation.detail, TUNNEL_STATE_LIMITS.detail)
  const reason = observation.reason === undefined ? undefined : boundedText(observation.reason, TUNNEL_STATE_LIMITS.reason)
  const evidence = boundedText(observation.evidence, TUNNEL_STATE_LIMITS.evidence)
  if (observation.detail !== undefined && detail === undefined) {
    return { ok: false, state: current, reason: 'invalid-detail' }
  }
  if (observation.reason !== undefined && reason === undefined) {
    return { ok: false, state: current, reason: 'invalid-detail' }
  }
  if (!evidence) return { ok: false, state: current, reason: 'invalid-detail' }
  if ((observation.status === 'failed' || observation.status === 'blocked') && reason === undefined) {
    return { ok: false, state: current, reason: 'missing-reason' }
  }
  if (
    observation.retryAfterMs !== undefined &&
    (!Number.isSafeInteger(observation.retryAfterMs) ||
      observation.retryAfterMs < 0 ||
      observation.retryAfterMs > TUNNEL_STATE_LIMITS.maxRetryAfterMs)
  ) {
    return { ok: false, state: current, reason: 'invalid-retry-after' }
  }
  const next: TunnelFacetState = {
    status: observation.status,
    checkedAt: observation.checkedAt,
    source: observation.source,
    evidence
  }
  if (detail !== undefined) next.detail = detail
  if (reason !== undefined) next.reason = reason
  if (observation.retryAfterMs !== undefined) next.retryAfterMs = observation.retryAfterMs
  return { ok: true, state: next }
}

export type TunnelStateTransition =
  | { ok: true; state: TunnelLiveState }
  | { ok: false; state: TunnelLiveState; reason: TunnelTransitionFailure }

export function transitionTunnelState(
  current: TunnelLiveState,
  facet: TunnelFacet,
  observation: TunnelFacetObservation
): TunnelStateTransition {
  if (!TUNNEL_FACETS.includes(facet)) return { ok: false, state: current, reason: 'invalid-status' }
  const result = transitionTunnelFacet(current.facets[facet], observation)
  if (!result.ok) return { ok: false, state: current, reason: result.reason }
  return {
    ok: true,
    state: {
      ...current,
      observedAt: Math.max(current.observedAt, observation.checkedAt),
      facets: { ...current.facets, [facet]: result.state }
    }
  }
}

export function tunnelOverallStatus(state: TunnelLiveState | null | undefined): TunnelOverallStatus {
  if (!state) return 'unknown'
  const statuses = TUNNEL_FACETS.map((facet) => state.facets[facet].status)
  if (statuses.includes('failed')) return 'failed'
  if (statuses.includes('blocked')) return 'blocked'
  if (statuses.includes('pending')) return 'pending'
  if (statuses.every((status) => status === 'ready')) return 'ready'
  return 'unknown'
}

export function isTunnelReady(state: TunnelLiveState | null | undefined): boolean {
  return tunnelOverallStatus(state) === 'ready'
}
