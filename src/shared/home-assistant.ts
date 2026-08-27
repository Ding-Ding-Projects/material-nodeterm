/**
 * Home Assistant multi-instance client contracts.
 *
 * Instance metadata and credentials are machine-local. Canvas nodes retain only a display label
 * and a machine-local binding, so schema 3 exports cannot leak a host, bearer token, session,
 * entity cache, or WebSocket state.
 */

export type HomeAssistantTransport = 'rest' | 'websocket'
export type HomeAssistantConnectionState =
  | 'unconfigured'
  | 'ready'
  | 'connecting'
  | 'connected'
  | 'offline'
  | 'authentication-failed'
  | 'cancelled'

export interface HomeAssistantInstance {
  id: string
  displayName: string
  baseUrl: string
  hasToken: boolean
  createdAt: number
  updatedAt: number
}

export interface HomeAssistantInstanceInput {
  id?: string
  displayName: string
  baseUrl: string
  /** Write-only. The core never returns this value. Null retains the existing token. */
  token: string | null
}

/** Safe, portable presentation intent. It contains no instance id, host, credential, or cache. */
export interface HomeAssistantNodeIntent {
  transport: HomeAssistantTransport
  domain: string
}

export const DEFAULT_HOME_ASSISTANT_NODE_INTENT: HomeAssistantNodeIntent = {
  transport: 'rest',
  domain: 'all'
}

export interface HomeAssistantEntity {
  entityId: string
  domain: string
  objectId: string
  state: string
  friendlyName: string
  icon: string | null
  unitOfMeasurement: string | null
  deviceClass: string | null
  lastChanged: string | null
  lastUpdated: string | null
}

export interface HomeAssistantDiscoveryRequest {
  instanceId: string
  transport: HomeAssistantTransport
  operationId: string
}

export interface HomeAssistantDiscoveryResult {
  instanceId: string
  transport: HomeAssistantTransport
  state: HomeAssistantConnectionState
  entities: HomeAssistantEntity[]
  domains: string[]
  complete: boolean
  partial: boolean
  discoveredAt: number
  reason: string | null
}

export interface HomeAssistantClientEvent {
  operationId: string
  instanceId: string
  transport: HomeAssistantTransport
  phase: 'connecting' | 'authenticating' | 'discovering' | 'completed' | 'failed' | 'cancelled'
  progress: number
  message: string
}

export interface HomeAssistantApi {
  instances(): Promise<HomeAssistantInstance[]>
  saveInstance(input: HomeAssistantInstanceInput): Promise<HomeAssistantInstance>
  removeInstance(id: string): Promise<boolean>
  discover(request: HomeAssistantDiscoveryRequest): Promise<HomeAssistantDiscoveryResult>
  cancel(operationId: string): Promise<boolean>
  onEvent(listener: (event: HomeAssistantClientEvent) => void): () => void
}

export function isHomeAssistantInstanceId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
}

export function normalizeHomeAssistantBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Home Assistant address is invalid.')
  }
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('Enter a complete Home Assistant address.') }
  if (url.username || url.password) throw new Error('Remove credentials from the address. Store the access token separately.')
  if (url.search || url.hash) throw new Error('Home Assistant addresses cannot contain a query or fragment.')
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Use HTTPS. Plain HTTP is allowed only for an explicit loopback address.')
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.href.replace(/\/$/, '')
}

export function validateHomeAssistantInstanceInput(input: HomeAssistantInstanceInput): HomeAssistantInstanceInput {
  const displayName = input.displayName.trim()
  if (!displayName || displayName.length > 120 || /[\u0000-\u001f\u007f]/.test(displayName)) {
    throw new Error('Instance name must contain 1 to 120 printable characters.')
  }
  if (input.id !== undefined && !isHomeAssistantInstanceId(input.id)) throw new Error('Home Assistant instance id is invalid.')
  if (input.token !== null && (input.token.trim() !== input.token || input.token.length < 1 || input.token.length > 8192 || /[\r\n\0]/.test(input.token))) {
    throw new Error('Home Assistant access token is empty or malformed.')
  }
  return { id: input.id, displayName, baseUrl: normalizeHomeAssistantBaseUrl(input.baseUrl), token: input.token }
}

export function normalizeHomeAssistantEntity(value: unknown): HomeAssistantEntity | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.entity_id !== 'string' || !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(record.entity_id)) return null
  const [domain, objectId] = record.entity_id.split('.', 2)
  const attributes = record.attributes && typeof record.attributes === 'object'
    ? record.attributes as Record<string, unknown>
    : {}
  const bounded = (item: unknown, max = 500): string | null =>
    typeof item === 'string' && item.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(item) ? item : null
  return {
    entityId: record.entity_id,
    domain,
    objectId,
    state: bounded(record.state, 1000) ?? 'unknown',
    friendlyName: bounded(attributes.friendly_name, 500) ?? record.entity_id,
    icon: bounded(attributes.icon, 200),
    unitOfMeasurement: bounded(attributes.unit_of_measurement, 100),
    deviceClass: bounded(attributes.device_class, 100),
    lastChanged: bounded(record.last_changed, 100),
    lastUpdated: bounded(record.last_updated, 100)
  }
}
