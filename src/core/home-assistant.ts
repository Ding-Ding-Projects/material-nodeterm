/** Home Assistant multi-instance client.
 *
 * This module is the shell-independent engine for the Home Assistant service node. It speaks the
 * documented REST API and `/api/websocket` protocol, keeps one generation per instance, and never
 * lets a stale request or socket publish data after an edit, disconnect, or replacement. The only
 * credential input is a callback supplied by the manager. The callback is never exposed to the
 * renderer and its returned value is used only for an Authorization header or websocket auth frame.
 */

import { randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { mkdir, open, stat } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import path from 'node:path'
import { WebSocket } from 'ws'
import { writeFileAtomic } from './fs-atomic'
import { SecureStore } from './secure-store'
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
const CONFIG_MAX_BYTES = 512 * 1024
const WS_MAX_FRAME_BYTES = 512 * 1024
const MAX_ATTRIBUTE_KEYS = 256
const MAX_ATTRIBUTE_DEPTH = 4
const MAX_ATTRIBUTE_STRING = 8 * 1024

class HomeAssistantAuthError extends Error {
  constructor(message = 'Home Assistant rejected the access token.') {
    super(message)
    this.name = 'HomeAssistantAuthError'
  }
}

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

const SAFE_NODE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u
const CONFIG_KEYS = new Set(['version', 'instances', 'bindings'])
const INSTANCE_KEYS = new Set(['id', 'label', 'baseUrl', 'enabled', 'createdAt', 'updatedAt'])
const BINDING_KEYS = new Set(['id', 'nodeId', 'instanceId', 'entityId', 'createdAt'])

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
}

function safeTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function safeMetadataString(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value)
}

function detailOf(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Home Assistant request failed.'
  return message.length > MAX_DETAIL ? `${message.slice(0, MAX_DETAIL - 1)}…` : message
}

function baseUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null
  const checked = validateFetchUrl(raw.trim())
  if (!checked.ok) return null
  if (checked.url.search || checked.url.hash) return null
  checked.url.hash = ''
  checked.url.search = ''
  checked.url.pathname = checked.url.pathname.replace(/\/+$/u, '') || '/'
  return checked.url.toString().replace(/\/$/u, '')
}

function parseInstance(value: unknown): HomeAssistantInstance | null {
  if (!isRecord(value) || !hasOnlyKeys(value, INSTANCE_KEYS) || !safeId(value.id)) return null
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
  if (!isRecord(value) || !hasOnlyKeys(value, BINDING_KEYS) || !safeId(value.id) || !safeId(value.instanceId)) return null
  if (typeof value.nodeId !== 'string' || !SAFE_NODE_ID.test(value.nodeId)) return null
  if (!isHomeAssistantEntityId(value.entityId) || !safeTimestamp(value.createdAt)) return null
  return { id: value.id, nodeId: value.nodeId, instanceId: value.instanceId, entityId: value.entityId, createdAt: value.createdAt }
}

function parseConfig(value: unknown): StoredConfig {
  if (!isRecord(value) || !hasOnlyKeys(value, CONFIG_KEYS) || value.version !== HOME_ASSISTANT_SCHEMA_VERSION || !Array.isArray(value.instances) || !Array.isArray(value.bindings)) {
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

function validSecretEntry(value: unknown): value is { meta: HomeAssistantSecretMeta; secretEnc: string } {
  if (!isRecord(value) || !isRecord(value.meta) || !hasOnlyKeys(value.meta, new Set(['id', 'instanceId']))) return false
  return safeId(value.meta.id) && safeId(value.meta.instanceId) && typeof value.secretEnc === 'string' && value.secretEnc.length > 0 && value.secretEnc.length <= 2 * 1024 * 1024
}

async function readBoundedTextFile(file: string, maxBytes: number): Promise<string> {
  const before = await stat(file)
  if (!before.isFile() || before.size > maxBytes) throw new Error('Home Assistant local configuration exceeds its byte limit.')
  const handle = await open(file, 'r')
  try {
    const chunks: Buffer[] = []
    let total = 0
    let position = 0
    for (;;) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes - total + 1))
      const result = await handle.read(buffer, 0, buffer.length, position)
      if (result.bytesRead === 0) break
      total += result.bytesRead
      if (total > maxBytes) throw new Error('Home Assistant local configuration exceeds its byte limit.')
      chunks.push(buffer.subarray(0, result.bytesRead))
      position += result.bytesRead
    }
    const after = await stat(file)
    if (!after.isFile() || after.size !== total || after.size > maxBytes) throw new Error('Home Assistant local configuration changed while it was being read.')
    return Buffer.concat(chunks, total).toString('utf8')
  } finally {
    await handle.close()
  }
}

function boundedValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    if (typeof value === 'string') return value.slice(0, MAX_ATTRIBUTE_STRING)
    return value
  }
  if (depth >= MAX_ATTRIBUTE_DEPTH) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, MAX_ATTRIBUTE_KEYS).map((item) => boundedValue(item, depth + 1))
  if (!isRecord(value)) return undefined
  const out = Object.create(null) as Record<string, unknown>
  for (const [key, item] of Object.entries(value).slice(0, MAX_ATTRIBUTE_KEYS)) {
    if (!/^[A-Za-z0-9_.:-]{1,128}$/u.test(key)) continue
    const bounded = boundedValue(item, depth + 1)
    if (bounded !== undefined) out[key] = bounded
  }
  return out
}

function boundedAttributes(value: unknown): Record<string, unknown> | null {
  const bounded = boundedValue(value)
  return isRecord(bounded) ? bounded : null
}

function isBlockedResolvedAddress(address: string): boolean {
  const lower = address.toLowerCase().replace(/%.*$/u, '')
  const parts = lower.split('.')
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/u.test(part))) {
    const octets = parts.map(Number)
    if (octets.some((octet) => octet > 255)) return true
    const [a, b] = octets
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false
    if (a === 127) return false
    if (a === 0 || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return true
    if (a === 192 && b === 0) return true
    if (a === 192 && b === 2) return true
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return true
    if (a === 203 && b === 0) return true
    return a >= 224
  }
  if (lower === '::1') return false
  if (lower === '::' || lower.startsWith('fe80:') || lower.startsWith('ff') || lower.startsWith('2001:db8:') || lower.startsWith('2001:2:')) return true
  if (lower.startsWith('fc') || lower.startsWith('fd')) return false
  if (lower.startsWith('::ffff:')) return isBlockedResolvedAddress(lower.slice('::ffff:'.length))
  return false
}

async function assertSafeResolvedHost(url: URL): Promise<{ address: string; family: 4 | 6 }> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const resolved = await Promise.race<ReadonlyArray<{ address: string; family: 4 | 6 }>>([
      lookup(url.hostname, { all: true, verbatim: true }) as Promise<ReadonlyArray<{ address: string; family: 4 | 6 }>>,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DNS resolution timed out.')), 3_000) })
    ])
    if (resolved.some((entry) => isBlockedResolvedAddress(entry.address))) {
      throw new Error('Home Assistant URL resolves to a blocked link-local or metadata address.')
    }
    const safe = resolved[0]
    if (!safe) throw new Error('Home Assistant hostname returned no addresses.')
    return safe
  } catch (error) {
    if (error instanceof Error && error.message.includes('blocked')) throw error
    throw new Error('Home Assistant hostname could not be resolved safely.')
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function requestPinnedJson(
  target: URL,
  init: RequestInit,
  token: string,
  maxBytes: number,
  timeoutMs: number
): Promise<unknown> {
  const resolved = await assertSafeResolvedHost(target)
  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest
  const body = typeof init.body === 'string' ? init.body : undefined
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
    ...(body ? { 'content-length': String(Buffer.byteLength(body)) } : {}),
    ...(init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : (init.headers as Record<string, string> | undefined) ?? {})
  }
  return new Promise((resolve, reject) => {
    const req = transport({
      protocol: target.protocol,
      hostname: resolved.address,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: init.method ?? 'GET',
      headers: { ...headers, host: target.host },
      ...(target.protocol === 'https:' ? { servername: target.hostname } : {}),
      timeout: timeoutMs
    }, (response) => {
      if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) {
        req.destroy()
        reject(new Error('Home Assistant tried to redirect the request. Redirects are not followed.'))
        return
      }
      const status = response.statusCode ?? 0
      if (status === 401 || status === 403) {
        req.destroy()
        reject(new HomeAssistantAuthError())
        return
      }
      if (status < 200 || status >= 300) {
        req.destroy()
        reject(new Error(`Home Assistant returned HTTP ${status}.`))
        return
      }
      const chunks: Buffer[] = []
      let total = 0
      response.on('data', (chunk: Buffer) => {
        total += chunk.byteLength
        if (total > maxBytes) {
          req.destroy(new Error('Home Assistant response exceeded the size limit.'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks, total).toString('utf8'))) }
        catch { reject(new Error('Home Assistant returned an invalid response.')) }
      })
      response.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('Home Assistant request timed out.')))
    req.on('error', reject)
    const abort = () => req.destroy(new Error('Home Assistant request was cancelled.'))
    if (init.signal) {
      if (init.signal.aborted) return abort()
      init.signal.addEventListener('abort', abort, { once: true })
      req.once('close', () => init.signal?.removeEventListener('abort', abort))
    }
    if (body) req.write(body)
    req.end()
  })
}

