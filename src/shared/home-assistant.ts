/**
 * Home Assistant multi-instance client contracts.
 *
 * Instance metadata and credentials are machine-local. Canvas nodes retain only a display label
 * and a machine-local binding, so schema 3 exports cannot leak a host, bearer token, session,
 * entity cache, or WebSocket state.
 *
 * This file also carries a union of exports pulled in from two sibling feature lines that each
 * extended an older base independently: a "controls" instance/binding/service-call contract and
 * a "sensors" display/formatting contract. Where a name is unique to one side it is included
 * verbatim below. A few names collided between this discovery-based contract and one of the
 * sibling lines with genuinely incompatible shapes or behavior; those are intentionally NOT
 * merged here. See the reconciliation notes near the end of this file.
 */

export type HomeAssistantTransport = 'rest' | 'websocket'
export type HomeAssistantConnectionState =
  | 'unconfigured'
  | 'ready'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'authentication-failed'
  | 'auth-error'
  | 'invalid'
  | 'error'
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

export function isHomeAssistantTransport(value: unknown): value is HomeAssistantTransport {
  return value === 'rest' || value === 'websocket'
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
  // WHATWG URL keeps brackets around an IPv6 host in `hostname` on some supported runtimes.
  // Accept both spellings so the explicit loopback exception does not reject a safe local HA
  // instance merely because the runtime chose the bracketed representation.
  const loopbackHost = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const loopback = loopbackHost === 'localhost' || loopbackHost === '127.0.0.1' || loopbackHost === '::1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Use HTTPS. Plain HTTP is allowed only for an explicit loopback address.')
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.href.replace(/\/$/, '')
}

