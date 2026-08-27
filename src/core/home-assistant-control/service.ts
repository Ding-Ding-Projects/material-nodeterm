import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { renameAtomic, tempNameFor } from '../fs-atomic'
import { SecureStore, type SealedEntry } from '../secure-store'
import type {
  HomeAssistantCallInput,
  HomeAssistantCallResult,
  HomeAssistantConnectionInput,
  HomeAssistantConnectionSummary,
  HomeAssistantControlApi,
  HomeAssistantControlStatus,
  HomeAssistantEntity,
  HomeAssistantServiceField,
  HomeAssistantServiceSchema
} from '../../shared/home-assistant-control'
import { validHomeAssistantEntityId, validHomeAssistantServiceName } from '../../shared/home-assistant-control'

interface ConnectionMeta { id: string; label: string; origin: string }
interface ConnectionSecret { token: string }
interface BindingsFile { version: 1; nodes: Record<string, string> }

const NODE_ID_RE = /^homeassistant-control-[a-z0-9-]{1,120}$/
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 15_000

function normalizeOrigin(raw: string): string {
  const url = new URL(raw.trim())
  if (url.username || url.password || url.search || url.hash) throw new Error('The Home Assistant URL cannot contain credentials, a query, or a fragment.')
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Use HTTPS, or HTTP only for a loopback Home Assistant instance.')
  url.pathname = url.pathname.replace(/\/+$/u, '')
  return url.toString().replace(/\/$/u, '')
}

function validToken(token: string): boolean {
  return token.trim() === token && token.length > 0 && token.length <= 8192 && !/[\r\n\0]/u.test(token)
}

function summary(entry: SealedEntry<ConnectionMeta>): HomeAssistantConnectionSummary {
  return { id: entry.meta.id, label: entry.meta.label, origin: entry.meta.origin, tokenStored: true }
}

function fieldList(value: unknown): HomeAssistantServiceField[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value).slice(0, 128).map(([name, raw]) => {
    const field = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    return {
      name: name.slice(0, 100),
      description: typeof field.description === 'string' ? field.description.slice(0, 500) : '',
      required: field.required === true,
      selector: field.selector && typeof field.selector === 'object' && !Array.isArray(field.selector)
        ? field.selector as Record<string, unknown>
        : null
    }
  })
}

export class HomeAssistantControlService implements HomeAssistantControlApi {
  private readonly store = new SecureStore<ConnectionMeta>('home-assistant-connections.json')
  private readonly bindingsFile: string
  private readonly pending = new Map<string, AbortController>()
  private bindingTail: Promise<void> = Promise.resolve()

  constructor(private readonly userDataDir: string) {
    this.bindingsFile = path.join(userDataDir, 'home-assistant-control-bindings.json')
  }

