import WebSocket from 'ws'
import { getHomeAssistantToken, hasHomeAssistantToken, isValidHomeAssistantTokenKey, setHomeAssistantToken } from '../scheduled-settings-secrets'
import {
  classifyHomeAssistantState,
  formatHomeAssistantValue,
  homeAssistantGaugeRange,
  homeAssistantTrendRange,
  normalizeHomeAssistantEntity,
  parseHomeAssistantNumericState,
  validateHomeAssistantConnection,
  validateHomeAssistantSensorConfig,
  type HomeAssistantAttributeValue,
  type HomeAssistantCalendarDetails,
  type HomeAssistantEntitySummary,
  type HomeAssistantEventDetails,
  type HomeAssistantSensorConfig,
  type HomeAssistantSensorPoint,
  type HomeAssistantSensorSnapshot,
  type HomeAssistantSensorUpdate,
  type HomeAssistantWeatherDetails
} from '../../shared/home-assistant'

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
export const MAX_WS_FRAME_BYTES = 512 * 1024
export const MAX_JSON_DEPTH = 8
export const MAX_JSON_KEYS = 200
export const MAX_JSON_ARRAY = 200
export const MAX_JSON_STRING = 4096
const REQUEST_TIMEOUT_MS = 10_000
const MAX_HISTORY = 500
const MAX_RECONNECT_ATTEMPTS = 5
const RECONNECT_BASE_MS = 250
const RECONNECT_MAX_MS = 8_000
const WS_HANDSHAKE_TIMEOUT_MS = 10_000

type Connection = { endpoint: string; credentialKey?: string }
type Watch = {
  clientId: number
  generation: number
  connection: Connection
  config: HomeAssistantSensorConfig
  socket?: WebSocket
  history: HomeAssistantSensorPoint[]
  latest: HomeAssistantSensorSnapshot
  closed: boolean
  reconnectAttempt: number
  reconnectTimer?: ReturnType<typeof setTimeout>
  authTimer?: ReturnType<typeof setTimeout>
  subscriptionTimer?: ReturnType<typeof setTimeout>
  subscriptionId: number
}

function checkedConnection(value: unknown): Connection {
  const connection = validateHomeAssistantConnection(value)
  if (!connection) throw new Error('Home Assistant address or credential reference is invalid.')
  return connection
}

function checkedConfig(value: unknown): HomeAssistantSensorConfig {
  const config = validateHomeAssistantSensorConfig(value)
  if (!config) throw new Error('Home Assistant sensor settings are invalid or out of range.')
  return config
}

export function apiUrl(endpoint: string, path: string): string {
  const connection = checkedConnection({ endpoint })
  const base = new URL(connection.endpoint)
  const cleanPath = path.replace(/^\/+/, '')
  const segments = cleanPath.split('/').map((segment) => encodeURIComponent(segment))
  return new URL(segments.join('/'), base.href.endsWith('/') ? base.href : `${base.href}/`).toString()
}

function byteLength(raw: unknown): number {
  if (typeof raw === 'string') return Buffer.byteLength(raw, 'utf8')
  if (Buffer.isBuffer(raw)) return raw.byteLength
  if (raw instanceof ArrayBuffer) return raw.byteLength
  if (ArrayBuffer.isView(raw)) return raw.byteLength
  return Number.POSITIVE_INFINITY
}

function validateJsonShape(value: unknown, depth = 0): boolean {
  if (depth > MAX_JSON_DEPTH) return false
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return typeof value !== 'number' || Number.isFinite(value)
  if (typeof value === 'string') return value.length <= MAX_JSON_STRING
  if (Array.isArray(value)) return value.length <= MAX_JSON_ARRAY && value.every((entry) => validateJsonShape(entry, depth + 1))
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    return Object.getPrototypeOf(value) === Object.prototype && entries.length <= MAX_JSON_KEYS && entries.every(([key, entry]) => key.length <= 200 && key !== '__proto__' && key !== 'constructor' && key !== 'prototype' && validateJsonShape(entry, depth + 1))
  }
  return false
}

