/** Home Assistant multi-instance client.
 *
 * This module is the shell-independent engine for the Home Assistant service node. It speaks the
 * documented REST API and `/api/websocket` protocol, keeps one generation per instance, and never
 * lets a stale request or socket publish data after an edit, disconnect, or replacement. The only
 * credential input is a callback supplied by the manager. The callback is never exposed to the
 * renderer and its returned value is used only for an Authorization header or websocket auth frame.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { WebSocket } from 'ws'
import { writeFileAtomic } from './fs-atomic'
import { SecureStore } from './secure-store'
import { LocalHistoryStore } from './local-history'
import { platform, type CorePlatform } from './platform'
import { IPC } from '../shared/ipc'
import {
  HOME_ASSISTANT_MAX_AREAS,
  HOME_ASSISTANT_MAX_DEVICES,
  HOME_ASSISTANT_MAX_ENTITIES,
  HOME_ASSISTANT_MAX_ENTITY_REGISTRY,
  HOME_ASSISTANT_MAX_INSTANCES,
  HOME_ASSISTANT_MAX_RESPONSE_BYTES,
  HOME_ASSISTANT_MAX_SERVICES,
  HOME_ASSISTANT_REQUEST_TIMEOUT_MS,
  HOME_ASSISTANT_SCHEMA_VERSION,
  homeAssistantServiceRisk,
  type HomeAssistantApi,
  type HomeAssistantArea,
  type HomeAssistantBinding,
  type HomeAssistantConnectionState,
  type HomeAssistantConnectionStatus,
  type HomeAssistantCreateInput,
  type HomeAssistantDevice,
  type HomeAssistantEntity,
  type HomeAssistantEntityRegistryEntry,
  type HomeAssistantInstance,
  type HomeAssistantService,
  type HomeAssistantSnapshot,
  type HomeAssistantUpdateInput,
  isHomeAssistantEntityId,
  isHomeAssistantInstanceId
} from '../shared/home-assistant'
import { validateFetchUrl } from '../shared/scheduled-settings'

const CONFIG_FILE = 'home-assistant.json'
const SECRET_FILE = 'home-assistant-secrets.json'
const MAX_LABEL = 200
const MAX_BINDINGS = 20_000
const MAX_DETAIL = 500
const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 60_000

interface StoredConfig {
  version: 1
  instances: HomeAssistantInstance[]
  bindings: HomeAssistantBinding[]
}

interface HomeAssistantSecretMeta {
  id: string
  instanceId: string
}

type Listener = (snapshot: HomeAssistantSnapshot) => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function safeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const label = value.trim()
  return label.length > 0 && label.length <= MAX_LABEL && !/[\u0000-\u001f\u007f]/u.test(label) ? label : null
}

function safeId(value: unknown): value is string {
  return isHomeAssistantInstanceId(value)
}

function safeTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function detailOf(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Home Assistant request failed.'
  return message.length > MAX_DETAIL ? `${message.slice(0, MAX_DETAIL - 1)}…` : message
}

function baseUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null
  const checked = validateFetchUrl(raw.trim())
  if (!checked.ok) return null
  checked.url.hash = ''
  checked.url.search = ''
  checked.url.pathname = checked.url.pathname.replace(/\/+$/u, '') || '/'
  return checked.url.toString().replace(/\/$/u, '')
}

function parseInstance(value: unknown): HomeAssistantInstance | null {
  if (!isRecord(value) || !safeId(value.id)) return null
  const label = safeLabel(value.label)
  const endpoint = baseUrl(value.baseUrl)
  if (!label || !endpoint || typeof value.enabled !== 'boolean') return null
  if (!safeTimestamp(value.createdAt) || !safeTimestamp(value.updatedAt)) return null
  return {
    id: value.id,
    label,
    baseUrl: endpoint,
    enabled: value.enabled,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  }
}

function parseBinding(value: unknown): HomeAssistantBinding | null {
  if (!isRecord(value) || !safeId(value.id) || !safeId(value.instanceId)) return null
  if (typeof value.nodeId !== 'string' || value.nodeId.length === 0 || value.nodeId.length > 255) return null
  if (!isHomeAssistantEntityId(value.entityId) || !Number.isFinite(value.createdAt)) return null
  return { id: value.id, nodeId: value.nodeId, instanceId: value.instanceId, entityId: value.entityId, createdAt: value.createdAt }
}

function parseConfig(value: unknown): StoredConfig {
  if (!isRecord(value) || value.version !== HOME_ASSISTANT_SCHEMA_VERSION || !Array.isArray(value.instances) || !Array.isArray(value.bindings)) {
    throw new Error('Home Assistant local configuration is malformed.')
  }
  if (value.instances.length > HOME_ASSISTANT_MAX_INSTANCES || value.bindings.length > MAX_BINDINGS) {
    throw new Error('Home Assistant local configuration exceeds its bounds.')
  }
  const instances = value.instances.map(parseInstance)
  const bindings = value.bindings.map(parseBinding)
  if (instances.some((item) => item === null) || bindings.some((item) => item === null)) {
    throw new Error('Home Assistant local configuration contains an invalid record.')
  }
  const instanceList = instances as HomeAssistantInstance[]
  const bindingList = bindings as HomeAssistantBinding[]
  if (new Set(instanceList.map((item) => item.id)).size !== instanceList.length || new Set(bindingList.map((item) => item.id)).size !== bindingList.length) {
    throw new Error('Home Assistant local configuration contains duplicate ids.')
  }
  return { version: 1, instances: instanceList, bindings: bindingList.filter((binding) => instanceList.some((instance) => instance.id === binding.instanceId)) }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      if (!next.value) continue
      total += next.value.byteLength
      if (total > HOME_ASSISTANT_MAX_RESPONSE_BYTES) throw new Error('Home Assistant response exceeded the size limit.')
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'))
}

function isRedirect(response: Response): boolean {
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)
}

function arrayOf<T>(value: unknown, limit: number, label: string, mapper: (value: unknown) => T | null): T[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`Home Assistant returned an invalid ${label} registry.`)
  const out = value.map(mapper)
  if (out.some((item) => item === null)) throw new Error(`Home Assistant returned an invalid ${label} registry.`)
  return out as T[]
}

function entity(value: unknown): HomeAssistantEntity | null {
  if (!isRecord(value) || !isHomeAssistantEntityId(value.entity_id) || typeof value.state !== 'string' || !isRecord(value.attributes)) return null
  return { entity_id: value.entity_id, state: value.state, attributes: value.attributes, ...(typeof value.last_changed === 'string' ? { last_changed: value.last_changed } : {}), ...(typeof value.last_updated === 'string' ? { last_updated: value.last_updated } : {}) }
}

function entityRegistry(value: unknown): HomeAssistantEntityRegistryEntry | null {
  if (!isRecord(value) || !isHomeAssistantEntityId(value.entity_id) || typeof value.unique_id !== 'string' || value.unique_id.length > 512) return null
  return { entity_id: value.entity_id, unique_id: value.unique_id, platform: typeof value.platform === 'string' ? value.platform : null, device_id: typeof value.device_id === 'string' ? value.device_id : null, area_id: typeof value.area_id === 'string' ? value.area_id : null, disabled_by: typeof value.disabled_by === 'string' ? value.disabled_by : null, hidden_by: typeof value.hidden_by === 'string' ? value.hidden_by : null, name: typeof value.name === 'string' ? value.name : null }
}

function device(value: unknown): HomeAssistantDevice | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null
  const ids = Array.isArray(value.identifiers) ? value.identifiers.filter((item): item is [string, string] => Array.isArray(item) && item.length === 2 && typeof item[0] === 'string' && typeof item[1] === 'string').slice(0, 1000) : []
  const entries = Array.isArray(value.config_entries) ? value.config_entries.filter((item): item is string => typeof item === 'string').slice(0, 1000) : []
  return { id: value.id, name: value.name, name_by_user: typeof value.name_by_user === 'string' ? value.name_by_user : null, manufacturer: typeof value.manufacturer === 'string' ? value.manufacturer : null, model: typeof value.model === 'string' ? value.model : null, area_id: typeof value.area_id === 'string' ? value.area_id : null, config_entries: entries, identifiers: ids }
}

function area(value: unknown): HomeAssistantArea | null {
  if (!isRecord(value) || typeof value.area_id !== 'string' || typeof value.name !== 'string') return null
  const aliases = Array.isArray(value.aliases) ? value.aliases.filter((item): item is string => typeof item === 'string').slice(0, 100) : []
  return { id: value.area_id, name: value.name, aliases, picture: typeof value.picture === 'string' ? value.picture : null }
}

function serviceList(value: unknown): HomeAssistantService[] {
  if (!isRecord(value)) throw new Error('Home Assistant returned an invalid service registry.')
  const out: HomeAssistantService[] = []
  for (const [domain, rawDomain] of Object.entries(value)) {
    if (!/^[a-z0-9_]+$/u.test(domain) || !isRecord(rawDomain)) continue
    for (const [service, rawService] of Object.entries(rawDomain)) {
      if (out.length >= HOME_ASSISTANT_MAX_SERVICES || !/^[a-z0-9_]+$/u.test(service) || !isRecord(rawService)) throw new Error('Home Assistant returned too many services.')
      const risk = homeAssistantServiceRisk(service)
      out.push({ domain, service, name: typeof rawService.name === 'string' ? rawService.name : `${domain}.${service}`, description: typeof rawService.description === 'string' ? rawService.description : '', fields: isRecord(rawService.fields) ? rawService.fields : {}, risk })
    }
  }
  return out
}

export function validateHomeAssistantBaseUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, error: 'Enter a Home Assistant URL.' }
  const checked = validateFetchUrl(raw.trim())
  if (!checked.ok) return { ok: false, error: checked.error }
  return { ok: true, url: baseUrl(raw)! }
}

export class HomeAssistantClient {
  private ws: WebSocket | null = null
  private generation = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private state: HomeAssistantConnectionState = 'unconfigured'
  private detail: string | null = null
  private lastConnectedAt: number | null = null
  private lastSyncAt: number | null = null
  private entities: HomeAssistantEntity[] = []
  private entityRegistry: HomeAssistantEntityRegistryEntry[] = []
  private services: HomeAssistantService[] = []
  private devices: HomeAssistantDevice[] = []
  private areas: HomeAssistantArea[] = []
  private listeners = new Set<Listener>()

  constructor(private instance: HomeAssistantInstance, private readonly token: () => Promise<string | null>) {}

  update(instance: HomeAssistantInstance): void {
    this.stop()
    this.instance = instance
    this.state = instance.enabled ? 'unconfigured' : 'offline'
    this.emit()
  }

  onUpdate(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  status(hasToken = false): HomeAssistantConnectionStatus {
    return { instanceId: this.instance.id, state: this.state, detail: this.detail, lastConnectedAt: this.lastConnectedAt, lastSyncAt: this.lastSyncAt, reconnectAttempt: this.reconnectAttempt, generation: this.generation, hasToken }
  }

  serviceRisk(domain: string, service: string): 'safe' | 'destructive' | 'unknown' | null {
    return this.services.find((item) => item.domain === domain && item.service === service)?.risk ?? null
  }

  snapshot(bindings: HomeAssistantBinding[], hasToken = false): HomeAssistantSnapshot {
    return { instance: this.instance, status: this.status(hasToken), entities: this.entities, entityRegistry: this.entityRegistry, services: this.services, devices: this.devices, areas: this.areas, bindings, fetchedAt: this.lastSyncAt }
  }

  private emit(): void {
    const snapshot = this.snapshot([], false)
    for (const listener of this.listeners) listener(snapshot)
  }

  private setState(state: HomeAssistantConnectionState, detail: string | null = null): void {
    this.state = state
    this.detail = detail
    this.emit()
  }

  private endpoint(pathname: string): string {
    return new URL(pathname.replace(/^\//u, ''), `${this.instance.baseUrl}/`).toString()
  }

  private async request(pathname: string, init: RequestInit = {}, generation: number): Promise<unknown> {
    const token = await this.token()
    if (!token) throw new Error('No Home Assistant access token is stored for this instance.')
    if (generation !== this.generation) throw new Error('Home Assistant request was superseded.')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HOME_ASSISTANT_REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(this.endpoint(pathname), { ...init, signal: controller.signal, redirect: 'manual', headers: { accept: 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })
      if (isRedirect(response)) throw new Error('Home Assistant tried to redirect the request. Redirects are not followed.')
      if (response.status === 401 || response.status === 403) throw new Error('Home Assistant rejected the access token.')
      if (!response.ok) throw new Error(`Home Assistant returned HTTP ${response.status}.`)
      return await readBoundedJson(response)
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Home Assistant request timed out.')
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async callService(domain: string, service: string, entityIds: string[], data: Record<string, unknown>): Promise<{ stateChanged: boolean }> {
    const generation = this.generation
    const serviceMeta = this.services.find((item) => item.domain === domain && item.service === service)
    if (!serviceMeta) throw new Error('That Home Assistant service is not in the discovered catalog.')
    if (entityIds.length === 0 || entityIds.length > 256 || entityIds.some((id) => !isHomeAssistantEntityId(id) || !this.entities.some((item) => item.entity_id === id))) throw new Error('Every selected entity must be present in the discovered catalog.')
    if (!isRecord(data) || Object.keys(data).length > 128) throw new Error('The Home Assistant service payload is outside its bounds.')
    if (isRecord(serviceMeta.fields)) {
      for (const [fieldName, rawField] of Object.entries(serviceMeta.fields)) {
        if (isRecord(rawField) && rawField.required === true && !(fieldName in data)) throw new Error(`The required service field ${fieldName} is missing.`)
      }
      for (const [fieldName, value] of Object.entries(data)) {
        if (fieldName === 'entity_id') continue
        const field = isRecord(serviceMeta.fields[fieldName]) ? serviceMeta.fields[fieldName] as Record<string, unknown> : undefined
        if (!field) throw new Error(`The service field ${fieldName} is not in the discovered schema.`)
        const selector = isRecord(field.selector) ? field.selector as Record<string, unknown> : {}
        const numberSelector = isRecord(selector.number) ? selector.number as Record<string, unknown> : undefined
        if (numberSelector && typeof value === 'number') {
          if (typeof numberSelector.min === 'number' && value < numberSelector.min || typeof numberSelector.max === 'number' && value > numberSelector.max) throw new Error(`The service field ${fieldName} is outside its allowed range.`)
          if (typeof numberSelector.step === 'number' && numberSelector.step > 0 && typeof numberSelector.min === 'number' && Math.abs((value - numberSelector.min) / numberSelector.step - Math.round((value - numberSelector.min) / numberSelector.step)) > 1e-9) throw new Error(`The service field ${fieldName} does not match its allowed step.`)
        }
      }
    }
    const before = new Map<string, string>()
    for (const id of entityIds) {
      const current = this.entities.find((item) => item.entity_id === id)
      if (current) before.set(id, current.state)
    }
    const payload = { ...data, entity_id: entityIds.length === 1 ? entityIds[0] : entityIds }
    await this.request(`api/services/${domain}/${service}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }, generation)
    let stateChanged = false
    for (const id of entityIds) {
      try {
        const next = await this.request(`api/states/${id}`, {}, generation)
        const parsed = entity(next)
        if (parsed) {
          const previous = before.get(id)
          stateChanged = stateChanged || (previous !== undefined && previous !== parsed.state)
          const index = this.entities.findIndex((item) => item.entity_id === id)
          this.entities = index < 0 ? [...this.entities, parsed] : this.entities.map((item, i) => i === index ? parsed : item)
        }
      } catch {
        // The service call was accepted. A follow-up read can fail independently, so preserve the
        // accepted result and report that the state comparison is unavailable rather than guessing.
      }
    }
    this.lastSyncAt = Date.now()
    this.emit()
    return { stateChanged }
  }

  async refresh(): Promise<HomeAssistantSnapshot> {
    const generation = this.generation
    if (!this.instance.enabled) {
      this.setState('offline', 'This Home Assistant instance is disabled.')
      return this.snapshot([], false)
    }
    this.setState('connecting')
    try {
      const [entities, entityRegistryData, services, devices, areas] = await Promise.all([
        this.request('api/states', {}, generation),
        this.request('api/config/entity_registry/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, generation),
        this.request('api/services', {}, generation),
        this.request('api/config/device_registry/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, generation),
        this.request('api/config/area_registry/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, generation)
      ])
      if (generation !== this.generation) return this.snapshot([], false)
      this.entities = arrayOf(entities, HOME_ASSISTANT_MAX_ENTITIES, 'entity', entity)
      this.entityRegistry = arrayOf(entityRegistryData, HOME_ASSISTANT_MAX_ENTITY_REGISTRY, 'entity registry', entityRegistry)
      this.services = serviceList(services)
      this.devices = arrayOf(devices, HOME_ASSISTANT_MAX_DEVICES, 'device', device)
      this.areas = arrayOf(areas, HOME_ASSISTANT_MAX_AREAS, 'area', area)
      this.lastSyncAt = Date.now()
      this.lastConnectedAt = this.lastSyncAt
      this.reconnectAttempt = 0
      this.setState('connected')
      this.openWebSocket(generation)
      return this.snapshot([], false)
    } catch (error) {
      if (generation !== this.generation) return this.snapshot([], false)
      const message = detailOf(error)
      this.setState(message.includes('access token') ? 'auth-error' : 'error', message)
      this.scheduleReconnect(generation)
      throw error
    }
  }

  async connect(): Promise<HomeAssistantConnectionStatus> {
    await this.refresh()
    return this.status(false)
  }

  private openWebSocket(generation: number): void {
    this.closeWebSocket()
    const wsUrl = this.instance.baseUrl.replace(/^http:/u, 'ws:').replace(/^https:/u, 'wss:') + '/api/websocket'
    let socket: WebSocket
    try {
      socket = new WebSocket(wsUrl)
    } catch (error) {
      this.setState('reconnecting', detailOf(error))
      this.scheduleReconnect(generation)
      return
    }
    this.ws = socket
    let authTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => socket.close(), HOME_ASSISTANT_REQUEST_TIMEOUT_MS)
    socket.on('message', async (raw) => {
      if (generation !== this.generation || this.ws !== socket) return
      let message: unknown
      try { message = JSON.parse(raw.toString()) } catch { socket.close(); return }
      if (!isRecord(message) || typeof message.type !== 'string') return
      if (message.type === 'auth_required') {
        const token = await this.token()
        if (!token || generation !== this.generation || this.ws !== socket) return
        socket.send(JSON.stringify({ type: 'auth', access_token: token }))
        return
      }
      if (message.type === 'auth_ok') {
        if (authTimer) clearTimeout(authTimer)
        authTimer = null
        socket.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: 'state_changed' }))
        this.setState('connected')
        return
      }
      if (message.type === 'auth_invalid') {
        if (authTimer) clearTimeout(authTimer)
        this.setState('auth-error', 'Home Assistant rejected the access token.')
        socket.close()
        return
      }
      if (message.type === 'event' && isRecord(message.event) && message.event.event_type === 'state_changed' && isRecord(message.event.data)) {
        const next = message.event.data.new_state
        const parsed = entity(next)
        if (parsed) {
          const index = this.entities.findIndex((item) => item.entity_id === parsed.entity_id)
          this.entities = index < 0 ? [...this.entities, parsed] : this.entities.map((item, i) => i === index ? parsed : item)
          this.lastSyncAt = Date.now()
          this.emit()
        }
      }
    })
    socket.on('error', (error) => {
      if (generation === this.generation && this.ws === socket) this.detail = detailOf(error)
    })
    socket.on('close', () => {
      if (authTimer) clearTimeout(authTimer)
      authTimer = null
      if (generation !== this.generation || this.ws !== socket) return
      this.ws = null
      this.setState('reconnecting', this.detail)
      this.scheduleReconnect(generation)
    })
  }

  private scheduleReconnect(generation: number): void {
    if (generation !== this.generation || this.reconnectTimer || !this.instance.enabled) return
    this.reconnectAttempt += 1
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(6, this.reconnectAttempt - 1))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (generation !== this.generation) return
      void this.refresh().catch(() => undefined)
    }, delay)
  }

  private closeWebSocket(): void {
    const socket = this.ws
    this.ws = null
    if (socket) {
      socket.removeAllListeners()
      try { socket.close() } catch { /* no-op */ }
    }
  }

  stop(): void {
    this.generation += 1
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.closeWebSocket()
    this.setState('offline', 'The Home Assistant connection is stopped.')
  }
}