export function validateHomeAssistantInstanceInput(input: HomeAssistantInstanceInput): HomeAssistantInstanceInput {
  if (!input || typeof input !== 'object') throw new Error('Home Assistant instance details are invalid.')
  if (typeof input.displayName !== 'string') throw new Error('Instance name must contain 1 to 120 printable characters.')
  const displayName = input.displayName.trim()
  if (!displayName || displayName.length > 120 || /[\u0000-\u001f\u007f]/.test(displayName)) {
    throw new Error('Instance name must contain 1 to 120 printable characters.')
  }
  if (input.id !== undefined && !isHomeAssistantInstanceId(input.id)) throw new Error('Home Assistant instance id is invalid.')
  if (input.token !== null && (typeof input.token !== 'string' || input.token.trim() !== input.token || input.token.length < 1 || input.token.length > 8192 || /[\r\n\0]/.test(input.token))) {
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

// ---------------------------------------------------------------------------------------------
// Additions from the "controls" line (instance/binding/service-call contract). HomeAssistantApi,
// HomeAssistantInstance, HomeAssistantEntity, HomeAssistantNodeIntent, and HomeAssistantSnapshot
// (which depends on the first two) are intentionally NOT duplicated here -- see the
// reconciliation notes near the end of this file.
// ---------------------------------------------------------------------------------------------

export const HOME_ASSISTANT_SCHEMA_VERSION = 1 as const
export const HOME_ASSISTANT_MAX_INSTANCES = 32
export const HOME_ASSISTANT_MAX_ENTITIES = 20_000
export const HOME_ASSISTANT_MAX_ENTITY_REGISTRY = 20_000
export const HOME_ASSISTANT_MAX_SERVICES = 2_000
export const HOME_ASSISTANT_MAX_DEVICES = 10_000
export const HOME_ASSISTANT_MAX_AREAS = 2_000
export const HOME_ASSISTANT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
export const HOME_ASSISTANT_REQUEST_TIMEOUT_MS = 8_000
export const HOME_ASSISTANT_WS_TIMEOUT_MS = 8_000
/** Explicit service metadata. Unknown services are never treated as safe by the call boundary. */
export const HOME_ASSISTANT_DESTRUCTIVE_SERVICES = new Set([
  'delete', 'remove', 'destroy', 'disable', 'stop', 'turn_off', 'close', 'unload'
])

export interface HomeAssistantBinding {
  id: string
  nodeId: string
  instanceId: string
  entityId: string
  createdAt: number
}

export interface HomeAssistantLocalBinding { instanceId?: string; entityId?: string }

export interface HomeAssistantConnectionStatus {
  instanceId: string
  state: HomeAssistantConnectionState
  detail: string | null
  lastConnectedAt: number | null
  lastSyncAt: number | null
  reconnectAttempt: number
  generation: number
  hasToken: boolean
}

export interface HomeAssistantEntityRegistryEntry {
  entity_id: string
  unique_id: string
  platform: string | null
  device_id: string | null
  area_id: string | null
  disabled_by: string | null
  hidden_by: string | null
  name: string | null
}

export interface HomeAssistantService {
  domain: string
  service: string
  name: string
  description: string
  fields: Record<string, unknown>
  risk?: 'safe' | 'destructive' | 'unknown'
}

export function homeAssistantServiceRisk(service: string): 'safe' | 'destructive' | 'unknown' {
  if (!/^[a-z0-9_]+$/u.test(service)) return 'unknown'
  return HOME_ASSISTANT_DESTRUCTIVE_SERVICES.has(service) ? 'destructive' : 'unknown'
}

export type HomeAssistantFieldKind = 'text' | 'number' | 'boolean' | 'select' | 'entity' | 'color' | 'duration' | 'unknown'
export interface HomeAssistantFieldSchema {
  name: string
  description?: string
  required?: boolean
  selector?: { kind: HomeAssistantFieldKind; min?: number; max?: number; step?: number; options?: Array<{ value: string; label?: string }>; multiple?: boolean }
}
export interface HomeAssistantServiceSchema extends HomeAssistantService {
  typedFields: HomeAssistantFieldSchema[]
  canCall?: boolean
  permissionReason?: string
}

export interface HomeAssistantDevice {
  id: string
  name: string
  name_by_user: string | null
  manufacturer: string | null
  model: string | null
  area_id: string | null
  config_entries: string[]
  identifiers: Array<[string, string]>
}

export interface HomeAssistantArea {
  id: string
  name: string
  aliases: string[]
  picture: string | null
}

export interface HomeAssistantCreateInput {
  label: string
  baseUrl: string
  enabled?: boolean
  token?: string
}

export interface HomeAssistantUpdateInput {
  id: string
  label?: string
  baseUrl?: string
  enabled?: boolean
}

export function isHomeAssistantEntityId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 255 && /^[a-z0-9_]+\.[a-z0-9_]+$/u.test(value)
}

export function isHomeAssistantBindingId(value: unknown): value is string {
  return isHomeAssistantInstanceId(value)
}

export function isSafeHomeAssistantServiceName(value: string): boolean {
  return /^[a-z0-9_]{1,64}$/iu.test(value)
}

// ---------------------------------------------------------------------------------------------
// Additions from the "sensors" line (entity display/formatting contract). HomeAssistantApi and
// normalizeHomeAssistantEntity are intentionally NOT duplicated here -- both names collide with
// existing exports above with a genuinely different shape/return type. See the reconciliation
// notes near the end of this file.
// ---------------------------------------------------------------------------------------------

export type HomeAssistantSensorDisplayMode =
  | 'numeric'
  | 'binary'
  | 'enum'
  | 'gauge'
  | 'trend'
  | 'event'
  | 'weather'
  | 'calendar'
  | 'attributes'

export type HomeAssistantReadingStatus =
  | 'available'
  | 'unknown'
  | 'unavailable'
  | 'stale'
  | 'invalid-timestamp'
  | 'offline'

export type HomeAssistantAttributeValue =
  | string
  | number
  | boolean
  | null
  | HomeAssistantAttributeValue[]
  | { [key: string]: HomeAssistantAttributeValue }

export interface HomeAssistantEventDetails {
  eventType?: string
  timeFired?: string
  data?: { [key: string]: HomeAssistantAttributeValue }
}

export interface HomeAssistantWeatherDetails {
  temperature?: number
  humidity?: number
  pressure?: number
  windSpeed?: number
  forecast?: Array<{ [key: string]: HomeAssistantAttributeValue }>
}

export interface HomeAssistantCalendarDetails {
  message?: string
  description?: string
  startTime?: string
  endTime?: string
  location?: string
  allDay?: boolean
}

export interface HomeAssistantSensorConfig {
  version: 1
  entityId: string
  mode: HomeAssistantSensorDisplayMode
  attribute?: string
  historyHours: number
  historyLimit: number
  staleAfterMs: number
  unitOverride?: string
  decimals?: number
  gaugeMin?: number
  gaugeMax?: number
}

export interface HomeAssistantEntitySummary {
  entityId: string
  state: string
  friendlyName: string
  unit?: string
  deviceClass?: string
  domain: string
  attributes: Record<string, HomeAssistantAttributeValue>
  lastChanged?: string
  lastUpdated?: string
  timestampStatus: 'valid' | 'missing' | 'invalid'
}

export interface HomeAssistantSensorPoint {
  at: number
  value: number | null
  state: string
}

export interface HomeAssistantSensorSnapshot {
  nodeId: string
  entityId: string
  mode: HomeAssistantSensorDisplayMode
  state: string
  displayValue: string
  unit?: string
  deviceClass?: string
  attributes: Record<string, HomeAssistantAttributeValue>
  lastChanged?: string
  lastUpdated?: string
  receivedAt: number
  stale: boolean
  offline: boolean
  history: HomeAssistantSensorPoint[]
  status: HomeAssistantReadingStatus
  gauge?: { min: number; max: number; value: number }
  trendRange?: { min: number; max: number }
  event?: HomeAssistantEventDetails
  weather?: HomeAssistantWeatherDetails
  calendar?: HomeAssistantCalendarDetails
  timestampStatus: 'valid' | 'missing' | 'invalid'
}

export interface HomeAssistantSensorUpdate {
  nodeId: string
  snapshot: HomeAssistantSensorSnapshot
}

const SAFE_CREDENTIAL_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function validateHomeAssistantConnection(value: unknown): { endpoint: string; credentialKey?: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null
  const raw = value as Record<string, unknown>
  const keys = Object.keys(raw)
  if (keys.some((key) => key !== 'endpoint' && key !== 'credentialKey')) return null
  if (!validText(raw.endpoint, 2048)) return null
  let parsed: URL
  try { parsed = new URL(raw.endpoint) } catch { return null }
  if (parsed.username || parsed.password || parsed.protocol === 'file:' || parsed.protocol === 'javascript:') return null
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]' || parsed.hostname === '::1'
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) return null
  if (raw.credentialKey !== undefined && (typeof raw.credentialKey !== 'string' || !SAFE_CREDENTIAL_KEY.test(raw.credentialKey))) return null
  const out: { endpoint: string; credentialKey?: string } = { endpoint: parsed.toString() }
  if (raw.credentialKey !== undefined) out.credentialKey = raw.credentialKey
  return out
}