export function parseBoundedJson(raw: unknown, maxBytes = MAX_WS_FRAME_BYTES): unknown {
  if (byteLength(raw) > maxBytes) throw new Error('Home Assistant message exceeded the size limit.')
  let text: string
  if (typeof raw === 'string') text = raw
  else if (Buffer.isBuffer(raw)) text = raw.toString('utf8')
  else if (raw instanceof ArrayBuffer) text = Buffer.from(raw).toString('utf8')
  else if (ArrayBuffer.isView(raw)) text = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8')
  else throw new Error('Home Assistant returned an unsupported message frame.')
  const parsed: unknown = JSON.parse(text)
  if (!validateJsonShape(parsed)) throw new Error('Home Assistant returned an invalid or oversized message.')
  return parsed
}

async function boundedJson(url: string, token: string): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: ctrl.signal, redirect: 'manual', headers: { accept: 'application/json', authorization: `Bearer ${token}` } })
    if (response.status >= 300 && response.status < 400) throw new Error('Home Assistant tried to redirect; redirects are not followed.')
    if (response.status === 401 || response.status === 403) throw new Error('Home Assistant rejected the access token.')
    if (!response.ok) throw new Error(`Home Assistant returned HTTP ${response.status}.`)
    const advertised = Number(response.headers.get('content-length'))
    if (Number.isFinite(advertised) && advertised > MAX_RESPONSE_BYTES) throw new Error('Home Assistant response exceeded the size limit.')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Home Assistant returned no response body.')
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      if (!next.value) continue
      total += next.value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        ctrl.abort()
        throw new Error('Home Assistant response exceeded the size limit.')
      }
      chunks.push(next.value)
    }
    return parseBoundedJson(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), MAX_RESPONSE_BYTES)
  } finally {
    clearTimeout(timer)
  }
}

function typedDetails(entity: HomeAssistantEntitySummary, mode: HomeAssistantSensorConfig['mode']): Pick<HomeAssistantSensorSnapshot, 'event' | 'weather' | 'calendar'> {
  const attrs = entity.attributes
  if (mode === 'event') {
    const event: HomeAssistantEventDetails = {}
    if (typeof attrs.event_type === 'string') event.eventType = attrs.event_type
    if (typeof attrs.time_fired === 'string') event.timeFired = attrs.time_fired
    if (attrs.event_data && typeof attrs.event_data === 'object' && !Array.isArray(attrs.event_data)) event.data = attrs.event_data as { [key: string]: HomeAssistantAttributeValue }
    return { event }
  }
  if (mode === 'weather') {
    const weather: HomeAssistantWeatherDetails = {}
    for (const [key, target] of [['temperature', 'temperature'], ['humidity', 'humidity'], ['pressure', 'pressure'], ['wind_speed', 'windSpeed']] as const) {
      if (typeof attrs[key] === 'number') weather[target] = attrs[key]
    }
    if (Array.isArray(attrs.forecast) && attrs.forecast.every((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry))) weather.forecast = attrs.forecast as Array<{ [key: string]: HomeAssistantAttributeValue }>
    return { weather }
  }
  if (mode === 'calendar') {
    const calendar: HomeAssistantCalendarDetails = {}
    if (typeof attrs.message === 'string') calendar.message = attrs.message
    if (typeof attrs.description === 'string') calendar.description = attrs.description
    if (typeof attrs.start_time === 'string') calendar.startTime = attrs.start_time
    if (typeof attrs.end_time === 'string') calendar.endTime = attrs.end_time
    if (typeof attrs.location === 'string') calendar.location = attrs.location
    if (typeof attrs.all_day === 'boolean') calendar.allDay = attrs.all_day
    return { calendar }
  }
  return {}
}

