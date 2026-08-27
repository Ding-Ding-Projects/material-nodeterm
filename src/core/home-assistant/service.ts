import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { WebSocket } from 'ws'
import { renameAtomic, tempNameFor } from '../fs-atomic'
import { getHomeAssistantInstanceToken, setHomeAssistantInstanceToken } from './secrets'
import {
  isHomeAssistantInstanceId,
  isHomeAssistantTransport,
  normalizeHomeAssistantBaseUrl,
  normalizeHomeAssistantEntity,
  validateHomeAssistantInstanceInput,
  type HomeAssistantClientEvent,
  type HomeAssistantDiscoveryRequest,
  type HomeAssistantDiscoveryResult,
  type HomeAssistantEntity,
  type HomeAssistantInstance,
  type HomeAssistantInstanceInput
} from '../../shared/home-assistant'

interface StoredInstance {
  id: string
  displayName: string
  baseUrl: string
  createdAt: number
  updatedAt: number
}

interface StoredFile { version: 1; instances: StoredInstance[] }
interface Operation { controller: AbortController; socket: WebSocket | null; timedOut: boolean }

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const MAX_ENTITIES = 20_000
const REQUEST_TIMEOUT_MS = 20_000

function storedInstance(value: unknown): value is StoredInstance {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<StoredInstance>
  if (!isHomeAssistantInstanceId(item.id) || typeof item.displayName !== 'string' || item.displayName.length === 0 || item.displayName.length > 120 || /[\u0000-\u001f\u007f]/.test(item.displayName) ||
    typeof item.baseUrl !== 'string' || item.baseUrl.length > 2048 || typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt) || item.createdAt < 0 ||
    typeof item.updatedAt !== 'number' || !Number.isFinite(item.updatedAt) || item.updatedAt < 0) return false
  try {
    return normalizeHomeAssistantBaseUrl(item.baseUrl) === item.baseUrl
  } catch {
    return false
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new Error('Home Assistant response exceeds the 5 MB safety limit.')
  // Read incrementally. `arrayBuffer()` would allocate an unbounded body before the size check,
  // which turns an advertised response limit into a post-allocation observation.
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Home Assistant returned an empty response body.')
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('Home Assistant response exceeds the 5 MB safety limit.')
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new Error('Home Assistant returned malformed JSON.') }
}

function discoveryResult(instanceId: string, transport: 'rest' | 'websocket', entities: HomeAssistantEntity[], reason: string | null = null, state?: HomeAssistantDiscoveryResult['state']): HomeAssistantDiscoveryResult {
  const bounded = entities.slice(0, MAX_ENTITIES)
  return {
    instanceId,
    transport,
    state: state ?? (reason ? 'offline' : 'connected'),
    entities: bounded,
    domains: [...new Set(bounded.map((entity) => entity.domain))].sort(),
    complete: !reason && entities.length <= MAX_ENTITIES,
    partial: entities.length > MAX_ENTITIES,
    discoveredAt: Date.now(),
    reason: entities.length > MAX_ENTITIES ? `Home Assistant returned more than ${MAX_ENTITIES} entities. The bounded first ${MAX_ENTITIES} are shown.` : reason
  }
}

export class HomeAssistantService {
  private readonly file: string
  private readonly operations = new Map<string, Operation>()

  constructor(userDataDir: string, private readonly emit: (event: HomeAssistantClientEvent) => void) {
    this.file = path.join(userDataDir, 'home-assistant', 'instances.json')
  }

  private event(request: HomeAssistantDiscoveryRequest, phase: HomeAssistantClientEvent['phase'], progress: number, message: string): void {
    this.emit({ operationId: request.operationId, instanceId: request.instanceId, transport: request.transport, phase, progress, message })
  }