export const HOME_ASSISTANT_SENSOR_MODES: ReadonlyArray<{
  mode: HomeAssistantSensorDisplayMode
  label: string
  description: string
}> = [
  { mode: 'numeric', label: 'Numeric value', description: 'Show a sensor reading with its unit and device class.' },
  { mode: 'binary', label: 'Binary state', description: 'Show on/off, open/closed, or detected/clear state.' },
  { mode: 'enum', label: 'Enum state', description: 'Show the current state from a finite set of values.' },
  { mode: 'gauge', label: 'Gauge', description: 'Show a bounded numeric value with a progress gauge.' },
  { mode: 'trend', label: 'Trend', description: 'Show the value and a bounded time-series history.' },
  { mode: 'event', label: 'Event', description: 'Show the latest event state and timestamp.' },
  { mode: 'weather', label: 'Weather', description: 'Show weather state and common forecast attributes.' },
  { mode: 'calendar', label: 'Calendar', description: 'Show the current calendar event state and details.' },
  { mode: 'attributes', label: 'Attributes', description: 'Show bounded, searchable entity attributes.' }
]

export function defaultHomeAssistantSensorConfig(entityId = ''): HomeAssistantSensorConfig {
  return { version: 1, entityId, mode: 'numeric', historyHours: 24, historyLimit: 120, staleAfterMs: 120_000 }
}