function makeSnapshot(nodeId: string, entity: HomeAssistantEntitySummary, history: HomeAssistantSensorPoint[], config: HomeAssistantSensorConfig, offline = false): HomeAssistantSensorSnapshot {
  const receivedAt = Date.now()
  const last = entity.lastUpdated ?? entity.lastChanged
  const baseStatus = offline ? 'offline' : entity.timestampStatus === 'invalid' ? 'invalid-timestamp' : classifyHomeAssistantState(entity.state, last, receivedAt, config.staleAfterMs)
  const range = homeAssistantGaugeRange(entity, config)
  const numeric = parseHomeAssistantNumericState(entity.state)
  const gauge = config.mode === 'gauge' && range && numeric !== null && numeric >= range.min && numeric <= range.max ? { ...range, value: numeric } : undefined
  const status = config.mode === 'gauge' && baseStatus === 'available' && gauge === undefined ? 'unavailable' : baseStatus
  return {
    nodeId,
    entityId: entity.entityId,
    mode: config.mode,
    state: entity.state,
    displayValue: status === 'available' || status === 'stale' ? formatHomeAssistantValue(entity, config) : 'Unavailable',
    unit: config.unitOverride ?? entity.unit,
    deviceClass: entity.deviceClass,
    attributes: entity.attributes,
    lastChanged: entity.lastChanged,
    lastUpdated: entity.lastUpdated,
    receivedAt,
    stale: status === 'stale' || status === 'invalid-timestamp' || offline,
    offline,
    history: history.slice(-Math.min(config.historyLimit, MAX_HISTORY)),
    status,
    timestampStatus: entity.timestampStatus,
    gauge,
    trendRange: config.mode === 'trend' ? homeAssistantTrendRange(history, config) ?? undefined : undefined,
    ...typedDetails(entity, config.mode)
  }
}

function trimHistory(history: HomeAssistantSensorPoint[], config: HomeAssistantSensorConfig): void {
  const cutoff = Date.now() - config.historyHours * 60 * 60 * 1000
  let first = 0
  while (first < history.length && history[first].at < cutoff) first++
  if (first > 0) history.splice(0, first)
  const limit = Math.min(config.historyLimit, MAX_HISTORY)
  if (history.length > limit) history.splice(0, history.length - limit)
}

export interface SensorServiceOptions {
  onUpdate(update: HomeAssistantSensorUpdate, clientId: number): void
}

export class HomeAssistantSensorService {
  private readonly watches = new Map<string, Watch>()
  private readonly generations = new Map<string, number>()
  private nextSubscriptionId = 1
  constructor(private readonly options: SensorServiceOptions) {}

  async listEntities(rawConnection: unknown): Promise<HomeAssistantEntitySummary[]> {
    const connection = checkedConnection(rawConnection)
    if (!connection.credentialKey) throw new Error('Choose a Home Assistant access token before loading entities.')
    const token = await getHomeAssistantToken(connection.credentialKey)
    if (!token) throw new Error('No Home Assistant access token is stored for this node.')
    const body = await boundedJson(apiUrl(connection.endpoint, '/api/states'), token)
    if (!Array.isArray(body)) throw new Error('Home Assistant returned an invalid entity list.')
    if (body.length > MAX_JSON_ARRAY) throw new Error(`Home Assistant entity catalogue exceeds the supported ${MAX_JSON_ARRAY}-entity limit.`)
    const entities = body.map(normalizeHomeAssistantEntity)
    if (entities.some((entry) => entry === null)) throw new Error('Home Assistant returned an invalid entity record.')
    return entities as HomeAssistantEntitySummary[]
  }

  async read(clientId: number, nodeId: string, rawConnection: unknown, rawConfig: unknown): Promise<HomeAssistantSensorSnapshot> {
    const connection = checkedConnection(rawConnection)
    const config = checkedConfig(rawConfig)
    if (!connection.credentialKey) throw new Error('Choose a Home Assistant access token before reading a sensor.')
    const token = await getHomeAssistantToken(connection.credentialKey)
    if (!token) throw new Error('No Home Assistant access token is stored for this node.')
    if (!config.entityId) throw new Error('Choose a Home Assistant entity before reading a sensor.')
    const body = await boundedJson(apiUrl(connection.endpoint, `/api/states/${config.entityId}`), token)
    const entity = normalizeHomeAssistantEntity(body)
    if (!entity) throw new Error('Home Assistant returned an invalid sensor state.')
    const current = this.watches.get(this.watchKey(clientId, nodeId))
    const history = current?.history ?? []
    const numeric = parseHomeAssistantNumericState(entity.state)
    if (numeric !== null) history.push({ at: Date.now(), value: numeric, state: entity.state })
    trimHistory(history, config)
    return makeSnapshot(nodeId, entity, history, config)
  }