  private async read(): Promise<StoredFile> {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8')) as Partial<StoredFile>
      if (value.version !== 1 || !Array.isArray(value.instances) || value.instances.length > 100 || !value.instances.every(storedInstance)) {
        throw new Error('Home Assistant instance metadata has an unsupported shape.')
      }
      return { version: 1, instances: value.instances }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, instances: [] }
      throw error
    }
  }

  private async write(value: StoredFile): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const temporary = tempNameFor(this.file)
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await renameAtomic(temporary, this.file)
  }

  async instances(): Promise<HomeAssistantInstance[]> {
    const stored = await this.read()
    return Promise.all(stored.instances.map(async (instance) => ({
      ...instance,
      hasToken: (await getHomeAssistantInstanceToken(instance.id)) !== null
    })))
  }

  async saveInstance(input: HomeAssistantInstanceInput): Promise<HomeAssistantInstance> {
    const normalized = validateHomeAssistantInstanceInput(input)
    const file = await this.read()
    const id = normalized.id ?? randomUUID()
    const now = Date.now()
    const current = file.instances.find((instance) => instance.id === id)
    if (file.instances.some((instance) => instance.id !== id && instance.baseUrl === normalized.baseUrl)) {
      throw new Error('That Home Assistant address is already registered. Select the existing instance instead.')
    }
    const next: StoredInstance = {
      id,
      displayName: normalized.displayName,
      baseUrl: normalized.baseUrl,
      createdAt: current?.createdAt ?? now,
      updatedAt: now
    }
    const instances = [...file.instances.filter((instance) => instance.id !== id), next]
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
    if (instances.length > 100) throw new Error('At most 100 Home Assistant instances can be registered.')
    if (normalized.token !== null) await setHomeAssistantInstanceToken(id, normalized.token)
    await this.write({ version: 1, instances })
    return { ...next, hasToken: (await getHomeAssistantInstanceToken(id)) !== null }
  }

  async removeInstance(id: string): Promise<boolean> {
    if (!isHomeAssistantInstanceId(id)) throw new Error('Home Assistant instance id is invalid.')
    const file = await this.read()
    if (!file.instances.some((instance) => instance.id === id)) return false
    await setHomeAssistantInstanceToken(id, null)
    await this.write({ version: 1, instances: file.instances.filter((instance) => instance.id !== id) })
    return true
  }

  private async instance(id: string): Promise<{ stored: StoredInstance; token: string }> {
    if (!isHomeAssistantInstanceId(id)) throw new Error('Home Assistant instance id is invalid.')
    const stored = (await this.read()).instances.find((instance) => instance.id === id)
    if (!stored) throw new Error('This Home Assistant binding is unavailable on this computer. Configure or rebind it before discovery.')
    const token = await getHomeAssistantInstanceToken(id)
    if (!token) throw new Error('This Home Assistant instance has no stored access token. Add one before discovery.')
    return { stored, token }
  }

  async discover(request: HomeAssistantDiscoveryRequest): Promise<HomeAssistantDiscoveryResult> {
    if (!request || typeof request !== 'object' ||
      !isHomeAssistantInstanceId(request.instanceId) ||
      !isHomeAssistantTransport(request.transport) ||
      typeof request.operationId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{5,160}$/.test(request.operationId)) {
      throw new Error('Home Assistant discovery request is invalid.')
    }
    if (this.operations.has(request.operationId)) throw new Error('That Home Assistant discovery operation is already running.')
    const operation: Operation = { controller: new AbortController(), socket: null, timedOut: false }
    this.operations.set(request.operationId, operation)
    try {
      const { stored, token } = await this.instance(request.instanceId)
      this.event(request, 'connecting', 0.1, `Connecting to ${stored.displayName}.`)
      const result = request.transport === 'rest'
        ? await this.discoverRest(stored, token, request, operation)
        : await this.discoverWebSocket(stored, token, request, operation)
      this.event(request, 'completed', 1, `Discovered ${result.entities.length} entities over ${request.transport === 'rest' ? 'REST' : 'WebSocket'}.`)
      return result
    } catch (error) {
      const cancelled = operation.controller.signal.aborted && !operation.timedOut
      const reason = cancelled ? 'Discovery was cancelled. Existing results were retained.' : operation.timedOut ? 'Home Assistant discovery timed out after 20 seconds.' : error instanceof Error ? error.message : 'Home Assistant discovery failed.'
      this.event(request, cancelled ? 'cancelled' : 'failed', 0, reason)
      if (cancelled) return discoveryResult(request.instanceId, request.transport, [], reason, 'cancelled')
      throw error
    } finally {
      operation.socket?.terminate()
      this.operations.delete(request.operationId)
    }
  }

  private async discoverRest(stored: StoredInstance, token: string, request: HomeAssistantDiscoveryRequest, operation: Operation): Promise<HomeAssistantDiscoveryResult> {
    const timeout = setTimeout(() => { operation.timedOut = true; operation.controller.abort() }, REQUEST_TIMEOUT_MS)
    try {
      this.event(request, 'authenticating', 0.25, 'Authenticating with the stored access token.')
      const response = await fetch(`${stored.baseUrl}/api/states`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        // Manual redirect handling keeps a hostile or misconfigured endpoint from moving the
        // bearer request to another host, while still giving the user a useful recovery reason.
        redirect: 'manual',
        signal: operation.controller.signal
      })
      if (response.status >= 300 && response.status < 400) throw new Error('Home Assistant redirected the request, which is not allowed.')
      if (response.status === 401 || response.status === 403) throw new Error('Home Assistant rejected the stored access token.')
      if (!response.ok) throw new Error(`Home Assistant returned HTTP ${response.status}.`)
      this.event(request, 'discovering', 0.65, 'Reading bounded entity metadata from the REST API.')
      const body = await boundedJson(response)
      if (!Array.isArray(body)) throw new Error('Home Assistant returned an invalid states response.')
      return discoveryResult(stored.id, 'rest', body.map(normalizeHomeAssistantEntity).filter((value): value is HomeAssistantEntity => value !== null))
    } catch (error) {
      if (operation.timedOut) throw new Error('Home Assistant REST discovery timed out after 20 seconds.')
      throw error
    } finally { clearTimeout(timeout) }
  }

  private discoverWebSocket(stored: StoredInstance, token: string, request: HomeAssistantDiscoveryRequest, operation: Operation): Promise<HomeAssistantDiscoveryResult> {
    return new Promise((resolve, reject) => {
      const base = new URL(stored.baseUrl)
      base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
      base.pathname = `${base.pathname.replace(/\/$/, '')}/api/websocket`
      const socket = new WebSocket(base.href, { perMessageDeflate: false, maxPayload: MAX_RESPONSE_BYTES })
      operation.socket = socket
      let requestId = 1
      let authSent = false
      let stateRequested = false
      let settled = false
      const timeout = setTimeout(() => { operation.timedOut = true; finish(() => { socket.terminate(); reject(new Error('Home Assistant WebSocket discovery timed out after 20 seconds.')) }) }, REQUEST_TIMEOUT_MS)
      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        fn()
      }
      const send = (message: Record<string, string | number>): void => {
        try {
          socket.send(JSON.stringify(message))
        } catch {
          finish(() => reject(new Error('Home Assistant WebSocket connection failed while sending discovery data.')))
        }
      }
      operation.controller.signal.addEventListener('abort', () => { socket.terminate(); finish(() => reject(new Error('Home Assistant WebSocket discovery was cancelled.'))) }, { once: true })
      socket.once('error', () => finish(() => reject(new Error('Home Assistant WebSocket connection failed.'))))
      socket.once('close', () => finish(() => reject(new Error('Home Assistant WebSocket connection closed before discovery completed.'))))
      socket.on('message', (data) => {
        const bytes = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.from(data as ArrayBuffer)
        if (bytes.byteLength > MAX_RESPONSE_BYTES) return finish(() => reject(new Error('Home Assistant WebSocket response exceeds the 5 MB safety limit.')))
        let message: Record<string, unknown>
        try { message = JSON.parse(bytes.toString('utf8')) as Record<string, unknown> } catch { return finish(() => reject(new Error('Home Assistant WebSocket returned malformed JSON.'))) }
        if (message.type === 'auth_required') {
          if (!authSent) {
            authSent = true
            this.event(request, 'authenticating', 0.3, 'Authenticating the WebSocket with the stored access token.')
            send({ type: 'auth', access_token: token })
          }
        } else if (message.type === 'auth_invalid') {
          finish(() => reject(new Error('Home Assistant rejected the stored access token.')))
        } else if (message.type === 'auth_ok') {
          if (!stateRequested) {
            stateRequested = true
            this.event(request, 'discovering', 0.6, 'Requesting the current entity registry over WebSocket.')
            send({ id: requestId, type: 'get_states' })
          }
        } else if (message.type === 'result' && message.id === requestId) {
          if (message.success !== true || !Array.isArray(message.result)) return finish(() => reject(new Error('Home Assistant WebSocket discovery was refused.')))
          const entities = message.result.map(normalizeHomeAssistantEntity).filter((value): value is HomeAssistantEntity => value !== null)
          finish(() => resolve(discoveryResult(stored.id, 'websocket', entities)))
        }
      })
    })
  }

  async cancel(operationId: string): Promise<boolean> {
    const operation = this.operations.get(operationId)
    if (!operation) return false
    operation.controller.abort()
    operation.socket?.terminate()
    return true
  }
}
