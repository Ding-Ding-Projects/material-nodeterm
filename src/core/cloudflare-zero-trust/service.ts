import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { IPC } from '../../shared/ipc'
import {
  CLOUDFLARE_CATALOG,
  CLOUDFLARE_MAX_RESOURCES,
  CLOUDFLARE_MAX_RESULT_BYTES,
  CLOUDFLARE_MAX_TEXT,
  managerById,
  operationById,
  validateCloudflareValue,
  type CloudflareAccountInput,
  type CloudflareAccountSummary,
  type CloudflareApi,
  type CloudflareCatalog,
  type CloudflareExecutionProgress,
  type CloudflareExecutionRequest,
  type CloudflareExecutionResult,
  type CloudflareLocalBinding,
  type CloudflareManagerKind,
  type CloudflareResourceSummary
} from '../../shared/cloudflare-zero-trust'
import { SecureStore, type SealedEntry } from '../secure-store'
import type { CorePlatform } from '../platform'
import { writeFileAtomic } from '../fs-atomic'

const NODE_ID = /^[A-Za-z0-9_.:-]{1,240}$/u
const ACCOUNT_ID = /^[a-f0-9]{32}$/iu
const RESOURCE_ID = /^[A-Za-z0-9_.:@/-]{1,512}$/u
const ACCOUNT_LABEL = /^[^\u0000-\u001f\u007f]{1,240}$/u
const REQUEST_TIMEOUT_MS = 60_000

