import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { renameAtomic, tempNameFor, clearAtomicTarget } from '../fs-atomic'
import type { CorePlatform } from '../platform'
import { validateFetchUrl } from '../../shared/scheduled-settings'
import {
  isHomeAssistantNodeId,
  isHomeAssistantEntityId,
  validateHomeAssistantSensorConfig,
  type HomeAssistantBindingStatus,
  type HomeAssistantConfigureInput,
  type HomeAssistantEntityState,
  type HomeAssistantHistoryPoint,
  type HomeAssistantSensorApi,
  type HomeAssistantSensorConfig,
  type HomeAssistantSensorSnapshot
} from '../../shared/home-assistant-sensor'

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const MAX_ENTITIES = 10_000
const MAX_HISTORY = 720
const MAX_CACHED_ENTITIES = 48
const REQUEST_TIMEOUT_MS = 12_000

interface StoredBinding {
  version: 1
  nodeId: string
  baseUrl: string
  instanceLabel: string
  tokenFormat: 'sealed' | 'raw'
  tokenValue: string
  updatedAt: number
  lastSuccessfulAt: number | null
  lastEntities: HomeAssistantEntityState[]
  history: HomeAssistantHistoryPoint[]
}

function safeString(value: unknown, limit = 500): string | null {
  return typeof value === 'string' && !/[\u0000-\u001f]/.test(value) ? value.slice(0, limit) : null
}

function safeScalar(value: unknown): string | number | boolean | null | undefined {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return safeString(value, 1000) ?? undefined
}

function safeAttributes(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string | number | boolean | null> = {}
  for (const [key, candidate] of Object.entries(value).slice(0, 100)) {
    if (!/^[a-zA-Z0-9_]{1,100}$/.test(key)) continue
    const scalar = safeScalar(candidate)
    if (scalar !== undefined) out[key] = scalar
  }
  return out
}

function entityState(value: unknown): HomeAssistantEntityState | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const entityId = safeString(raw.entity_id, 200)
  const state = safeString(raw.state, 1000)
  const lastChanged = safeString(raw.last_changed, 80)
  const lastUpdated = safeString(raw.last_updated, 80)
  if (!entityId || !/^[a-z][a-z0-9_]*\.[a-z0-9][a-z0-9_]*$/.test(entityId) || state === null || !lastChanged || !lastUpdated) return null
  const sourceAttributes = raw.attributes && typeof raw.attributes === 'object' && !Array.isArray(raw.attributes)
    ? raw.attributes as Record<string, unknown>
    : {}
  const options = Array.isArray(sourceAttributes.options)
    ? sourceAttributes.options.map((option) => safeString(option, 120)).filter((option): option is string => option !== null).slice(0, 100)
    : []
  const friendlyName = safeString(sourceAttributes.friendly_name, 200) ?? entityId
  return {
    entityId,
    domain: entityId.split('.')[0],
    friendlyName,
    state,
    unit: safeString(sourceAttributes.unit_of_measurement, 60),
    deviceClass: safeString(sourceAttributes.device_class, 80),
    stateClass: safeString(sourceAttributes.state_class, 80),
    options,
    attributes: safeAttributes(sourceAttributes),
    lastChanged,
    lastUpdated
  }
}

function historyPoint(value: unknown): HomeAssistantHistoryPoint | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<HomeAssistantHistoryPoint>
  if (!isHomeAssistantEntityId(candidate.entityId)) return null
  if (typeof candidate.state !== 'string' || candidate.state.length > 1000 || /[\u0000-\u001f]/.test(candidate.state)) return null
  if (typeof candidate.observedAt !== 'number' || !Number.isFinite(candidate.observedAt)) return null
  const numericValue = candidate.numericValue === null ? null : typeof candidate.numericValue === 'number' && Number.isFinite(candidate.numericValue) ? candidate.numericValue : null
  return { entityId: candidate.entityId, state: candidate.state, numericValue, observedAt: candidate.observedAt }
}

function validToken(value: string): boolean {
  return value.trim() === value && value.length > 0 && value.length <= 8192 && !/[\r\n\0]/.test(value)
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new Error('Enter a valid Home Assistant base URL.') }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') + '/'
  parsed.search = ''
  parsed.hash = ''
  const probe = new URL('api/', parsed).toString()
  const safety = validateFetchUrl(probe)
  if (!safety.ok) throw new Error(safety.error)
  return parsed.toString()
}