  private watchKey(clientId: number, nodeId: string): string { return `${clientId}:${nodeId}` }

  async watch(clientId: number, nodeId: string, rawConnection: unknown, rawConfig: unknown): Promise<HomeAssistantSensorSnapshot> {
    const connection = checkedConnection(rawConnection)
    const config = checkedConfig(rawConfig)
    const key = this.watchKey(clientId, nodeId)
    const generation = (this.generations.get(key) ?? 0) + 1
    this.generations.set(key, generation)
    await this.unwatch(clientId, nodeId, false)
    const initial = await this.read(clientId, nodeId, connection, config)
    if (this.generations.get(key) !== generation) throw new Error('Home Assistant sensor watch was superseded.')
    const watch: Watch = { clientId, generation, connection, config, history: initial.history, latest: initial, closed: false, reconnectAttempt: 0, subscriptionId: this.nextSubscriptionId++ }
    this.watches.set(key, watch)
    await this.connectSocket(nodeId, watch)
    return initial
  }

  private async connectSocket(nodeId: string, watch: Watch): Promise<void> {
    if (watch.closed) return
    const token = watch.connection.credentialKey ? await getHomeAssistantToken(watch.connection.credentialKey) : null
    if (!token) throw new Error('No Home Assistant access token is stored for this node.')
    if (watch.closed || this.watches.get(this.watchKey(watch.clientId, nodeId)) !== watch) return
    const wsUrl = apiUrl(watch.connection.endpoint, '/api/websocket').replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
    const socket = new WebSocket(wsUrl, { maxPayload: MAX_WS_FRAME_BYTES })
    watch.socket = socket
    watch.authTimer = setTimeout(() => {
      if (watch.socket !== socket) return
      try { socket.close() } catch { /* close handler schedules the bounded retry */ }
    }, WS_HANDSHAKE_TIMEOUT_MS)
    socket.on('message', (raw) => this.handleMessage(nodeId, watch, socket, raw, token))
    socket.on('error', () => this.socketLost(nodeId, watch, socket))
    socket.on('close', () => this.socketLost(nodeId, watch, socket))
  }

  private handleMessage(nodeId: string, watch: Watch, socket: WebSocket, raw: WebSocket.RawData, token: string): void {
    if (watch.closed || watch.socket !== socket) return
    try {
      const parsed = parseBoundedJson(raw) as { type?: unknown; id?: unknown; success?: unknown; event?: { data?: { entity_id?: unknown; new_state?: unknown } } }
      if (parsed.type === 'auth_required') socket.send(JSON.stringify({ type: 'auth', access_token: token }))
      else if (parsed.type === 'auth_ok') {
        if (watch.authTimer) clearTimeout(watch.authTimer)
        watch.authTimer = undefined
        socket.send(JSON.stringify({ id: watch.subscriptionId, type: 'subscribe_events', event_type: 'state_changed' }))
        watch.subscriptionTimer = setTimeout(() => {
          if (watch.socket !== socket) return
          try { socket.close() } catch { /* close handler schedules the bounded retry */ }
        }, WS_HANDSHAKE_TIMEOUT_MS)
      } else if (parsed.type === 'result' && parsed.id === watch.subscriptionId) {
        if (watch.subscriptionTimer) clearTimeout(watch.subscriptionTimer)
        watch.subscriptionTimer = undefined
        if (parsed.success === true) watch.reconnectAttempt = 0
        else {
          this.publishOffline(nodeId, watch)
          try { socket.close() } catch { /* close handler schedules the bounded retry */ }
        }
      }
      else if (parsed.type === 'event' && parsed.event?.data?.entity_id === watch.config.entityId) {
        const entity = normalizeHomeAssistantEntity(parsed.event.data.new_state)
        if (!entity) {
          this.publishOffline(nodeId, watch)
          try { socket.close() } catch { /* the close handler still owns retry state */ }
          return
        }
        const numeric = parseHomeAssistantNumericState(entity.state)
        if (numeric !== null) watch.history.push({ at: Date.now(), value: numeric, state: entity.state })
        trimHistory(watch.history, watch.config)
        watch.latest = makeSnapshot(nodeId, entity, watch.history, watch.config)
        this.options.onUpdate({ nodeId, snapshot: watch.latest }, watch.clientId)
      }
    } catch {
      this.publishOffline(nodeId, watch)
      try { socket.close() } catch { /* the close handler still owns retry state */ }
    }
  }