  private async bindings(): Promise<BindingsFile> {
    try {
      const parsed = JSON.parse(await readFile(this.bindingsFile, 'utf8')) as Partial<BindingsFile>
      if (parsed.version !== 1 || !parsed.nodes || typeof parsed.nodes !== 'object' || Array.isArray(parsed.nodes)) throw new Error('Home Assistant bindings have an unsupported shape.')
      const nodes = Object.fromEntries(Object.entries(parsed.nodes).filter(([nodeId, connectionId]) => NODE_ID_RE.test(nodeId) && typeof connectionId === 'string'))
      return { version: 1, nodes }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, nodes: {} }
      throw error
    }
  }

  private async writeBindings(value: BindingsFile): Promise<void> {
    await mkdir(this.userDataDir, { recursive: true })
    const temp = tempNameFor(this.bindingsFile)
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await renameAtomic(temp, this.bindingsFile)
  }

  private mutateBindings<T>(mutation: (bindings: BindingsFile) => Promise<T>): Promise<T> {
    const run = this.bindingTail.then(async () => mutation(await this.bindings()))
    this.bindingTail = run.then(() => undefined, () => undefined)
    return run
  }

  async connections(): Promise<HomeAssistantConnectionSummary[]> {
    return (await this.store.load()).map(summary).sort((a, b) => a.label.localeCompare(b.label))
  }

  async configure(input: HomeAssistantConnectionInput): Promise<HomeAssistantConnectionSummary> {
    const label = input.label.trim()
    if (!label || label.length > 120) throw new Error('Connection name must be between 1 and 120 characters.')
    const origin = normalizeOrigin(input.baseUrl)
    if (!input.token || !validToken(input.token)) throw new Error('Enter a valid long-lived access token. It stays in this computer credential store.')
    const id = input.id && /^[0-9a-f-]{36}$/u.test(input.id) ? input.id : randomUUID()
    return this.store.mutate((entries) => {
      const next: SealedEntry<ConnectionMeta> = { meta: { id, label, origin }, secretEnc: this.store.seal({ token: input.token } satisfies ConnectionSecret) }
      const existing = entries.findIndex((entry) => entry.meta.id === id)
      if (existing >= 0) entries[existing] = next
      else entries.push(next)
      return { changed: true, result: summary(next) }
    })
  }

  async bind(nodeId: string, connectionId: string | null): Promise<HomeAssistantControlStatus> {
    if (!NODE_ID_RE.test(nodeId)) throw new Error('Home Assistant control node id is invalid.')
    if (connectionId && !(await this.store.load()).some((entry) => entry.meta.id === connectionId)) throw new Error('Choose a connection available on this computer.')
    await this.mutateBindings(async (bindings) => {
      if (connectionId) bindings.nodes[nodeId] = connectionId
      else delete bindings.nodes[nodeId]
      await this.writeBindings(bindings)
    })
    return this.status(nodeId)
  }

  async status(nodeId: string): Promise<HomeAssistantControlStatus> {
    if (!NODE_ID_RE.test(nodeId)) return { state: 'unavailable', connection: null, reason: 'Home Assistant control node id is invalid.' }
    const connectionId = (await this.bindings()).nodes[nodeId]
    if (!connectionId) return { state: 'unbound', connection: null, reason: 'Choose or configure a Home Assistant connection on this computer.' }
    const entry = (await this.store.load()).find((item) => item.meta.id === connectionId)
    return entry
      ? { state: 'ready', connection: summary(entry), reason: null }
      : { state: 'unavailable', connection: null, reason: 'The local connection used by this node is no longer available. Rebind it.' }
  }

  private async request(nodeId: string, pathname: string, init?: RequestInit): Promise<unknown> {
    const status = await this.status(nodeId)
    if (status.state !== 'ready' || !status.connection) throw new Error(status.reason ?? 'This node is not bound.')
    const entry = (await this.store.load()).find((item) => item.meta.id === status.connection!.id)
    if (!entry) throw new Error('The local Home Assistant connection is unavailable.')
    const secret = this.store.unseal<ConnectionSecret>(entry.secretEnc)
    if (!validToken(secret.token)) throw new Error('The stored Home Assistant credential is unavailable.')
    this.pending.get(nodeId)?.abort()
    const controller = new AbortController()
    this.pending.set(nodeId, controller)
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(`${entry.meta.origin}${pathname}`, {
        ...init,
        redirect: 'error',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${secret.token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) }
      })
      if (!response.ok) throw new Error(`Home Assistant returned HTTP ${response.status}.`)
      const length = Number(response.headers.get('content-length') ?? 0)
      if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new Error('Home Assistant response exceeded the safe size limit.')
      const text = await response.text()
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Home Assistant response exceeded the safe size limit.')
      return text ? JSON.parse(text) : null
    } finally {
      clearTimeout(timeout)
      if (this.pending.get(nodeId) === controller) this.pending.delete(nodeId)
    }
  }

  async entities(nodeId: string): Promise<HomeAssistantEntity[]> {
    const value = await this.request(nodeId, '/api/states')
    if (!Array.isArray(value)) throw new Error('Home Assistant returned an invalid entity list.')
    return value.slice(0, 20_000).flatMap((raw): HomeAssistantEntity[] => {
      if (!raw || typeof raw !== 'object') return []
      const item = raw as Record<string, unknown>
      const entityId = typeof item.entity_id === 'string' ? item.entity_id : ''
      if (!validHomeAssistantEntityId(entityId) || typeof item.state !== 'string') return []
      const attributes = item.attributes && typeof item.attributes === 'object' && !Array.isArray(item.attributes) ? item.attributes as Record<string, unknown> : {}
      return [{ entityId, domain: entityId.split('.')[0], state: item.state.slice(0, 500), friendlyName: typeof attributes.friendly_name === 'string' ? attributes.friendly_name.slice(0, 300) : entityId, attributes }]
    })
  }

  async services(nodeId: string): Promise<HomeAssistantServiceSchema[]> {
    const value = await this.request(nodeId, '/api/services')
    if (!Array.isArray(value)) throw new Error('Home Assistant returned an invalid service catalog.')
    return value.slice(0, 512).flatMap((raw): HomeAssistantServiceSchema[] => {
      if (!raw || typeof raw !== 'object') return []
      const group = raw as Record<string, unknown>
      const domain = typeof group.domain === 'string' ? group.domain : ''
      if (!validHomeAssistantServiceName(domain) || !group.services || typeof group.services !== 'object' || Array.isArray(group.services)) return []
      return Object.entries(group.services).slice(0, 256).flatMap(([service, descriptor]): HomeAssistantServiceSchema[] => {
        if (!validHomeAssistantServiceName(service) || !descriptor || typeof descriptor !== 'object') return []
        const record = descriptor as Record<string, unknown>
        return [{ domain, service, name: typeof record.name === 'string' ? record.name.slice(0, 200) : service, description: typeof record.description === 'string' ? record.description.slice(0, 1000) : '', fields: fieldList(record.fields) }]
      })
    })
  }

  async call(input: HomeAssistantCallInput): Promise<HomeAssistantCallResult> {
    if (!validHomeAssistantServiceName(input.domain) || !validHomeAssistantServiceName(input.service) || !validHomeAssistantEntityId(input.entityId)) throw new Error('The Home Assistant action is invalid.')
    if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data) || Object.keys(input.data).length > 64) throw new Error('The Home Assistant action fields are invalid.')
    for (const [key, value] of Object.entries(input.data)) {
      if (
        !validHomeAssistantServiceName(key) ||
        (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) ||
        (typeof value === 'string' && value.length > 4096) ||
        (typeof value === 'number' && !Number.isFinite(value))
      ) throw new Error('A Home Assistant action field is invalid or exceeds its bound.')
    }
    await this.request(input.nodeId, `/api/services/${input.domain}/${input.service}`, { method: 'POST', body: JSON.stringify({ entity_id: input.entityId, ...input.data }) })
    return { ok: true, message: `${input.domain}.${input.service} completed.` }
  }

  async cancel(nodeId: string): Promise<void> {
    this.pending.get(nodeId)?.abort()
  }
}