interface CloudflareAccountMeta {
  id: string
  label: string
  accountId: string
  credentialRef: string
}
interface CloudflareSecret { apiToken: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, label: string, max = CLOUDFLARE_MAX_TEXT): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`)
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max || /[\u0000-\u001f\u007f]/u.test(trimmed)) throw new Error(`${label} is invalid or too long.`)
  return trimmed
}

function accountSummary(entry: SealedEntry<CloudflareAccountMeta>): CloudflareAccountSummary {
  return { id: entry.meta.id, label: entry.meta.label, accountId: entry.meta.accountId, credentialStored: true, state: 'connected', reason: null }
}

function routeFor(manager: CloudflareManagerKind, route: string, accountId: string, values: Record<string, string | number | boolean>): string {
  const base = `/accounts/${encodeURIComponent(accountId)}`
  const value = (key: string): string => {
    const candidate = values[key]
    if (typeof candidate !== 'string' || !RESOURCE_ID.test(candidate)) throw new Error(`Choose a valid ${key}.`)
    return encodeURIComponent(candidate)
  }
  if (manager === 'access' && route === 'access-applications') return `${base}/access/apps`
  if (manager === 'access' && route === 'access-application') return `${base}/access/apps/${value('applicationId')}`
  if (manager === 'zero-trust' && route === 'zero-trust-policies') return `${base}/access/policies`
  if (manager === 'zero-trust' && route === 'zero-trust-policy') return `${base}/access/policies/${value('policyId')}`
  if (manager === 'workers' && route === 'workers-scripts') return `${base}/workers/scripts`
  if (manager === 'workers' && route === 'worker-script') return `${base}/workers/scripts/${value('scriptName')}`
  if (manager === 'pages' && route === 'pages-projects') return `${base}/pages/projects`
  if (manager === 'pages' && route === 'pages-project') return `${base}/pages/projects/${value('projectName')}`
  if (manager === 'r2' && route === 'r2-buckets') return `${base}/r2/buckets`
  if (manager === 'r2' && route === 'r2-bucket') return `${base}/r2/buckets/${value('name')}`
  if (manager === 'd1' && route === 'd1-databases') return `${base}/d1/database`
  if (manager === 'd1' && route === 'd1-database') return `${base}/d1/database/${value('databaseId')}`
  if (manager === 'queues' && route === 'queues') return `${base}/queues`
  if (manager === 'queues' && route === 'queue') return `${base}/queues/${value('queueName')}`
  if (manager === 'queues' && route === 'queue-purge') return `${base}/queues/${value('queueName')}/messages`
  throw new Error('The selected Cloudflare operation is not in the local allowlist.')
}

function bodyFor(manager: CloudflareManagerKind, operation: string, values: Record<string, string | number | boolean>): Record<string, unknown> | null {
  if (operation === 'create-application') return { name: values.name, domain: values.domain, type: 'self_hosted' }
  if (operation === 'create-policy') return { name: values.name, decision: values.decision, precedence: 1 }
  if (operation === 'create-project') return { name: values.name, production_branch: values.productionBranch }
  if (operation === 'create-bucket') return { name: values.name, locationHint: values.location }
  if (operation === 'create-database') return { name: values.name }
  if (operation === 'create-queue') return { queue_name: values.queueName }
  if (manager === 'queues' && operation === 'purge-queue') return {}
  return null
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[truncated]'
  if (typeof value === 'string') return value.length > 1_000 ? `${value.slice(0, 1_000)}…` : value
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redact(item, depth + 1))
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value).slice(0, 200)) {
    if (/(token|secret|password|key|credential|authorization)/iu.test(key)) out[key] = '[redacted]'
    else out[key] = redact(item, depth + 1)
  }
  return out
}

function resultItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.slice(0, CLOUDFLARE_MAX_RESOURCES)
  if (isRecord(value)) {
    for (const key of ['result', 'items', 'data', 'apps', 'buckets', 'databases', 'queues', 'projects', 'scripts', 'policies']) {
      if (Array.isArray(value[key])) return value[key].slice(0, CLOUDFLARE_MAX_RESOURCES)
    }
  }
  return []
}

function resourceFrom(value: unknown, kind: CloudflareManagerKind, index: number): CloudflareResourceSummary | null {
  if (!isRecord(value)) return null
  const candidate = ['id', 'uid', 'name', 'scriptName', 'projectName', 'queueName'].map((key) => value[key]).find((item): item is string => typeof item === 'string' && RESOURCE_ID.test(item))
  if (!candidate) return null
  const label = typeof value.name === 'string' ? value.name : candidate
  const metadata: Record<string, string | number | boolean> = {}
  for (const [key, item] of Object.entries(value).slice(0, 32)) {
    if (/(token|secret|password|key|credential|authorization)/iu.test(key)) continue
    if (typeof item === 'string' && item.length <= 512) metadata[key] = item
    else if (typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) metadata[key] = item
  }
  return { id: candidate || `resource-${index}`, label: label.slice(0, 512), kind, metadata }
}

export class CloudflareZeroTrustService implements CloudflareApi {
  private readonly accountStore = new SecureStore<CloudflareAccountMeta>('cloudflare-zero-trust-accounts.json')
  private readonly bindingsFile: string
  private readonly active = new Map<string, AbortController>()
  private readonly listeners = new Set<(value: CloudflareExecutionProgress & { nodeId: string }) => void>()
  private bindingsCache: Record<string, CloudflareLocalBinding> | null = null

  constructor(private readonly platform: CorePlatform) {
    this.bindingsFile = path.join(platform.userDataDir, 'cloudflare-zero-trust-bindings.json')
  }

  catalog(): Promise<CloudflareCatalog> {
    return Promise.resolve(CLOUDFLARE_CATALOG)
  }

  async accounts(): Promise<readonly CloudflareAccountSummary[]> {
    return (await this.accountStore.load()).map(accountSummary).sort((a, b) => a.label.localeCompare(b.label))
  }

  async configure(input: CloudflareAccountInput): Promise<CloudflareAccountSummary> {
    if (!input || typeof input !== 'object') throw new Error('Cloudflare account details are invalid.')
    const label = text(input.label, 'Cloudflare account label', 240)
    if (!ACCOUNT_LABEL.test(label)) throw new Error('Cloudflare account label is invalid.')
    if (!ACCOUNT_ID.test(input.accountId)) throw new Error('Cloudflare account id must be a 32-character hexadecimal id.')
    const apiToken = text(input.apiToken, 'Cloudflare API token', 8_192)
    const id = input.id && /^[0-9a-f-]{36}$/iu.test(input.id) ? input.id : randomUUID()
    return this.accountStore.mutate((entries) => {
      const index = entries.findIndex((entry) => entry.meta.id === id || entry.meta.accountId === input.accountId)
      const previous = index >= 0 ? entries[index] : null
      const meta: CloudflareAccountMeta = { id: previous?.meta.id ?? id, label, accountId: input.accountId.toLowerCase(), credentialRef: previous?.meta.credentialRef ?? `cloudflare-account:${id}` }
      const stored: SealedEntry<CloudflareAccountMeta> = { meta, secretEnc: this.accountStore.seal({ apiToken } satisfies CloudflareSecret) }
      if (index >= 0) entries[index] = stored
      else entries.push(stored)
      return { changed: true, result: accountSummary(stored) }
    })
  }

  async removeAccount(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!/^[0-9a-f-]{36}$/iu.test(id)) return { ok: false, error: 'Cloudflare account id is invalid.' }
    return this.accountStore.mutate<{ ok: true } | { ok: false; error: string }>((entries) => {
      const index = entries.findIndex((entry) => entry.meta.id === id)
      if (index < 0) return { changed: false, result: { ok: false as const, error: 'Cloudflare account was not found.' } }
      entries.splice(index, 1)
      return { changed: true, result: { ok: true as const } }
    })
  }

  private async loadBindings(): Promise<Record<string, CloudflareLocalBinding>> {
    if (this.bindingsCache) return this.bindingsCache
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.bindingsFile, 'utf8'))
      this.bindingsCache = isRecord(parsed) ? Object.fromEntries(Object.entries(parsed).slice(0, 2_000).filter(([nodeId, value]) => NODE_ID.test(nodeId) && isRecord(value) && (value.accountId === undefined || typeof value.accountId === 'string') && (value.credentialRef === undefined || typeof value.credentialRef === 'string'))) as Record<string, CloudflareLocalBinding> : {}
    } catch { this.bindingsCache = {} }
    return this.bindingsCache
  }

  private async saveBindings(): Promise<void> {
    await fs.mkdir(path.dirname(this.bindingsFile), { recursive: true })
    await writeFileAtomic(this.bindingsFile, `${JSON.stringify(this.bindingsCache ?? {}, null, 2)}\n`, { mode: 0o600 })
  }

  async binding(nodeId: string): Promise<CloudflareLocalBinding> {
    if (!NODE_ID.test(nodeId)) throw new Error('Cloudflare node identity is invalid.')
    return { ...(await this.loadBindings())[nodeId] }
  }

  async saveBinding(nodeId: string, binding: CloudflareLocalBinding): Promise<void> {
    if (!NODE_ID.test(nodeId)) throw new Error('Cloudflare local binding is invalid.')
    if (binding.accountId !== undefined && !ACCOUNT_ID.test(binding.accountId)) throw new Error('Cloudflare account id is invalid.')
    if (binding.credentialRef !== undefined && !/^cloudflare-account:[0-9a-f-]{36}$/iu.test(binding.credentialRef)) throw new Error('Cloudflare credential reference is invalid.')
    const bindings = await this.loadBindings()
    bindings[nodeId] = { ...(binding.accountId ? { accountId: binding.accountId.toLowerCase() } : {}), ...(binding.credentialRef ? { credentialRef: binding.credentialRef } : {}) }
    await this.saveBindings()
  }

  private async accountFor(nodeId: string): Promise<{ meta: CloudflareAccountMeta; token: string }> {
    const binding = await this.binding(nodeId)
    if (!binding.accountId || !binding.credentialRef) throw new Error('Choose a connected Cloudflare account before running an operation.')
    const entry = (await this.accountStore.load()).find((candidate) => candidate.meta.accountId === binding.accountId && candidate.meta.credentialRef === binding.credentialRef)
    if (!entry) throw new Error('The selected Cloudflare account is unavailable. Reconfigure or rebind it on this computer.')
    const secret = this.accountStore.unseal<CloudflareSecret>(entry.secretEnc)
    if (!secret.apiToken || secret.apiToken.length > 8_192 || /[\r\n\0]/u.test(secret.apiToken)) throw new Error('The stored Cloudflare credential is unavailable.')
    return { meta: entry.meta, token: secret.apiToken }
  }

  private async request(nodeId: string, manager: CloudflareManagerKind, operation: string, values: Record<string, string | number | boolean>, localFiles: Readonly<Record<string, string>>, onProgress: (progress: CloudflareExecutionProgress) => void): Promise<{ parsed: unknown; count: number; preview: string }> {
    const model = managerById(manager)
    const selected = operationById(manager, operation)
    if (!model || !selected) throw new Error('The selected Cloudflare manager operation is not available.')
    const account = await this.accountFor(nodeId)
    const route = routeFor(manager, selected.route, account.meta.accountId, values)
    const controller = new AbortController()
    this.active.get(nodeId)?.abort()
    this.active.set(nodeId, controller)
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    onProgress({ phase: 'running', message: `Running ${model.label}: ${selected.label}.` })
    try {
      const init: RequestInit = { method: selected.method, redirect: 'error', signal: controller.signal, headers: { Authorization: `Bearer ${account.token}`, Accept: 'application/json' } }
      const body = bodyFor(manager, operation, values)
      if (body) { init.body = JSON.stringify(body); (init.headers as Record<string, string>)['Content-Type'] = 'application/json' }
      if (selected.id === 'deploy-script') {
        const file = localFiles.scriptFile
        if (typeof file !== 'string' || file.length === 0 || file.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(file)) throw new Error('Choose a valid local Worker script file.')
        const stat = await fs.stat(file)
        if (!stat.isFile() || stat.size > CLOUDFLARE_MAX_RESULT_BYTES) throw new Error('The Worker script exceeds the safe local file limit.')
        init.body = (await fs.readFile(file)).toString('utf8')
        ;(init.headers as Record<string, string>)['Content-Type'] = 'application/javascript'
      }
      const response = await fetch(`https://api.cloudflare.com/client/v4${route}`, init)
      const bytes = Number(response.headers.get('content-length') ?? 0)
      if (Number.isFinite(bytes) && bytes > CLOUDFLARE_MAX_RESULT_BYTES) throw new Error('Cloudflare response exceeded the safe size limit.')
      const raw = await response.text()
      if (Buffer.byteLength(raw, 'utf8') > CLOUDFLARE_MAX_RESULT_BYTES) throw new Error('Cloudflare response exceeded the safe size limit.')
      let parsed: unknown = null
      try { parsed = raw ? JSON.parse(raw) : null } catch { throw new Error('Cloudflare returned an invalid JSON response.') }
      if (!response.ok || (isRecord(parsed) && parsed.success === false)) {
        const errors = isRecord(parsed) && Array.isArray(parsed.errors) ? parsed.errors.slice(0, 8).map((item) => isRecord(item) && typeof item.message === 'string' ? item.message : 'Cloudflare reported an error.') : []
        throw new Error(errors.join(' ') || `Cloudflare returned HTTP ${response.status}.`)
      }
      const count = resultItems(isRecord(parsed) ? parsed.result : parsed).length || (parsed ? 1 : 0)
      return { parsed, count, preview: JSON.stringify(redact(parsed)).slice(0, CLOUDFLARE_MAX_TEXT) }
    } finally {
      clearTimeout(timer)
      if (this.active.get(nodeId) === controller) this.active.delete(nodeId)
    }
  }

  async resources(nodeId: string, manager: CloudflareManagerKind): Promise<readonly CloudflareResourceSummary[]> {
    const listOperation = { access: 'list-applications', 'zero-trust': 'list-policies', workers: 'list-scripts', pages: 'list-projects', r2: 'list-buckets', d1: 'list-databases', queues: 'list-queues' }[manager]
    if (!listOperation) throw new Error('Cloudflare manager kind is invalid.')
    const result = await this.request(nodeId, manager, listOperation, {}, {}, () => undefined)
    return resultItems(isRecord(result.parsed) ? result.parsed.result : result.parsed).map((item, index) => resourceFrom(item, manager, index)).filter((item): item is CloudflareResourceSummary => !!item)
  }

  async execute(nodeId: string, request: CloudflareExecutionRequest, onProgress: (progress: CloudflareExecutionProgress) => void): Promise<CloudflareExecutionResult> {
    if (!NODE_ID.test(nodeId) || !request || !request.intent || !request.preview) throw new Error('Cloudflare execution request is invalid.')
    const manager = request.intent.manager
    const operation = request.intent.operation
    const selected = operationById(manager, operation)
    if (!manager || !operation || !selected || request.preview.manager !== manager || request.preview.operation !== operation || request.preview.method !== selected.method || request.preview.risk !== selected.risk) throw new Error('Cloudflare execution preview no longer matches the selected typed operation.')
    if (selected.risk === 'destructive' && request.preview.confirmed !== true) throw new Error('The destructive Cloudflare operation requires explicit confirmation.')
    const values = request.intent.values
    for (const field of selected.fields) {
      const error = validateCloudflareValue(field, field.kind === 'file' ? request.localFiles[field.id] : values[field.id])
      if (error) throw new Error(error)
    }
    onProgress({ phase: 'preparing', message: `Preparing ${selected.label}.` })
    try {
      const result = await this.request(nodeId, manager, operation, values, request.localFiles, onProgress)
      onProgress({ phase: 'complete', message: `${selected.label} completed.`, completed: result.count, total: result.count })
      return { summary: `${selected.label} completed.`, resultCount: result.count, outputPreview: result.preview || undefined }
    } catch (error) {
      if (this.active.has(nodeId)) onProgress({ phase: 'failed', message: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  async cancel(nodeId: string): Promise<void> {
    if (!NODE_ID.test(nodeId)) throw new Error('Cloudflare node identity is invalid.')
    const controller = this.active.get(nodeId)
    if (controller) { controller.abort(); this.active.delete(nodeId); this.emit(nodeId, { phase: 'cancelled', message: 'Cloudflare operation was cancelled.' }) }
  }

  onProgress(listener: (value: CloudflareExecutionProgress & { nodeId: string }) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(nodeId: string, progress: CloudflareExecutionProgress): void {
    for (const listener of this.listeners) listener({ nodeId, ...progress })
  }
}

export function registerCloudflareZeroTrustIpc(platform: CorePlatform): CloudflareZeroTrustService {
  const service = new CloudflareZeroTrustService(platform)
  platform.handle(IPC.cloudflareCatalog, () => service.catalog())
  platform.handle(IPC.cloudflareAccounts, () => service.accounts())
  platform.handle(IPC.cloudflareConfigure, (input: CloudflareAccountInput) => service.configure(input))
  platform.handle(IPC.cloudflareRemoveAccount, (id: string) => service.removeAccount(id))
  platform.handle(IPC.cloudflareBinding, (nodeId: string) => service.binding(nodeId))
  platform.handle(IPC.cloudflareSaveBinding, (nodeId: string, binding: CloudflareLocalBinding) => service.saveBinding(nodeId, binding))
  platform.handle(IPC.cloudflareResources, (nodeId: string, manager: CloudflareManagerKind) => service.resources(nodeId, manager))
  platform.handle(IPC.cloudflareExecute, (nodeId: string, request: CloudflareExecutionRequest) => service.execute(nodeId, request, (progress) => platform.broadcast(IPC.cloudflareProgress, { nodeId, ...progress })))
  platform.handle(IPC.cloudflareCancel, (nodeId: string) => service.cancel(nodeId))
  return service
}