export class HomeAssistantManager implements HomeAssistantApi {
  private readonly configPath: string
  private readonly secrets: SecureStore<HomeAssistantSecretMeta>
  private readonly history: LocalHistoryStore
  private config: StoredConfig = { version: 1, instances: [], bindings: [] }
  private loaded: Promise<void>
  private clients = new Map<string, HomeAssistantClient>()
  private listeners = new Set<Listener>()

  constructor(private readonly hostPlatform: CorePlatform = platform()) {
    this.configPath = path.join(hostPlatform.userDataDir, CONFIG_FILE)
    this.secrets = new SecureStore<HomeAssistantSecretMeta>(SECRET_FILE)
    this.history = new LocalHistoryStore(hostPlatform.userDataDir)
    this.loaded = this.load()
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.configPath, 'utf8')
      this.config = parseConfig(JSON.parse(raw))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const entries = await this.secrets.load()
    for (const instance of this.config.instances) this.ensureClient(instance)
    for (const entry of entries) if (!this.config.instances.some((instance) => instance.id === entry.meta.instanceId)) {
      await this.secrets.mutate((all) => { const index = all.findIndex((item) => item.meta.id === entry.meta.id); if (index >= 0) all.splice(index, 1); return { changed: true, result: undefined } })
    }
  }

  private async ready(): Promise<void> {
    await this.loaded
  }

  private ensureClient(instance: HomeAssistantInstance): HomeAssistantClient {
    const existing = this.clients.get(instance.id)
    if (existing) { existing.update(instance); return existing }
    const client = new HomeAssistantClient(instance, () => this.readToken(instance.id))
    client.onUpdate((snapshot) => { for (const listener of this.listeners) listener({ ...snapshot, bindings: this.config.bindings.filter((binding) => binding.instanceId === snapshot.instance.id), status: { ...snapshot.status, hasToken: false } }) })
    this.clients.set(instance.id, client)
    return client
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.configPath), { recursive: true })
    await writeFileAtomic(this.configPath, `${JSON.stringify(this.config, null, 2)}\n`)
  }

  private recordHistory(label: string, action: 'created' | 'updated' | 'deleted'): void {
    void this.history.record({
      domain: 'home-assistant',
      filename: CONFIG_FILE,
      content: JSON.stringify(this.config),
      label,
      action
    })
  }

  private async readToken(id: string): Promise<string | null> {
    const entries = await this.secrets.load()
    const entry = entries.find((item) => item.meta.instanceId === id)
    if (!entry) return null
    const payload = this.secrets.unseal<{ token: string }>(entry.secretEnc)
    return typeof payload?.token === 'string' && payload.token.length > 0 ? payload.token : null
  }

  private async hasToken(id: string): Promise<boolean> {
    const entries = await this.secrets.load()
    return entries.some((entry) => entry.meta.instanceId === id)
  }

  onUpdate(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  async list(): Promise<HomeAssistantInstance[]> { await this.ready(); return this.config.instances.map((item) => ({ ...item })) }

  async create(input: HomeAssistantCreateInput): Promise<HomeAssistantInstance> {
    await this.ready()
    if (this.config.instances.length >= HOME_ASSISTANT_MAX_INSTANCES) throw new Error('The Home Assistant instance limit has been reached.')
    const label = safeLabel(input.label)
    const endpoint = validateHomeAssistantBaseUrl(input.baseUrl)
    if (!label || !endpoint.ok) throw new Error(endpoint.ok ? 'Enter a non-empty instance label.' : endpoint.error)
    const now = Date.now()
    const instance: HomeAssistantInstance = { id: randomUUID(), label, baseUrl: endpoint.url, enabled: input.enabled !== false, createdAt: now, updatedAt: now }
    this.config.instances.push(instance)
    this.ensureClient(instance)
    await this.persist()
    this.recordHistory(`Created Home Assistant instance ${instance.label}`, 'created')
    if (input.token !== undefined) await this.setToken(instance.id, input.token)
    return { ...instance }
  }

  async update(input: HomeAssistantUpdateInput): Promise<HomeAssistantInstance | null> {
    await this.ready()
    const current = this.config.instances.find((item) => item.id === input.id)
    if (!current) return null
    const next = { ...current }
    if (input.label !== undefined) { const label = safeLabel(input.label); if (!label) throw new Error('Enter a non-empty instance label.'); next.label = label }
    if (input.baseUrl !== undefined) { const endpoint = validateHomeAssistantBaseUrl(input.baseUrl); if (!endpoint.ok) throw new Error(endpoint.error); next.baseUrl = endpoint.url }
    if (input.enabled !== undefined) next.enabled = input.enabled
    next.updatedAt = Date.now()
    this.config.instances = this.config.instances.map((item) => item.id === next.id ? next : item)
    this.ensureClient(next)
    await this.persist()
    this.recordHistory(`Updated Home Assistant instance ${next.label}`, 'updated')
    return { ...next }
  }

  async remove(id: string): Promise<void> {
    await this.ready()
    if (!safeId(id)) throw new Error('The Home Assistant instance id is invalid.')
    this.clients.get(id)?.stop(); this.clients.delete(id)
    this.config.instances = this.config.instances.filter((item) => item.id !== id)
    this.config.bindings = this.config.bindings.filter((item) => item.instanceId !== id)
    await this.persist()
    await this.secrets.mutate((entries) => { const before = entries.length; for (let i = entries.length - 1; i >= 0; i--) if (entries[i].meta.instanceId === id) entries.splice(i, 1); return { changed: before !== entries.length, result: undefined } })
    this.recordHistory('Deleted Home Assistant instance', 'deleted')
  }

  async status(id: string): Promise<HomeAssistantConnectionStatus | null> { await this.ready(); const client = this.clients.get(id); return client ? { ...client.status(await this.hasToken(id)), hasToken: await this.hasToken(id) } : null }

  async snapshot(id: string): Promise<HomeAssistantSnapshot | null> { await this.ready(); const client = this.clients.get(id); return client ? client.snapshot(this.config.bindings.filter((binding) => binding.instanceId === id), await this.hasToken(id)) : null }

  async refresh(id: string): Promise<HomeAssistantSnapshot> { await this.ready(); const client = this.clients.get(id); if (!client) throw new Error('Home Assistant instance was not found.'); const snapshot = await client.refresh(); return { ...snapshot, bindings: this.config.bindings.filter((binding) => binding.instanceId === id), status: { ...snapshot.status, hasToken: await this.hasToken(id) } } }

  async connect(id: string): Promise<HomeAssistantConnectionStatus> { await this.refresh(id); return (await this.status(id))! }
  async disconnect(id: string): Promise<void> { await this.ready(); this.clients.get(id)?.stop() }
  async call(input: { instanceId: string; domain: string; service: string; entityIds: string[]; data: Record<string, unknown>; confirmation?: { kind: 'super-confirmation'; approved: true } }): Promise<{ ok: true; stateChanged: boolean; message?: string } | { ok: false; error: string; retryable?: boolean; permission?: boolean }> {
    await this.ready()
    if (!safeId(input.instanceId) || !this.config.instances.some((instance) => instance.id === input.instanceId)) return { ok: false, error: 'The Home Assistant instance was not found.', permission: false }
    const instance = this.config.instances.find((item) => item.id === input.instanceId)!
    if (!instance.enabled) return { ok: false, error: 'The Home Assistant instance is disabled.', permission: true }
    const client = this.clients.get(input.instanceId)
    if (!client) return { ok: false, error: 'The Home Assistant instance is unavailable.' }
    const hasToken = await this.hasToken(input.instanceId)
    const currentStatus = client.status(hasToken)
    if (!hasToken) return { ok: false, error: 'Home Assistant authorization is unavailable for this instance.', permission: true }
    if (currentStatus.state !== 'connected') return { ok: false, error: currentStatus.detail ?? 'Home Assistant is not connected. Refresh the instance before calling a service.', retryable: true }
    const risk = client.serviceRisk(input.domain, input.service)
    if (risk === 'destructive' && input.confirmation?.approved !== true) return { ok: false, error: 'This destructive Home Assistant service requires the two-key confirmation gate.', permission: true }
    if (risk === 'unknown' || risk === null) return { ok: false, error: 'This service has unknown risk metadata and is disabled until explicitly classified.', permission: true }
    try {
      const result = await client.callService(input.domain, input.service, input.entityIds, input.data)
      this.recordHistory(`Home Assistant call ${input.domain}.${input.service}`, 'updated')
      return { ok: true, stateChanged: result.stateChanged, message: 'Home Assistant accepted the service call; the follow-up state refresh may arrive shortly.' }
    } catch (error) {
      const message = detailOf(error)
      return { ok: false, error: message, permission: /access token|permission|forbidden|unauthorized/i.test(message), retryable: /timed out|network|HTTP 5\d\d/i.test(message) }
    }
  }
  async stopAll(): Promise<void> { await this.ready(); for (const client of this.clients.values()) client.stop() }

  async setToken(id: string, token: string | null): Promise<void> {
    await this.ready()
    if (!safeId(id) || !this.config.instances.some((instance) => instance.id === id)) throw new Error('Home Assistant instance was not found.')
    if (token !== null && (typeof token !== 'string' || token.trim() !== token || token.length === 0 || token.length > 8192 || /[\r\n\u0000]/u.test(token))) throw new Error('The Home Assistant access token is malformed.')
    await this.secrets.mutate((entries) => {
      const index = entries.findIndex((entry) => entry.meta.instanceId === id)
      if (token === null) { if (index < 0) return { changed: false, result: undefined }; entries.splice(index, 1); return { changed: true, result: undefined } }
      const next = { id, instanceId: id }
      const value = { meta: next, secretEnc: this.secrets.seal({ token }) }
      if (index < 0) entries.push(value); else entries[index] = value
      return { changed: true, result: undefined }
    })
    this.clients.get(id)?.stop()
    this.recordHistory(token === null ? 'Cleared Home Assistant credential' : 'Changed Home Assistant credential', 'updated')
  }

  async tokenStatus(): Promise<Record<string, boolean>> { await this.ready(); const out: Record<string, boolean> = {}; for (const instance of this.config.instances) out[instance.id] = await this.hasToken(instance.id); return out }
  async listBindings(id?: string): Promise<HomeAssistantBinding[]> { await this.ready(); return this.config.bindings.filter((binding) => id === undefined || binding.instanceId === id).map((binding) => ({ ...binding })) }

  async bind(input: { nodeId: string; instanceId: string; entityId: string }): Promise<HomeAssistantBinding> {
    await this.ready()
    if (typeof input.nodeId !== 'string' || input.nodeId.length === 0 || input.nodeId.length > 255 || !safeId(input.instanceId) || !this.config.instances.some((instance) => instance.id === input.instanceId) || !isHomeAssistantEntityId(input.entityId)) throw new Error('The Home Assistant binding is invalid.')
    const existing = this.config.bindings.find((binding) => binding.nodeId === input.nodeId)
    const binding = existing ? { ...existing, instanceId: input.instanceId, entityId: input.entityId } : { id: randomUUID(), nodeId: input.nodeId, instanceId: input.instanceId, entityId: input.entityId, createdAt: Date.now() }
    this.config.bindings = this.config.bindings.filter((item) => item.nodeId !== input.nodeId); this.config.bindings.push(binding)
    await this.persist()
    this.recordHistory('Bound Home Assistant entity to a node', 'updated')
    return { ...binding }
  }

  async unbind(id: string): Promise<void> { await this.ready(); if (!safeId(id)) throw new Error('The Home Assistant binding id is invalid.'); this.config.bindings = this.config.bindings.filter((binding) => binding.id !== id); await this.persist(); this.recordHistory('Unbound Home Assistant entity from a node', 'updated') }
}