function arrayOf<T>(value: unknown, limit: number, label: string, mapper: (value: unknown) => T | null): T[] {
  if (!Array.isArray(value)) throw new Error(`Home Assistant discovery is incomplete: invalid ${label} registry.`)
  if (value.length > limit) throw new Error(`Home Assistant discovery is incomplete: ${label} registry exceeds the local capacity limit.`)
  const out = value.map(mapper)
  if (out.some((item) => item === null)) throw new Error(`Home Assistant discovery is incomplete: invalid ${label} registry entry.`)
  return out as T[]
}

function entity(value: unknown): HomeAssistantEntity | null {
  const attributes = isRecord(value) ? boundedAttributes(value.attributes) : null
  if (!isRecord(value) || !isHomeAssistantEntityId(value.entity_id) || typeof value.state !== 'string' || !attributes) return null
  return { entity_id: value.entity_id, state: value.state.slice(0, MAX_ATTRIBUTE_STRING), attributes, ...(typeof value.last_changed === 'string' ? { last_changed: value.last_changed.slice(0, 64) } : {}), ...(typeof value.last_updated === 'string' ? { last_updated: value.last_updated.slice(0, 64) } : {}) }
}

function entityRegistry(value: unknown): HomeAssistantEntityRegistryEntry | null {
  if (!isRecord(value) || !isHomeAssistantEntityId(value.entity_id) || !safeMetadataString(value.unique_id)) return null
  return { entity_id: value.entity_id, unique_id: value.unique_id, platform: safeMetadataString(value.platform) ? value.platform : null, device_id: safeMetadataString(value.device_id) ? value.device_id : null, area_id: safeMetadataString(value.area_id) ? value.area_id : null, disabled_by: safeMetadataString(value.disabled_by) ? value.disabled_by : null, hidden_by: safeMetadataString(value.hidden_by) ? value.hidden_by : null, name: safeMetadataString(value.name) ? value.name : null }
}

function device(value: unknown): HomeAssistantDevice | null {
  if (!isRecord(value) || !safeMetadataString(value.id) || !safeMetadataString(value.name)) return null
  const ids = Array.isArray(value.identifiers) ? value.identifiers.filter((item): item is [string, string] => Array.isArray(item) && item.length === 2 && safeMetadataString(item[0]) && safeMetadataString(item[1])).slice(0, 1000) : []
  const entries = Array.isArray(value.config_entries) ? value.config_entries.filter((item): item is string => safeMetadataString(item)).slice(0, 1000) : []
  return { id: value.id, name: value.name, name_by_user: safeMetadataString(value.name_by_user) ? value.name_by_user : null, manufacturer: safeMetadataString(value.manufacturer) ? value.manufacturer : null, model: safeMetadataString(value.model) ? value.model : null, area_id: safeMetadataString(value.area_id) ? value.area_id : null, config_entries: entries, identifiers: ids }
}

function area(value: unknown): HomeAssistantArea | null {
  if (!isRecord(value) || !safeMetadataString(value.area_id) || !safeMetadataString(value.name)) return null
  const aliases = Array.isArray(value.aliases) ? value.aliases.filter((item): item is string => safeMetadataString(item)).slice(0, 100) : []
  return { id: value.area_id, name: value.name, aliases, picture: safeMetadataString(value.picture, 2048) ? value.picture : null }
}