async function readBounded(response: Response, controller: AbortController): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        controller.abort()
        throw new Error('Home Assistant returned more than the 5 MB response limit.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

export class HomeAssistantSensorService implements HomeAssistantSensorApi {
  private readonly root: string

  constructor(private readonly platform: CorePlatform) {
    this.root = path.join(platform.userDataDir, 'home-assistant-sensor-nodes')
    const hasSeal = typeof platform.sealSecret === 'function'
    const hasUnseal = typeof platform.unsealSecret === 'function'
    if (hasSeal !== hasUnseal) throw new Error('CorePlatform must supply both secret hooks or neither.')
  }

  private file(nodeId: string): string {
    if (!isHomeAssistantNodeId(nodeId)) throw new Error('Home Assistant sensor node id is invalid.')
    return path.join(this.root, `${nodeId}.json`)
  }

  private async read(nodeId: string): Promise<StoredBinding | null> {
    try {
      const parsed = JSON.parse(await readFile(this.file(nodeId), 'utf8')) as Partial<StoredBinding>
      if (parsed.version !== 1 || parsed.nodeId !== nodeId || typeof parsed.baseUrl !== 'string' || typeof parsed.instanceLabel !== 'string' || (parsed.tokenFormat !== 'sealed' && parsed.tokenFormat !== 'raw') || typeof parsed.tokenValue !== 'string') throw new Error('The local Home Assistant binding has an unsupported shape.')
      return {
        version: 1,
        nodeId,
        baseUrl: normalizeBaseUrl(parsed.baseUrl),
        instanceLabel: parsed.instanceLabel.slice(0, 120),
        tokenFormat: parsed.tokenFormat,
        tokenValue: parsed.tokenValue,
        updatedAt: typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0,
        lastSuccessfulAt: typeof parsed.lastSuccessfulAt === 'number' && Number.isFinite(parsed.lastSuccessfulAt) ? parsed.lastSuccessfulAt : null,
        lastEntities: Array.isArray(parsed.lastEntities) ? parsed.lastEntities.map(entityState).filter((entity): entity is HomeAssistantEntityState => !!entity).slice(-MAX_CACHED_ENTITIES) : [],
        history: Array.isArray(parsed.history) ? parsed.history.map(historyPoint).filter((point): point is HomeAssistantHistoryPoint => !!point).slice(-MAX_HISTORY) : []
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private token(binding: StoredBinding): string {
    if (binding.tokenFormat === 'raw') {
      if (!validToken(binding.tokenValue)) throw new Error('The stored Home Assistant credential is malformed.')
      return binding.tokenValue
    }
    if (!this.platform.unsealSecret) throw new Error('The stored Home Assistant credential cannot be opened on this computer.')
    const token = this.platform.unsealSecret(Buffer.from(binding.tokenValue, 'base64')).toString('utf8')
    if (!validToken(token)) throw new Error('The stored Home Assistant credential is malformed.')
    return token
  }

  private async write(binding: StoredBinding): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const target = this.file(binding.nodeId)
    const temporary = tempNameFor(target)
    await writeFile(temporary, `${JSON.stringify(binding, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await renameAtomic(temporary, target)
  }

  private async requestStates(binding: StoredBinding): Promise<HomeAssistantEntityState[]> {
    const url = new URL('api/states', binding.baseUrl).toString()
    const safety = validateFetchUrl(url)
    if (!safety.ok) throw new Error(safety.error)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(safety.url, { signal: controller.signal, redirect: 'manual', headers: { accept: 'application/json', authorization: `Bearer ${this.token(binding)}` } })
      if (response.status >= 300 && response.status < 400) throw new Error('Home Assistant tried to redirect the request. Redirects are not followed.')
      if (response.status === 401 || response.status === 403) throw new Error('Home Assistant rejected the stored access credential.')
      if (!response.ok) throw new Error(`Home Assistant returned HTTP ${response.status}.`)
      const parsed = JSON.parse(await readBounded(response, controller)) as unknown
      if (!Array.isArray(parsed) || parsed.length > MAX_ENTITIES) throw new Error('Home Assistant returned an invalid or oversized entity catalog.')
      return parsed.map(entityState).filter((entity): entity is HomeAssistantEntityState => !!entity)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('The Home Assistant request timed out.')
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async binding(nodeId: string): Promise<HomeAssistantBindingStatus> {
    try {
      const binding = await this.read(nodeId)
      return binding
        ? { nodeId, state: 'ready', instanceLabel: binding.instanceLabel, credentialStored: true, lastSuccessfulAt: binding.lastSuccessfulAt, reason: null }
        : { nodeId, state: 'unbound', instanceLabel: null, credentialStored: false, lastSuccessfulAt: null, reason: 'Configure or adopt a Home Assistant instance on this computer.' }
    } catch {
      return { nodeId, state: 'unavailable', instanceLabel: null, credentialStored: false, lastSuccessfulAt: null, reason: 'The machine-local Home Assistant binding could not be read.' }
    }
  }

  async configure(input: HomeAssistantConfigureInput): Promise<HomeAssistantBindingStatus> {
    if (!isHomeAssistantNodeId(input.nodeId)) throw new Error('Home Assistant sensor node id is invalid.')
    if (!validToken(input.token)) throw new Error('Enter a non-empty Home Assistant long-lived access credential.')
    const baseUrl = normalizeBaseUrl(input.baseUrl)
    const requestedLabel = input.instanceLabel?.trim() || new URL(baseUrl).host
    if (!requestedLabel || /[\u0000-\u001f]/.test(requestedLabel)) throw new Error('The instance label contains unsupported control characters.')
    const label = requestedLabel.slice(0, 120)
    const sealed = !!this.platform.sealSecret
    const value = sealed ? this.platform.sealSecret!(Buffer.from(input.token, 'utf8')).toString('base64') : input.token
    const binding: StoredBinding = { version: 1, nodeId: input.nodeId, baseUrl, instanceLabel: label, tokenFormat: sealed ? 'sealed' : 'raw', tokenValue: value, updatedAt: Date.now(), lastSuccessfulAt: null, lastEntities: [], history: [] }
    await this.requestStates(binding)
    binding.lastSuccessfulAt = Date.now()
    await this.write(binding)
    return { nodeId: input.nodeId, state: 'ready', instanceLabel: label, credentialStored: true, lastSuccessfulAt: binding.lastSuccessfulAt, reason: null }
  }

  async leaveUnbound(nodeId: string): Promise<HomeAssistantBindingStatus> {
    const result = await clearAtomicTarget(this.file(nodeId))
    if (!result.cleared) throw new Error('The machine-local Home Assistant binding could not be fully cleared.')
    return { nodeId, state: 'unbound', instanceLabel: null, credentialStored: false, lastSuccessfulAt: null, reason: 'This node is unbound on this computer.' }
  }

  async discover(nodeId: string): Promise<HomeAssistantEntityState[]> {
    const binding = await this.read(nodeId)
    if (!binding) throw new Error('Configure or adopt a Home Assistant instance on this computer first.')
    const entities = await this.requestStates(binding)
    binding.lastSuccessfulAt = Date.now()
    await this.write(binding)
    return entities
  }

  async refresh(nodeId: string, value: HomeAssistantSensorConfig): Promise<HomeAssistantSensorSnapshot> {
    const config = validateHomeAssistantSensorConfig(value)
    const binding = await this.read(nodeId)
    if (!binding) throw new Error('This Home Assistant sensor node is unbound on this computer.')
    let catalog: HomeAssistantEntityState[]
    let stale = false
    let reason: string | null = null
    try {
      catalog = await this.requestStates(binding)
    } catch (error) {
      catalog = binding.lastEntities
      stale = catalog.length > 0
      reason = error instanceof Error ? error.message : 'The Home Assistant instance could not be refreshed.'
      if (!stale) throw error
    }
    const byId = new Map(catalog.map((entity) => [entity.entityId, entity]))
    const entities = config.entities.map((entry) => byId.get(entry.entityId)).filter((entity): entity is HomeAssistantEntityState => !!entity)
    const missingEntityIds = config.entities.filter((entry) => !byId.has(entry.entityId)).map((entry) => entry.entityId)
    const observedAt = Date.now()
    const points = stale ? [] : entities.map((entity): HomeAssistantHistoryPoint => ({ entityId: entity.entityId, state: entity.state, numericValue: Number.isFinite(Number(entity.state)) ? Number(entity.state) : null, observedAt }))
    const selected = new Set(config.entities.map((entity) => entity.entityId))
    binding.history = [...binding.history.filter((point) => selected.has(point.entityId)), ...points].slice(-Math.min(MAX_HISTORY, config.historyLimit * Math.max(1, selected.size)))
    if (!stale) {
      binding.lastEntities = entities.slice(0, MAX_CACHED_ENTITIES)
      binding.lastSuccessfulAt = observedAt
    }
    await this.write(binding)
    const missingReason = missingEntityIds.length ? `${missingEntityIds.length} selected entity id${missingEntityIds.length === 1 ? '' : 's'} were not returned.` : null
    return { nodeId, fetchedAt: stale ? (binding.lastSuccessfulAt ?? binding.updatedAt) : observedAt, complete: !stale && missingEntityIds.length === 0, partial: stale || (missingEntityIds.length > 0 && entities.length > 0), stale, entities, history: binding.history, missingEntityIds, reason: [reason, missingReason].filter(Boolean).join(' ') || null }
  }
}