  private publishOffline(nodeId: string, watch: Watch): void {
    watch.latest = { ...watch.latest, offline: true, stale: true, status: 'offline', receivedAt: Date.now() }
    this.options.onUpdate({ nodeId, snapshot: watch.latest }, watch.clientId)
  }

  private socketLost(nodeId: string, watch: Watch, socket: WebSocket): void {
    if (watch.closed || watch.socket !== socket) return
    watch.socket = undefined
    if (watch.authTimer) clearTimeout(watch.authTimer)
    if (watch.subscriptionTimer) clearTimeout(watch.subscriptionTimer)
    watch.authTimer = undefined
    watch.subscriptionTimer = undefined
    this.publishOffline(nodeId, watch)
    if (watch.reconnectTimer || watch.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) return
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** watch.reconnectAttempt++)
    watch.reconnectTimer = setTimeout(() => {
      watch.reconnectTimer = undefined
      void this.refreshAndReconnect(nodeId, watch)
    }, delay)
  }

  private async refreshAndReconnect(nodeId: string, watch: Watch): Promise<void> {
    if (watch.closed || this.watches.get(this.watchKey(watch.clientId, nodeId)) !== watch) return
    try {
      const fresh = await this.read(watch.clientId, nodeId, watch.connection, watch.config)
      if (watch.closed || this.watches.get(this.watchKey(watch.clientId, nodeId)) !== watch) return
      watch.history = fresh.history
      watch.latest = fresh
      this.options.onUpdate({ nodeId, snapshot: fresh }, watch.clientId)
      await this.connectSocket(nodeId, watch)
    } catch {
      this.publishOffline(nodeId, watch)
      if (watch.reconnectTimer || watch.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) return
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** watch.reconnectAttempt++)
      watch.reconnectTimer = setTimeout(() => {
        watch.reconnectTimer = undefined
        void this.refreshAndReconnect(nodeId, watch)
      }, delay)
    }
  }

  async unwatch(clientId: number, nodeId: string, invalidate = true): Promise<void> {
    const key = this.watchKey(clientId, nodeId)
    if (invalidate) this.generations.set(key, (this.generations.get(key) ?? 0) + 1)
    const watch = this.watches.get(key)
    if (!watch) return
    watch.closed = true
    this.watches.delete(key)
    if (watch.reconnectTimer) clearTimeout(watch.reconnectTimer)
    if (watch.authTimer) clearTimeout(watch.authTimer)
    if (watch.subscriptionTimer) clearTimeout(watch.subscriptionTimer)
    try { watch.socket?.close() } catch { /* already closed */ }
  }

  async setToken(credentialKey: string, token: string | null): Promise<void> {
    if (!isValidHomeAssistantTokenKey(credentialKey)) throw new Error('The Home Assistant credential reference is invalid.')
    if (token !== null && (typeof token !== 'string' || token.trim() !== token || token.length === 0 || token.length > 8192 || /[\r\n\0]/u.test(token))) throw new Error('The Home Assistant access token is invalid.')
    await Promise.all([...this.watches.values()]
      .filter((watch) => watch.connection.credentialKey === credentialKey)
      .map((watch) => this.unwatch(watch.clientId, watch.latest.nodeId)))
    await setHomeAssistantToken(credentialKey, token)
  }

  tokenStatus(credentialKey: string): Promise<boolean> {
    if (!isValidHomeAssistantTokenKey(credentialKey)) return Promise.resolve(false)
    return hasHomeAssistantToken(credentialKey)
  }

  async close(): Promise<void> {
    await Promise.all([...this.watches.values()].map((watch) => this.unwatch(watch.clientId, watch.latest.nodeId)))
  }
}