function serviceList(value: unknown): HomeAssistantService[] {
  if (!isRecord(value)) throw new Error('Home Assistant discovery is incomplete: invalid service registry.')
  const out: HomeAssistantService[] = []
  for (const [domain, rawDomain] of Object.entries(value)) {
    if (!/^[a-z0-9_]+$/u.test(domain) || !isRecord(rawDomain)) throw new Error('Home Assistant returned an invalid service domain.')
    for (const [service, rawService] of Object.entries(rawDomain)) {
      if (out.length >= HOME_ASSISTANT_MAX_SERVICES) throw new Error('Home Assistant discovery is incomplete: service registry exceeds the local capacity limit.')
      if (!/^[a-z0-9_]+$/u.test(service) || !isRecord(rawService)) throw new Error('Home Assistant discovery is incomplete: invalid service entry.')
      const fields = isRecord(rawService.fields) ? boundedValue(rawService.fields) : Object.create(null)
      out.push({ domain, service, name: typeof rawService.name === 'string' ? rawService.name.slice(0, MAX_ATTRIBUTE_STRING) : `${domain}.${service}`, description: typeof rawService.description === 'string' ? rawService.description.slice(0, MAX_ATTRIBUTE_STRING) : '', fields: isRecord(fields) ? fields : Object.create(null) })
    }
  }
  return out
}

export function validateHomeAssistantBaseUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, error: 'Enter a Home Assistant URL.' }
  const checked = validateFetchUrl(raw.trim())
  if (!checked.ok) return { ok: false, error: checked.error }
  if (checked.url.search || checked.url.hash) {
    return { ok: false, error: 'The Home Assistant base URL must not contain a query or fragment.' }
  }
  const normalized = baseUrl(raw)
  return normalized ? { ok: true, url: normalized } : { ok: false, error: 'The Home Assistant URL is not safe to use.' }
}