const CONFIG_KEYS = new Set(['version', 'entityId', 'mode', 'attribute', 'historyHours', 'historyLimit', 'staleAfterMs', 'unitOverride', 'decimals', 'gaugeMin', 'gaugeMax'])
const ENTITY_ID_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/
const SAFE_TEXT_RE = /^[^\u0000-\u001f\u007f]*$/

export function isStrictFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

const NUMERIC_STATE_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

export function parseHomeAssistantNumericState(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0 || !NUMERIC_STATE_RE.test(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function validText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && SAFE_TEXT_RE.test(value)
}

export function validateHomeAssistantSensorConfig(value: unknown): HomeAssistantSensorConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null
  const raw = value as Record<string, unknown>
  if (Object.keys(raw).some((key) => !CONFIG_KEYS.has(key))) return null
  if (raw.version !== 1 || !validText(raw.entityId, 256) || (raw.entityId !== '' && !ENTITY_ID_RE.test(raw.entityId))) return null
  const modes = new Set(HOME_ASSISTANT_SENSOR_MODES.map((entry) => entry.mode))
  if (typeof raw.mode !== 'string' || !modes.has(raw.mode as HomeAssistantSensorDisplayMode)) return null
  const boundedInteger = (candidate: unknown, min: number, max: number): number | null =>
    isStrictFiniteNumber(candidate) && Number.isSafeInteger(candidate) && candidate >= min && candidate <= max ? candidate : null
  const historyHours = boundedInteger(raw.historyHours, 1, 168)
  const historyLimit = boundedInteger(raw.historyLimit, 1, 500)
  const staleAfterMs = boundedInteger(raw.staleAfterMs, 10_000, 86_400_000)
  if (historyHours === null || historyLimit === null || staleAfterMs === null) return null
  const out: HomeAssistantSensorConfig = {
    version: 1,
    entityId: raw.entityId,
    mode: raw.mode as HomeAssistantSensorDisplayMode,
    historyHours,
    historyLimit,
    staleAfterMs
  }
  if (raw.attribute !== undefined && !validText(raw.attribute, 100)) return null
  if (raw.unitOverride !== undefined && !validText(raw.unitOverride, 40)) return null
  const decimals = raw.decimals === undefined ? undefined : isStrictFiniteNumber(raw.decimals) && Number.isSafeInteger(raw.decimals) && raw.decimals >= 0 && raw.decimals <= 6 ? raw.decimals : null
  const gaugeMin = raw.gaugeMin === undefined ? undefined : isStrictFiniteNumber(raw.gaugeMin) ? raw.gaugeMin : null
  const gaugeMax = raw.gaugeMax === undefined ? undefined : isStrictFiniteNumber(raw.gaugeMax) ? raw.gaugeMax : null
  if (decimals === null || gaugeMin === null || gaugeMax === null) return null
  if (gaugeMin !== undefined && gaugeMax !== undefined && gaugeMin >= gaugeMax) return null
  if (raw.attribute !== undefined) out.attribute = raw.attribute
  if (raw.unitOverride !== undefined) out.unitOverride = raw.unitOverride
  if (decimals !== undefined) out.decimals = decimals
  if (gaugeMin !== undefined) out.gaugeMin = gaugeMin
  if (gaugeMax !== undefined) out.gaugeMax = gaugeMax
  return out
}

export function classifyHomeAssistantState(state: string, timestamp?: string, now = Date.now(), staleAfterMs = 120_000): HomeAssistantReadingStatus {
  if (state === 'unknown') return 'unknown'
  if (state === 'unavailable') return 'unavailable'
  if (timestamp === undefined) return 'available'
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) return 'invalid-timestamp'
  return now - parsed > staleAfterMs ? 'stale' : 'available'
}

function numericAttribute(attributes: Record<string, HomeAssistantAttributeValue>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = attributes[key]
    if (isStrictFiniteNumber(value)) return value
  }
  return undefined
}