export function registerHomeAssistantIpc(host: CorePlatform = platform()): { manager: HomeAssistantManager } {
  const manager = new HomeAssistantManager(host)
  host.handle(IPC.homeAssistantList, () => manager.list())
  host.handle(IPC.homeAssistantCreate, (input: HomeAssistantCreateInput) => manager.create(input))
  host.handle(IPC.homeAssistantUpdate, (input: HomeAssistantUpdateInput) => manager.update(input))
  host.handle(IPC.homeAssistantRemove, (id: string) => manager.remove(id))
  host.handle(IPC.homeAssistantStatus, (id: string) => manager.status(id))
  host.handle(IPC.homeAssistantSnapshot, (id: string) => manager.snapshot(id))
  host.handle(IPC.homeAssistantRefresh, (id: string) => manager.refresh(id))
  host.handle(IPC.homeAssistantConnect, (id: string) => manager.connect(id))
  host.handle(IPC.homeAssistantDisconnect, (id: string) => manager.disconnect(id))
  host.handle(IPC.homeAssistantSetToken, (id: string, token: string | null) => manager.setToken(id, token))
  host.handle(IPC.homeAssistantTokenStatus, () => manager.tokenStatus())
  host.handle(IPC.homeAssistantBindings, (id?: string) => manager.listBindings(id))
  host.handle(IPC.homeAssistantBind, (input: { nodeId: string; instanceId: string; entityId: string }) => manager.bind(input))
  host.handle(IPC.homeAssistantUnbind, (id: string) => manager.unbind(id))
  host.handle(IPC.homeAssistantCall, (input: { instanceId: string; domain: string; service: string; entityIds: string[]; data: Record<string, unknown> }) => manager.call(input))
  manager.onUpdate((snapshot) => host.broadcast(IPC.homeAssistantUpdateEvent, snapshot))
  return { manager }
}