export class HomeAssistantClient {
  private ws: WebSocket | null = null
  private generation = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private authBlocked = false
  private state: HomeAssistantConnectionState = 'unconfigured'
  private dataState: 'unknown' | 'live' | 'stale' = 'unknown'
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
    this.stop(false, false)
    this.instance = instance
    this.clearSnapshot()
    this.authBlocked = false
    this.dataState = 'unknown'
    this.state = instance.enabled ? 'unconfigured' : 'offline'
    this.emit()
  }

  private clearSnapshot(): void {
    this.entities = []
    this.entityRegistry = []
    this.services = []
    this.devices = []
    this.areas = []
    this.lastSyncAt = null
  }

  onUpdate(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  status(hasToken = false): HomeAssistantConnectionStatus {
    return { instanceId: this.instance.id, state: this.state, dataState: this.dataState, detail: this.detail, lastConnectedAt: this.lastConnectedAt, lastSyncAt: this.lastSyncAt, reconnectAttempt: this.reconnectAttempt, generation: this.generation, hasToken }
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
    const target = new URL(this.endpoint(pathname))
    await assertSafeResolvedHost(target)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HOME_ASSISTANT_REQUEST_TIMEOUT_MS)
    try {
      return await requestPinnedJson(target, { ...init, signal: controller.signal }, token, HOME_ASSISTANT_MAX_RESPONSE_BYTES, HOME_ASSISTANT_REQUEST_TIMEOUT_MS)
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Home Assistant request timed out.')
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async refresh(): Promise<HomeAssistantSnapshot> {
    const generation = this.generation
    if (!this.instance.enabled) {
      this.setState('offline', 'This Home Assistant instance is disabled.')
      return this.snapshot([], false)
    }
    this.setState('connecting')
    if (this.authBlocked) {
      this.setState('auth-error', 'Home Assistant rejected the access token. Replace it to retry.')
      throw new HomeAssistantAuthError()
    }
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
      this.setState('connecting')
      void this.openWebSocket(generation)
      return this.snapshot([], false)
    } catch (error) {
      if (generation !== this.generation) return this.snapshot([], false)
      const message = detailOf(error)
      if (error instanceof HomeAssistantAuthError || message.includes('access token')) {
        this.authBlocked = true
        this.setState('auth-error', 'Home Assistant rejected the access token. Replace it to retry.')
      } else {
        this.setState('error', message)
        this.scheduleReconnect(generation)
      }
      throw error
    }
  }

  async connect(): Promise<HomeAssistantConnectionStatus> {
    await this.refresh()
    return this.status(false)
  }

  private async openWebSocket(generation: number): Promise<void> {
    this.closeWebSocket()
    const wsUrl = this.instance.baseUrl.replace(/^http:/u, 'ws:').replace(/^https:/u, 'wss:') + '/api/websocket'
    let resolved: { address: string; family: 4 | 6 }
    try {
      resolved = await assertSafeResolvedHost(new URL(wsUrl))
    } catch (error) {
      if (generation === this.generation) {
        this.setState('error', detailOf(error))
        this.scheduleReconnect(generation)
      }
      return
    }
    if (generation !== this.generation || !this.instance.enabled) return
    let socket: WebSocket
    try {
      socket = new WebSocket(wsUrl, {
        maxPayload: WS_MAX_FRAME_BYTES,
        lookup: (_hostname, _options, callback) => callback(null, resolved.address, resolved.family)
      })
    } catch (error) {
      this.setState('reconnecting', detailOf(error))
      this.scheduleReconnect(generation)
      return
    }
    this.ws = socket
    let authTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => socket.close(), HOME_ASSISTANT_REQUEST_TIMEOUT_MS)
    let subscriptionPending = true
    socket.on('message', async (raw) => {
      if (generation !== this.generation || this.ws !== socket) return
      if (Buffer.byteLength(raw.toString(), 'utf8') > WS_MAX_FRAME_BYTES) { socket.close(); return }
      let message: unknown
      try { message = JSON.parse(raw.toString()) } catch { socket.close(); return }
      if (!isRecord(message) || typeof message.type !== 'string') return
      if (message.type === 'auth_required') {
        let token: string | null
        try {
          token = await this.token()
        } catch {
          this.setState('error', 'Home Assistant credential store is unavailable.')
          socket.close()
          return
        }
        if (!token || generation !== this.generation || this.ws !== socket) return
        socket.send(JSON.stringify({ type: 'auth', access_token: token }))
        return
      }
      if (message.type === 'auth_ok') {
        if (authTimer) clearTimeout(authTimer)
        authTimer = null
        socket.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: 'state_changed' }))
        return
      }
      if (message.type === 'auth_invalid') {
        if (authTimer) clearTimeout(authTimer)
        this.authBlocked = true
        this.setState('auth-error', 'Home Assistant rejected the access token. Replace it to retry.')
        socket.close()
        return
      }
      if (message.type === 'result' && message.id === 1) {
        if (!message.success) {
          this.setState('error', 'Home Assistant could not subscribe to state updates.')
          socket.close()
          return
        }
        subscriptionPending = false
        this.dataState = 'live'
        this.setState('connected')
        return
      }
      if (message.type === 'event' && isRecord(message.event) && message.event.event_type === 'state_changed' && isRecord(message.event.data)) {
        if (subscriptionPending) return
        const entityId = message.event.data.entity_id
        if (!isHomeAssistantEntityId(entityId)) return
        const next = message.event.data.new_state
        if (next === null) {
          this.entities = this.entities.filter((item) => item.entity_id !== entityId)
          this.lastSyncAt = Date.now()
          this.emit()
          return
        }
        const parsed = entity(next)
        if (parsed) {
          const index = this.entities.findIndex((item) => item.entity_id === parsed.entity_id)
          const previous = index >= 0 ? this.entities[index] : undefined
          const previousTime = previous?.last_updated ? Date.parse(previous.last_updated) : Number.NaN
          const nextTime = parsed.last_updated ? Date.parse(parsed.last_updated) : Number.NaN
          if (previous && Number.isFinite(previousTime) && Number.isFinite(nextTime) && nextTime < previousTime) return
          if (index < 0 && this.entities.length >= HOME_ASSISTANT_MAX_ENTITIES) return
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
      if (this.lastSyncAt !== null) this.dataState = 'stale'
      if (this.authBlocked) {
        this.setState('auth-error', 'Home Assistant rejected the access token. Replace it to retry.')
      } else {
        this.setState('reconnecting', this.detail)
        this.scheduleReconnect(generation)
      }
    })
  }

  private scheduleReconnect(generation: number): void {
    if (generation !== this.generation || this.reconnectTimer || !this.instance.enabled || this.authBlocked) return
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

  stop(preserveSnapshot = true, notify = true): void {
    this.generation += 1
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.closeWebSocket()
    if (!preserveSnapshot) this.clearSnapshot()
    this.dataState = preserveSnapshot && this.lastSyncAt !== null ? 'stale' : 'unknown'
    if (notify) this.setState('offline', 'The Home Assistant connection is stopped.')
  }

  invalidateSnapshot(): void {
    this.generation += 1
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.closeWebSocket()
    this.clearSnapshot()
    this.authBlocked = false
    this.setState('unconfigured', 'Home Assistant snapshot is stale and must be refreshed.')
  }
}

export class HomeAssistantManager implements HomeAssistantApi {
  private readonly configPath: string
  private readonly secrets: SecureStore<HomeAssistantSecretMeta>
  private config: StoredConfig = { version: 1, instances: [], bindings: [] }
  private secretStoreError = false
  private loaded: Promise<void>
  private clients = new Map<string, HomeAssistantClient>()
  private listeners = new Set<Listener>()