export function homeAssistantGaugeRange(entity: HomeAssistantEntitySummary, config: HomeAssistantSensorConfig): { min: number; max: number } | null {
  const min = config.gaugeMin ?? numericAttribute(entity.attributes, ['min', 'min_value'])
  const max = config.gaugeMax ?? numericAttribute(entity.attributes, ['max', 'max_value'])
  const unit = config.unitOverride ?? entity.unit
  return isStrictFiniteNumber(min) && isStrictFiniteNumber(max) && min < max && typeof unit === 'string' && unit.length > 0 ? { min, max } : null
}

export function homeAssistantTrendRange(history: HomeAssistantSensorPoint[], config: HomeAssistantSensorConfig): { min: number; max: number } | null {
  const values = history.map((point) => point.value).filter(isStrictFiniteNumber)
  if (values.length === 0) return null
  const min = config.gaugeMin ?? Math.min(...values)
  const max = config.gaugeMax ?? Math.max(...values)
  return isStrictFiniteNumber(min) && isStrictFiniteNumber(max) && min < max ? { min, max } : min === max ? { min: min - 1, max: max + 1 } : null
}

export function formatHomeAssistantValue(state: HomeAssistantEntitySummary, config: HomeAssistantSensorConfig): string {
  if (config.mode === 'attributes') return `${Object.keys(state.attributes).length} attributes`
  if (state.timestampStatus === 'invalid') return 'Unavailable'
  const status = classifyHomeAssistantState(state.state, state.lastUpdated ?? state.lastChanged, Date.now(), config.staleAfterMs)
  if (status === 'unknown' || status === 'unavailable' || status === 'invalid-timestamp') return 'Unavailable'
  const selected = config.attribute ? state.attributes[config.attribute] : state.state
  if (selected === null || selected === undefined) return 'Unavailable'
  if (config.mode === 'gauge' && homeAssistantGaugeRange(state, config) === null) return 'Unavailable'
  if (typeof selected === 'number' && config.decimals !== undefined) return selected.toFixed(config.decimals)
  if (typeof selected === 'object') return JSON.stringify(selected)
  return String(selected)
}

// ---------------------------------------------------------------------------------------------
// Reconciliation notes -- genuine, unresolved conflicts between the discovery-based contract
// (this file's original content), the "controls" line, and the "sensors" line. Each pair below
// declares the SAME export name with an incompatible shape or return type; merging them would
// silently break whichever consumer expects the other side, so none of these were merged. See
// the task report for the full breakdown of which consumer needs which side.
//
//   HomeAssistantEntity      -- base: normalized {entityId, domain, objectId, state,
//                                friendlyName, icon, unitOfMeasurement, deviceClass, lastChanged,
//                                lastUpdated}. controls: raw wire shape {entity_id, state,
//                                attributes, last_changed?, last_updated?, context?}.
//
//   HomeAssistantApi         -- three incompatible interfaces: base (discovery/instances/
//                                discover/cancel/onEvent), controls (instance CRUD + snapshot +
//                                connect/disconnect/bind/call), sensors (listEntities/read/
//                                watch/unwatch). This file keeps base's HomeAssistantApi only.
//
//   HomeAssistantInstance    -- base: {id, displayName, baseUrl, hasToken, createdAt,
//                                updatedAt}. controls: {id, label, baseUrl, enabled, createdAt,
//                                updatedAt}. Different fields with different semantics
//                                (hasToken vs enabled), not just a rename.
//
//   HomeAssistantNodeIntent  -- base: {transport, domain}. controls: {domain?, service?}.
//                                (Not required by any consumer named in the task, kept as base's.)
//
//   normalizeHomeAssistantEntity -- base: (raw) => HomeAssistantEntity | null (normalized
//                                shape above), consumed by core/home-assistant/service.ts.
//                                sensors: (raw) => HomeAssistantEntitySummary | null, consumed
//                                by src/shared/home-assistant.test.ts. Same exact export name,
//                                different return type -- this file keeps base's version, which
//                                means the sensors-shaped test assertions against this name will
//                                not pass.
// ---------------------------------------------------------------------------------------------
