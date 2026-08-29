/** Home Assistant sensor display contract shared by the two host shells and the renderer. */

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

export interface HomeAssistantApi {
  listEntities(connection: { endpoint: string; credentialKey?: string }): Promise<HomeAssistantEntitySummary[]>
  read(
    nodeId: string,
    connection: { endpoint: string; credentialKey?: string },
    config: HomeAssistantSensorConfig
  ): Promise<HomeAssistantSensorSnapshot>
  watch(
    nodeId: string,
    connection: { endpoint: string; credentialKey?: string },
    config: HomeAssistantSensorConfig
  ): Promise<HomeAssistantSensorSnapshot>
  unwatch(nodeId: string): Promise<void>
  setToken(credentialKey: string, token: string | null): Promise<void>
  tokenStatus(credentialKey: string): Promise<boolean>
  onUpdate(listener: (update: HomeAssistantSensorUpdate) => void): () => void
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

const INVALID_ATTRIBUTE = Symbol('invalid-home-assistant-attribute')
const MAX_ATTRIBUTE_DEPTH = 4
const MAX_ATTRIBUTE_KEYS = 100
const MAX_ATTRIBUTE_ARRAY = 100
const MAX_ATTRIBUTE_STRING = 1024

function normalizeAttribute(value: unknown, depth = 0): HomeAssistantAttributeValue | typeof INVALID_ATTRIBUTE {
  if (depth > MAX_ATTRIBUTE_DEPTH) return INVALID_ATTRIBUTE
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return validText(value, MAX_ATTRIBUTE_STRING) ? value : INVALID_ATTRIBUTE
  if (isStrictFiniteNumber(value)) return value
  if (Array.isArray(value)) {
    if (value.length > MAX_ATTRIBUTE_ARRAY) return INVALID_ATTRIBUTE
    const out: HomeAssistantAttributeValue[] = []
    for (const entry of value) {
      const normalized = normalizeAttribute(entry, depth + 1)
      if (normalized === INVALID_ATTRIBUTE) return INVALID_ATTRIBUTE
      out.push(normalized)
    }
    return out
  }
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value)
    if (entries.length > MAX_ATTRIBUTE_KEYS) return INVALID_ATTRIBUTE
    const out: { [key: string]: HomeAssistantAttributeValue } = Object.create(null) as { [key: string]: HomeAssistantAttributeValue }
    for (const [key, entry] of entries) {
      if (!validText(key, 100) || key === '__proto__' || key === 'constructor' || key === 'prototype') return INVALID_ATTRIBUTE
      const normalized = normalizeAttribute(entry, depth + 1)
      if (normalized === INVALID_ATTRIBUTE) return INVALID_ATTRIBUTE
      out[key] = normalized
    }
    return out
  }
  return INVALID_ATTRIBUTE
}

export function normalizeHomeAssistantEntity(body: unknown): HomeAssistantEntitySummary | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const raw = body as Record<string, unknown>
  if (!validText(raw.entity_id, 256) || !ENTITY_ID_RE.test(raw.entity_id) || !validText(raw.state, 512) || raw.state.length === 0) return null
  if (!raw.attributes || typeof raw.attributes !== 'object' || Array.isArray(raw.attributes) || Object.getPrototypeOf(raw.attributes) !== Object.prototype) return null
  const normalized = normalizeAttribute(raw.attributes)
  if (normalized === INVALID_ATTRIBUTE || normalized === null || Array.isArray(normalized) || typeof normalized !== 'object') return null
  const attrs = normalized as Record<string, HomeAssistantAttributeValue>
  const friendlyName = typeof attrs.friendly_name === 'string' ? attrs.friendly_name : raw.entity_id
  const lastChanged = raw.last_changed === undefined ? undefined : validText(raw.last_changed, 80) ? raw.last_changed : undefined
  const lastUpdated = raw.last_updated === undefined ? undefined : validText(raw.last_updated, 80) ? raw.last_updated : undefined
  const timestampValues = [raw.last_changed, raw.last_updated].filter((value) => value !== undefined)
  const timestampStatus: 'valid' | 'missing' | 'invalid' = timestampValues.length === 0
    ? 'missing'
    : timestampValues.every((value) => typeof value === 'string' && validText(value, 80) && Number.isFinite(Date.parse(value)))
      ? 'valid'
      : 'invalid'
  return {
    entityId: raw.entity_id,
    state: raw.state,
    friendlyName,
    unit: typeof attrs.unit_of_measurement === 'string' ? attrs.unit_of_measurement : undefined,
    deviceClass: typeof attrs.device_class === 'string' ? attrs.device_class : undefined,
    domain: raw.entity_id.split('.')[0] ?? 'unknown',
    attributes: attrs,
    lastChanged,
    lastUpdated,
    timestampStatus
  }
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