  constructor(private readonly hostPlatform: CorePlatform = platform()) {
    this.configPath = path.join(hostPlatform.userDataDir, CONFIG_FILE)
    this.secrets = new SecureStore<HomeAssistantSecretMeta>(SECRET_FILE, hostPlatform, 2 * 1024 * 1024)
    this.loaded = this.load()
  }

  private async load(): Promise<void> {
    try {
      const raw = await readBoundedTextFile(this.configPath, CONFIG_MAX_BYTES)
      this.config = parseConfig(JSON.parse(raw))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    let entries: Awaited<ReturnType<typeof this.secrets.load>>
    try {
      entries = await this.secrets.load()
    } catch {
      this.secretStoreError = true
      return
    }
    if (!entries.every(validSecretEntry)) {
      this.secretStoreError = true
      return
    }
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

  private async readToken(id: string): Promise<string | null> {
    if (this.secretStoreError) throw new Error('Home Assistant credential store is unavailable.')
    const entries = await this.secrets.load()
    const entry = entries.find((item) => item.meta.instanceId === id)
    if (!entry) return null
    try {
      const payload = this.secrets.unseal<{ token: string }>(entry.secretEnc)
      if (typeof payload?.token !== 'string' || payload.token.length === 0 || payload.token.length > 8192 || payload.token.trim() !== payload.token || /[\r\n\u0000]/u.test(payload.token)) throw new Error('invalid token payload')
      return payload.token
    } catch {
      throw new Error('Home Assistant credential store is unavailable.')
    }
  }

  private async hasToken(id: string): Promise<boolean> {
    if (this.secretStoreError) throw new Error('Home Assistant credential store is unavailable.')
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
    return { ...next }
  }

  async remove(id: string): Promise<void> {
    await this.ready()
    if (!safeId(id)) throw new Error('The Home Assistant instance id is invalid.')
    this.clients.get(id)?.stop(false); this.clients.delete(id)
    this.config.instances = this.config.instances.filter((item) => item.id !== id)
    this.config.bindings = this.config.bindings.filter((item) => item.instanceId !== id)
    await this.persist()
    await this.secrets.mutate((entries) => { const before = entries.length; for (let i = entries.length - 1; i >= 0; i--) if (entries[i].meta.instanceId === id) entries.splice(i, 1); return { changed: before !== entries.length, result: undefined } })
  }

  async status(id: string): Promise<HomeAssistantConnectionStatus | null> {
    await this.ready()
    const client = this.clients.get(id)
    if (!client) return null
    try {
      const hasToken = await this.hasToken(id)
      return { ...client.status(hasToken), hasToken }
    } catch {
      client.invalidateSnapshot()
      return { ...client.status(false), state: 'error', detail: 'Home Assistant credential store is unavailable.', hasToken: false }
    }
  }

  async snapshot(id: string): Promise<HomeAssistantSnapshot | null> { await this.ready(); const client = this.clients.get(id); return client ? client.snapshot(this.config.bindings.filter((binding) => binding.instanceId === id), await this.hasToken(id)) : null }

  async refresh(id: string): Promise<HomeAssistantSnapshot> { await this.ready(); const client = this.clients.get(id); if (!client) throw new Error('Home Assistant instance was not found.'); const snapshot = await client.refresh(); return { ...snapshot, bindings: this.config.bindings.filter((binding) => binding.instanceId === id), status: { ...snapshot.status, hasToken: await this.hasToken(id) } } }

  async connect(id: string): Promise<HomeAssistantConnectionStatus> { await this.refresh(id); return (await this.status(id))! }
  async disconnect(id: string): Promise<void> { await this.ready(); this.clients.get(id)?.stop() }
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
    this.secretStoreError = false
    const client = this.clients.get(id)
    client?.invalidateSnapshot()
    if (token !== null && client) void client.refresh().catch(() => undefined)
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
    return { ...binding }
  }

  async unbind(id: string): Promise<void> { await this.ready(); if (!safeId(id)) throw new Error('The Home Assistant binding id is invalid.'); this.config.bindings = this.config.bindings.filter((binding) => binding.id !== id); await this.persist() }
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
  manager.onUpdate((snapshot) => host.broadcast(IPC.homeAssistantUpdateEvent, snapshot))
  return { manager }
}
