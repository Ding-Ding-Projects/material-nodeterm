import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { AtomicJsonArrayStore } from './atomic-json-store'
import { SecureStore, type SealedEntry } from './secure-store'
import type { CorePlatform } from './platform'
import { IPC } from '../shared/ipc'
import {
  CLOUDFLARE_MANAGER_KINDS,
  CLOUDFLARE_OPERATIONS_BY_MANAGER,
  cloudflareManagerForOperation,
  isCloudflareId,
  isCloudflareZoneName,
  type CloudflareBinding,
  type CloudflareCoreManagersApi,
  type CloudflareCredentialSummary,
  type CloudflareManagerKind,
  type CloudflareOperation,
  type CloudflareOperationPreview,
  type CloudflareOperationRequest,
  type CloudflareOperationResult,
  type CloudflareProgress,
  type CloudflareRisk,
  type CloudflareRuntimeStatus
} from '../shared/cloudflare-core-managers'
import {
  createUnknownTunnelLiveState,
  TUNNEL_FACETS,
  TUNNEL_FACET_LABELS,
  transitionTunnelState,
  type TunnelFacet,
  type TunnelFacetObservation,
  type TunnelLiveState
} from '../shared/tunnel-state'

const API_BASE = 'https://api.cloudflare.com/client/v4'
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_ROWS = 500
const MAX_INPUT_TEXT = 4096
const COMMAND_TIMEOUT_MS = 90_000
const MAX_PAGE = 10_000
const MAX_PER_PAGE = 100
const TUNNEL_PROBE_TIMEOUT_MS = 30_000

interface CloudflareCredentialMeta extends CloudflareCredentialSummary {
  credentialRef: string
}

interface CloudflareCredentialSecret {
  apiToken: string
}

interface RequestSpec {
  method: CloudflareOperationPreview['method']
  path: string
  query: Record<string, string>
  body: Record<string, unknown> | null
  risk: CloudflareRisk
  pagination: CloudflareOperationPreview['pagination']
}

interface RunningOperation {
  controller: AbortController
  nodeId: string
}

function requiredText(value: unknown, label: string, max = MAX_INPUT_TEXT): string {
  if (typeof value !== 'string') throw new Error(`${label} is required.`)
  const text = value.trim()
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`${label} is invalid.`)
  return text
}

function optionalText(value: unknown, label: string, max = MAX_INPUT_TEXT): string | null {
  if (value === undefined || value === null || value === '') return null
  return requiredText(value, label, max)
}

function id(value: unknown, label: string): string {
  const text = requiredText(value, label, 128)
  if (!isCloudflareId(text)) throw new Error(`${label} is invalid.`)
  return text
}

function zoneName(value: unknown, label = 'Zone name'): string {
  const text = requiredText(value, label, 253).toLowerCase()
  if (!isCloudflareZoneName(text)) throw new Error(`${label} is invalid.`)
  return text.replace(/[.]$/, '')
}

function dnsName(value: unknown): string {
  const text = requiredText(value, 'DNS record name', 253).toLowerCase()
  if (text === '@') return text
  if (text.startsWith('*.')) return `*.${zoneName(text.slice(2))}`
  return zoneName(text, 'DNS record name')
}

function inputOf(request: CloudflareOperationRequest): Record<string, unknown> {
  if (request.input === undefined) return {}
  if (!request.input || typeof request.input !== 'object' || Array.isArray(request.input)) throw new Error('Operation input must be a typed object.')
  if (Object.keys(request.input).length > 32) throw new Error('Operation input has too many fields.')
  return request.input
}

function page(value: unknown): number {
  if (value === undefined) return 1
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_PAGE) throw new Error(`Page must be between 1 and ${MAX_PAGE}.`)
  return value
}

function perPage(value: unknown): number {
  if (value === undefined) return MAX_PER_PAGE
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_PER_PAGE) throw new Error(`Page size must be between 1 and ${MAX_PER_PAGE}.`)
  return value
}

function pathId(value: unknown, label: string): string {
  return encodeURIComponent(id(value, label))
}

function zoneId(request: CloudflareOperationRequest, binding: CloudflareBinding | null): string {
  const input = inputOf(request)
  return pathId(input.zoneId ?? binding?.zoneId, 'Zone id')
}

function accountId(request: CloudflareOperationRequest, binding: CloudflareBinding | null): string {
  const input = inputOf(request)
  return pathId(input.accountId ?? binding?.accountId, 'Account id')
}

function recordBody(request: CloudflareOperationRequest, includeId = false): Record<string, unknown> {
  const input = inputOf(request)
  const name = dnsName(input.name)
  const type = requiredText(input.type, 'DNS record type', 16).toUpperCase()
  if (!['A', 'AAAA', 'CAA', 'CNAME', 'MX', 'NS', 'SRV', 'TXT'].includes(type)) throw new Error('Choose a supported DNS record type.')
  const content = requiredText(input.content, 'DNS record content', 4096)
  const ttl = input.ttl === undefined ? 1 : input.ttl
  if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl < 1 || ttl > 2_147_483_647) throw new Error('DNS TTL must be a positive integer.')
  const result: Record<string, unknown> = { name, type, content, ttl }
  if (typeof input.proxied === 'boolean') result.proxied = input.proxied
  if (includeId) result.id = pathId(input.recordId, 'DNS record id')
  return result
}

function boundedRules(value: unknown, label: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > 100) throw new Error(`${label} must contain at most 100 rules.`)
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${label} contains an invalid rule.`)
    const source = item as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of ['ref', 'description', 'expression', 'action', 'enabled', 'actionParameters', 'targetUrl', 'statusCode']) {
      if (!(key in source)) continue
      if (key === 'ref' || key === 'description' || key === 'expression' || key === 'action' || key === 'targetUrl') out[key] = requiredText(source[key], `Rule ${key}`, 4096)
      else if (key === 'enabled') { if (typeof source[key] !== 'boolean') throw new Error('Rule enabled must be boolean.'); out[key] = source[key] }
      else if (key === 'statusCode') { if (source[key] !== 301 && source[key] !== 302 && source[key] !== 307 && source[key] !== 308) throw new Error('Redirect status code must be 301, 302, 307, or 308.'); out[key] = source[key] }
      else if (key === 'actionParameters') out[key] = ruleParameters(source[key])
    }
    if (Object.keys(out).length > 12) throw new Error(`${label} rule has too many fields.`)
    return out
  })
}

function safeSettingId(value: unknown): string {
  const setting = requiredText(value, 'Setting id', 128)
  if (!/^[a-z][a-z0-9_:-]{1,127}$/.test(setting)) throw new Error('Choose a valid SSL/TLS or cache setting.')
  const allowed = new Set(['always_use_https', 'automatic_https_rewrites', 'brotli', 'min_tls_version', 'tls_1_3', 'opportunistic_encryption', 'origin_error_page_pass_thru', 'security_header', 'cache_level', 'browser_cache_ttl', 'development_mode'])
  if (!allowed.has(setting)) throw new Error('That setting is not available in this guided manager.')
  return setting
}

function safeAnalyticsDataset(value: unknown): string {
  const dataset = requiredText(value ?? 'httpRequests1dGroups', 'Analytics dataset', 128)
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(dataset)) throw new Error('Analytics dataset is invalid.')
  return dataset
}

function typedObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  const source = value as Record<string, unknown>
  for (const key of Object.keys(source)) if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error(`${label} contains an unsafe field.`)
  if (Object.keys(source).length > 32) throw new Error(`${label} has too many fields.`)
  return source
}

function settingValue(value: unknown): string | number | boolean | Record<string, unknown> | null {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return requiredText(value, 'Setting value', 4096)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const source = typedObject(value, 'Setting value')
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(source)) {
      if (typeof item === 'string') out[key] = requiredText(item, `Setting value ${key}`, 4096)
      else if (typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) out[key] = item
      else throw new Error('Setting values must contain only bounded scalar fields.')
    }
    return out
  }
  throw new Error('Setting value must be a bounded scalar or object.')
}

function ruleParameters(value: unknown): Record<string, unknown> {
  const source = typedObject(value, 'Rule action parameters')
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) throw new Error('Rule action parameter name is invalid.')
    if (typeof item === 'string') out[key] = requiredText(item, `Rule action parameter ${key}`, 4096)
    else if (typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) out[key] = item
    else if (Array.isArray(item) && item.length <= 100 && item.every((entry) => typeof entry === 'string' && entry.length <= 4096)) out[key] = item
    else throw new Error('Rule action parameters must contain bounded scalar values.')
  }
  return out
}

function operationSpec(request: CloudflareOperationRequest, binding: CloudflareBinding | null): RequestSpec {
  const operation = request.operation
  if (cloudflareManagerForOperation(operation) !== request.manager) throw new Error('The selected operation does not belong to this Cloudflare manager.')
  const input = inputOf(request)
  const currentPage = String(page(request.page))
  const size = String(perPage(request.perPage))
  const listQuery = { page: currentPage, per_page: size }
  switch (operation) {
    case 'account-list': return { method: 'GET', path: '/accounts', query: listQuery, body: null, risk: 'read-only', pagination: 'page' }
    case 'account-get': return { method: 'GET', path: `/accounts/${accountId(request, binding)}`, query: {}, body: null, risk: 'read-only', pagination: 'none' }
    case 'zone-list': return { method: 'GET', path: '/zones', query: { ...listQuery, ...(input.name ? { name: zoneName(input.name) } : {}) }, body: null, risk: 'read-only', pagination: 'page' }
    case 'zone-get': return { method: 'GET', path: `/zones/${pathId(input.zoneId ?? binding?.zoneId, 'Zone id')}`, query: {}, body: null, risk: 'read-only', pagination: 'none' }
    case 'dns-list-records': return { method: 'GET', path: `/zones/${zoneId(request, binding)}/dns_records`, query: { ...listQuery, ...(input.name ? { name: dnsName(input.name) } : {}), ...(input.type ? { type: requiredText(input.type, 'DNS record type', 16).toUpperCase() } : {}) }, body: null, risk: 'read-only', pagination: 'page' }
    case 'dns-create-record': return { method: 'POST', path: `/zones/${zoneId(request, binding)}/dns_records`, query: {}, body: recordBody(request), risk: 'write', pagination: 'none' }
    case 'dns-update-record': return { method: 'PUT', path: `/zones/${zoneId(request, binding)}/dns_records/${pathId(input.recordId, 'DNS record id')}`, query: {}, body: recordBody(request), risk: 'write', pagination: 'none' }
    case 'dns-delete-record': return { method: 'DELETE', path: `/zones/${zoneId(request, binding)}/dns_records/${pathId(input.recordId, 'DNS record id')}`, query: {}, body: null, risk: 'destructive', pagination: 'none' }
    case 'ssl-list-settings': return { method: 'GET', path: `/zones/${zoneId(request, binding)}/settings`, query: { page: currentPage, per_page: size }, body: null, risk: 'read-only', pagination: 'page' }
    case 'ssl-get-setting': return { method: 'GET', path: `/zones/${zoneId(request, binding)}/settings/${encodeURIComponent(safeSettingId(input.settingId))}`, query: {}, body: null, risk: 'read-only', pagination: 'none' }
    case 'ssl-update-setting': return { method: 'PATCH', path: `/zones/${zoneId(request, binding)}/settings/${encodeURIComponent(safeSettingId(input.settingId))}`, query: {}, body: { value: settingValue(input.value ?? null) }, risk: 'write', pagination: 'none' }
    case 'ruleset-list': return { method: 'GET', path: `/zones/${zoneId(request, binding)}/rulesets`, query: { ...listQuery }, body: null, risk: 'read-only', pagination: 'page' }
    case 'ruleset-get': return { method: 'GET', path: `/zones/${zoneId(request, binding)}/rulesets/${pathId(input.rulesetId, 'Ruleset id')}`, query: {}, body: null, risk: 'read-only', pagination: 'none' }
    case 'ruleset-create': {
      const kind = requiredText(input.kind ?? 'zone', 'Ruleset kind', 32)
      const phase = requiredText(input.phase, 'Ruleset phase', 128)
      if (!['zone', 'root', 'custom'].includes(kind)) throw new Error('Choose a supported ruleset kind.')
      if (!/^[a-z][a-z0-9_]{1,127}$/.test(phase)) throw new Error('Ruleset phase is invalid.')
      return { method: 'POST', path: `/zones/${zoneId(request, binding)}/rulesets`, query: {}, body: { name: requiredText(input.name, 'Ruleset name', 256), description: optionalText(input.description, 'Ruleset description', 2048), kind, phase, rules: boundedRules(input.rules, 'Ruleset rules') }, risk: 'write', pagination: 'none' }
    }
    case 'ruleset-update': return { method: 'PUT', path: `/zones/${zoneId(request, binding)}/rulesets/${pathId(input.rulesetId, 'Ruleset id')}`, query: {}, body: { name: requiredText(input.name, 'Ruleset name', 256), description: optionalText(input.description, 'Ruleset description', 2048), rules: boundedRules(input.rules, 'Ruleset rules') }, risk: 'write', pagination: 'none' }
    case 'ruleset-delete': return { method: 'DELETE', path: `/zones/${zoneId(request, binding)}/rulesets/${pathId(input.rulesetId, 'Ruleset id')}`, query: {}, body: null, risk: 'destructive', pagination: 'none' }
    case 'redirect-list': return { method: 'GET', path: `/zones/${zoneId(request, binding)}/rulesets`, query: { ...listQuery, phase: 'http_request_dynamic_redirect' }, body: null, risk: 'read-only', pagination: 'page' }
    case 'redirect-create': return { method: 'POST', path: `/zones/${zoneId(request, binding)}/rulesets`, query: {}, body: { name: 'Guided redirect rules', kind: 'zone', phase: 'http_request_dynamic_redirect', rules: boundedRules(input.rules, 'Redirect rules') }, risk: 'write', pagination: 'none' }
    case 'redirect-update': return { method: 'PUT', path: `/zones/${zoneId(request, binding)}/rulesets/${pathId(input.rulesetId, 'Redirect ruleset id')}`, query: {}, body: { rules: boundedRules(input.rules, 'Redirect rules') }, risk: 'write', pagination: 'none' }
    case 'redirect-delete': return { method: 'DELETE', path: `/zones/${zoneId(request, binding)}/rulesets/${pathId(input.rulesetId, 'Redirect ruleset id')}`, query: {}, body: null, risk: 'destructive', pagination: 'none' }
    case 'cache-get-settings': return { method: 'GET', path: `/zones/${zoneId(request, binding)}/settings`, query: { page: currentPage, per_page: size, category: 'cache' }, body: null, risk: 'read-only', pagination: 'page' }
    case 'cache-update-settings': return { method: 'PATCH', path: `/zones/${zoneId(request, binding)}/settings/${encodeURIComponent(safeSettingId(input.settingId))}`, query: {}, body: { value: settingValue(input.value ?? null) }, risk: 'write', pagination: 'none' }
    case 'cache-purge': {
      const purgeEverything = input.purgeEverything === true
      if (purgeEverything) return { method: 'POST', path: `/zones/${zoneId(request, binding)}/purge_cache`, query: {}, body: { purge_everything: true }, risk: 'destructive', pagination: 'none' }
      const urls = input.urls
      if (!Array.isArray(urls) || urls.length < 1 || urls.length > 100 || urls.some((url) => typeof url !== 'string' || url.length > 2048)) throw new Error('Choose between 1 and 100 cache URLs to purge, or explicitly choose purge everything.')
      return { method: 'POST', path: `/zones/${zoneId(request, binding)}/purge_cache`, query: {}, body: { files: urls }, risk: 'write', pagination: 'none' }
    }
    case 'analytics-dashboard': return { method: 'GET', path: `/zones/${zoneId(request, binding)}/analytics/dashboard`, query: { since: requiredText(input.since ?? '24 hours ago', 'Analytics start', 64), until: requiredText(input.until ?? 'now', 'Analytics end', 64) }, body: null, risk: 'read-only', pagination: 'none' }
    case 'analytics-events': return { method: 'GET', path: `/zones/${zoneId(request, binding)}/analytics/events`, query: { ...listQuery, dataset: safeAnalyticsDataset(input.dataset), since: requiredText(input.since ?? '24 hours ago', 'Analytics start', 64), until: requiredText(input.until ?? 'now', 'Analytics end', 64) }, body: null, risk: 'read-only', pagination: 'page' }
  }
}

function sanitize(value: unknown, depth = 0, budget = { rows: 0 }): unknown {
  if (depth > 6) return '[truncated]'
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return typeof value === 'string' ? value.slice(0, 4096) : value
  if (Array.isArray(value)) return value.slice(0, MAX_ROWS).map((item) => sanitize(item, depth + 1, budget))
  if (!value || typeof value !== 'object') return null
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value).slice(0, 128)) {
    if (/token|secret|password|authorization|credential|private.?key|api.?key/i.test(key)) { out[key] = '[redacted]'; continue }
    out[key] = sanitize(item, depth + 1, budget)
  }
  return out
}

function rowsFrom(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result.slice(0, MAX_ROWS).filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)).map((item) => sanitize(item) as Record<string, unknown>)
  if (result && typeof result === 'object') return [sanitize(result) as Record<string, unknown>]
  return [{ value: result }]
}

async function readBounded(response: Response): Promise<string> {
  if (!response.body) {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Cloudflare response exceeded the 4 MiB safety bound.')
    return text
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('Cloudflare response exceeded the 4 MiB safety bound.') }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return Buffer.from(bytes).toString('utf8')
}

export class CloudflareCoreManagers implements CloudflareCoreManagersApi {
  private readonly bindings: AtomicJsonArrayStore<CloudflareBinding>
  private readonly credentialStore = new SecureStore<CloudflareCredentialMeta>('cloudflare/core-credentials.json')
  private readonly running = new Map<string, RunningOperation>()
  private readonly cancelled = new Set<string>()
  private readonly fetchImpl: typeof fetch
  private readonly tunnelStates = new Map<string, TunnelLiveState>()
  private readonly tunnelGenerations = new Map<string, number>()
  private readonly tunnelControllers = new Map<string, AbortController>()
  private readonly tunnelProbeBaselines = new Map<string, TunnelLiveState>()
  private readonly tunnelListeners = new Set<(state: TunnelLiveState & { nodeId: string }) => void>()

  constructor(private readonly platform: CorePlatform, fetchImpl: typeof fetch = globalThis.fetch) {
    this.bindings = new AtomicJsonArrayStore(join(platform.userDataDir, 'cloudflare', 'core-bindings.json'))
    this.fetchImpl = fetchImpl
  }

  async runtime(): Promise<CloudflareRuntimeStatus> {
    return typeof this.fetchImpl === 'function'
      ? { available: true, origin: 'built-in', version: 'Cloudflare API v4', disabledReason: null }
      : { available: false, origin: 'unavailable', version: null, disabledReason: 'The built-in HTTPS client is unavailable in this shell.' }
  }

  async credentials(): Promise<CloudflareCredentialSummary[]> {
    const entries = await this.credentialStore.load()
    return entries.map(({ meta }) => ({ id: meta.id, label: meta.label, accountId: meta.accountId, createdAt: meta.createdAt, updatedAt: meta.updatedAt })).sort((a, b) => a.label.localeCompare(b.label))
  }

  /** Core-only token lookup shared by the Tunnel inventory; never register this over IPC. */
  async tokenForAccount(accountId: string): Promise<string> {
    const target = id(accountId, 'Account id')
    const entry = (await this.credentialStore.load()).find((candidate) => candidate.meta.accountId === target)
    if (!entry) throw new Error('Choose a local Cloudflare credential with this account id before using tunnels.')
    const secret = this.credentialStore.unseal<CloudflareCredentialSecret>(entry.secretEnc)
    if (!secret || typeof secret.apiToken !== 'string' || secret.apiToken.length < 16) throw new Error('The selected Cloudflare credential is unavailable.')
    return secret.apiToken
  }

  async saveCredential(input: { label: string; token: string; accountId?: string | null }): Promise<CloudflareCredentialSummary> {
    const label = requiredText(input.label, 'Credential label', 256)
    const token = requiredText(input.token, 'Cloudflare API token', 4096)
    if (token.length < 16) throw new Error('Cloudflare API token is too short.')
    const account = input.accountId === null || input.accountId === undefined || input.accountId === '' ? null : id(input.accountId, 'Account id')
    const now = Date.now()
    const meta: CloudflareCredentialMeta = { id: randomUUID(), label, accountId: account, createdAt: now, updatedAt: now, credentialRef: `cloudflare-credential:${randomUUID()}` }
    const stored = await this.credentialStore.mutate((entries: SealedEntry<CloudflareCredentialMeta>[]) => {
      entries.push({ meta, secretEnc: this.credentialStore.seal({ apiToken: token } satisfies CloudflareCredentialSecret) })
      return { changed: true, result: meta }
    })
    return { id: stored.id, label: stored.label, accountId: stored.accountId, createdAt: stored.createdAt, updatedAt: stored.updatedAt }
  }

  async removeCredential(credentialId: string): Promise<boolean> {
    const target = id(credentialId, 'Credential id')
    return this.credentialStore.mutate((entries) => {
      const index = entries.findIndex((entry) => entry.meta.id === target)
      if (index < 0) return { changed: false, result: false }
      entries.splice(index, 1)
      return { changed: true, result: true }
    })
  }

  async binding(nodeId: string): Promise<CloudflareBinding | null> {
    const target = requiredText(nodeId, 'Node id', 256)
    const item = (await this.bindings.load()).find((binding) => binding.nodeId === target)
    if (!item || !isCloudflareId(item.credentialId)) return null
    return item
  }

  async bind(input: { nodeId: string; credentialId: string; accountId?: string | null; zoneId?: string | null; zoneName?: string | null }): Promise<CloudflareBinding> {
    const nodeId = requiredText(input.nodeId, 'Node id', 256)
    const credentialId = id(input.credentialId, 'Credential id')
    const available = (await this.credentialStore.load()).some((entry) => entry.meta.id === credentialId)
    if (!available) throw new Error('Choose a local Cloudflare credential before binding this manager.')
    const accountId = input.accountId === null || input.accountId === undefined || input.accountId === '' ? null : id(input.accountId, 'Account id')
    const zoneId = input.zoneId === null || input.zoneId === undefined || input.zoneId === '' ? null : id(input.zoneId, 'Zone id')
    const zone = input.zoneName === null || input.zoneName === undefined || input.zoneName === '' ? null : zoneName(input.zoneName)
    if (!accountId && !zoneId && !zone) throw new Error('Choose an account or zone identity before binding this manager.')
    const binding: CloudflareBinding = { nodeId, credentialId, accountId, zoneId, zoneName: zone, updatedAt: Date.now() }
    const current = await this.bindings.load()
    await this.bindings.save([...current.filter((item) => item.nodeId !== nodeId), binding])
    return binding
  }

  async unbind(nodeId: string): Promise<boolean> {
    const target = requiredText(nodeId, 'Node id', 256)
    const current = await this.bindings.load()
    const next = current.filter((binding) => binding.nodeId !== target)
    if (next.length === current.length) return false
    await this.bindings.save(next)
    return true
  }

  private async bindingAndToken(nodeId: string, requireBinding = true, credentialId?: string): Promise<{ binding: CloudflareBinding | null; token: string }> {
    const binding = await this.binding(nodeId)
    if (!binding && requireBinding) throw new Error('Configure this Cloudflare manager with a local credential and account or zone first.')
    const entries = await this.credentialStore.load()
    const selectedId = credentialId ?? binding?.credentialId
    const entry = entries.find((candidate) => candidate.meta.id === selectedId) ?? (binding ? undefined : entries[0])
    if (!entry) throw new Error('The local Cloudflare credential for this manager is unavailable. Choose another credential.')
    const secret = this.credentialStore.unseal<CloudflareCredentialSecret>(entry.secretEnc)
    if (!secret || typeof secret.apiToken !== 'string' || secret.apiToken.length < 16) throw new Error('The selected Cloudflare credential is unavailable.')
    return { binding, token: secret.apiToken }
  }

  async preview(nodeId: string, request: CloudflareOperationRequest): Promise<CloudflareOperationPreview> {
    const { binding } = await this.bindingAndToken(nodeId, !['account-list', 'zone-list'].includes(request.operation), request.credentialId)
    const spec = operationSpec(request, binding)
    return { manager: request.manager, operation: request.operation, ...spec, destructive: spec.risk === 'destructive' }
  }

  async execute(nodeId: string, request: CloudflareOperationRequest): Promise<CloudflareOperationResult> {
    const { binding, token } = await this.bindingAndToken(nodeId, !['account-list', 'zone-list'].includes(request.operation), request.credentialId)
    const spec = operationSpec(request, binding)
    const operationId = randomUUID()
    const controller = new AbortController()
    this.running.set(operationId, { controller, nodeId })
    this.platform.broadcast(IPC.cloudflareCoreProgress, { operationId, nodeId, phase: 'started', message: 'Cloudflare operation started.' } satisfies CloudflareProgress)
    const query = new URLSearchParams(spec.query).toString()
    const url = `${API_BASE}${spec.path}${query ? `?${query}` : ''}`
    const timer = setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS)
    try {
      const response = await this.fetchImpl(url, {
        method: spec.method,
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(spec.body ? { 'Content-Type': 'application/json' } : {}) },
        body: spec.body ? JSON.stringify(spec.body) : undefined,
        signal: controller.signal
      })
      const raw = await readBounded(response)
      let payload: Record<string, unknown>
      try { payload = JSON.parse(raw) as Record<string, unknown> } catch { throw new Error('Cloudflare returned malformed JSON.') }
      if (!response.ok || payload.success !== true) {
        const errors = Array.isArray(payload.errors) ? payload.errors.slice(0, 4).map((item) => typeof item === 'object' && item ? String((item as Record<string, unknown>).message ?? 'Cloudflare request was refused.') : String(item)).join('; ') : 'Cloudflare request was refused.'
        throw new Error(errors.slice(0, 1024))
      }
      const result = payload.result
      const info = payload.result_info && typeof payload.result_info === 'object' ? payload.result_info as Record<string, unknown> : null
      const currentPage = typeof info?.page === 'number' ? info.page : page(request.page)
      const totalPages = typeof info?.total_pages === 'number' ? info.total_pages : null
      const nextPage = totalPages !== null && currentPage < totalPages ? currentPage + 1 : null
      const total = typeof info?.total_count === 'number' ? info.total_count : null
      const completed: CloudflareOperationResult = { operationId, manager: request.manager, operation: request.operation, rows: rowsFrom(result), nextPage, total, summary: 'Cloudflare operation completed.', completedAt: Date.now() }
      this.platform.broadcast(IPC.cloudflareCoreProgress, { operationId, nodeId, phase: 'completed', message: completed.summary } satisfies CloudflareProgress)
      return completed
    } catch (error) {
      const cancelled = this.cancelled.delete(operationId) || controller.signal.aborted
      const message = cancelled ? 'Cloudflare operation cancelled.' : error instanceof Error ? error.message : String(error)
      this.platform.broadcast(IPC.cloudflareCoreProgress, { operationId, nodeId, phase: cancelled ? 'cancelled' : 'failed', message } satisfies CloudflareProgress)
      throw new Error(message)
    } finally {
      clearTimeout(timer)
      this.running.delete(operationId)
    }
  }

  async cancel(operationId: string): Promise<boolean> {
    const running = this.running.get(operationId)
    if (!running) return false
    this.cancelled.add(operationId)
    running.controller.abort()
    return true
  }

  onProgress(_listener: (progress: CloudflareProgress) => void): () => void { return () => undefined }

  async tunnelState(nodeId: string): Promise<TunnelLiveState> {
    const target = requiredText(nodeId, 'Node id', 256)
    return this.tunnelStates.get(target) ?? createUnknownTunnelLiveState()
  }

  private publishTunnelState(nodeId: string, state: TunnelLiveState): TunnelLiveState {
    this.tunnelStates.set(nodeId, state)
    const event = { nodeId, ...state }
    this.platform.broadcast(IPC.cloudflareCoreTunnelStateChanged, event)
    for (const listener of this.tunnelListeners) {
      try { listener(event) } catch { /* listeners are advisory and must not break the probe */ }
    }
    return state
  }

  private unavailableTunnelObservation(facet: TunnelFacet, hasBinding: boolean, checkedAt: number): TunnelFacetObservation {
    if (!hasBinding) {
      return {
        status: 'blocked',
        checkedAt,
        source: 'local-binding',
        evidence: 'No local Cloudflare binding was available to start this observation.',
        reason: 'Configure a local Cloudflare account binding before checking the tunnel.'
      }
    }
    return {
      status: 'unknown',
      checkedAt,
      source: 'unavailable',
      evidence: `${TUNNEL_FACET_LABELS[facet]} has no registered probe in the current Cloudflare stack.`,
      reason: 'The tunnel-specific adapter is not available on this shell yet.'
    }
  }

  async probeTunnelFacet(nodeId: string, facet: TunnelFacet): Promise<TunnelLiveState> {
    const target = requiredText(nodeId, 'Node id', 256)
    if (!TUNNEL_FACETS.includes(facet)) throw new Error('Tunnel facet is invalid.')
    const previous = this.tunnelStates.get(target) ?? createUnknownTunnelLiveState()
    const generation = (this.tunnelGenerations.get(target) ?? previous.generation) + 1
    this.tunnelGenerations.set(target, generation)
    this.tunnelControllers.get(target)?.abort()
    const controller = new AbortController()
    this.tunnelControllers.set(target, controller)
    this.tunnelProbeBaselines.set(target, previous)
    const pending = transitionTunnelState(previous, facet, {
      status: 'pending',
      checkedAt: Date.now(),
      source: 'local-binding',
      evidence: 'A bounded tunnel observation has started.'
    })
    const pendingState = pending.ok ? { ...pending.state, generation } : { ...previous, generation }
    this.publishTunnelState(target, pendingState)
    const timeout = setTimeout(() => controller.abort(), TUNNEL_PROBE_TIMEOUT_MS)
    try {
      const currentBinding = await this.binding(target)
      if (controller.signal.aborted || this.tunnelGenerations.get(target) !== generation) return previous
      const observation = this.unavailableTunnelObservation(facet, currentBinding !== null, Date.now())
      if (this.tunnelGenerations.get(target) !== generation) return previous
      const result = transitionTunnelState(pendingState, facet, observation)
      if (!result.ok) return previous
      return this.publishTunnelState(target, { ...result.state, generation })
    } catch {
      if (controller.signal.aborted || this.tunnelGenerations.get(target) !== generation) return previous
      const result = transitionTunnelState(pendingState, facet, {
        status: 'unknown',
        checkedAt: Date.now(),
        source: 'unavailable',
        evidence: 'The local Cloudflare binding could not be read.',
        reason: 'Retry after the local Cloudflare binding becomes readable.'
      })
      return result.ok ? this.publishTunnelState(target, { ...result.state, generation }) : previous
    } finally {
      clearTimeout(timeout)
      if (this.tunnelControllers.get(target) === controller) {
        this.tunnelControllers.delete(target)
        this.tunnelProbeBaselines.delete(target)
      }
    }
  }

  async cancelTunnelProbe(nodeId: string): Promise<boolean> {
    const target = requiredText(nodeId, 'Node id', 256)
    const controller = this.tunnelControllers.get(target)
    if (!controller) return false
    controller.abort()
    this.tunnelControllers.delete(target)
    const baseline = this.tunnelProbeBaselines.get(target)
    this.tunnelProbeBaselines.delete(target)
    if (baseline && this.tunnelGenerations.get(target) !== undefined) {
      this.publishTunnelState(target, { ...baseline, generation: this.tunnelGenerations.get(target)! })
    }
    return true
  }

  onTunnelState(listener: (state: TunnelLiveState & { nodeId: string }) => void): () => void {
    this.tunnelListeners.add(listener)
    return () => this.tunnelListeners.delete(listener)
  }
}

export async function ensureCloudflareDataDir(platform: CorePlatform): Promise<void> {
  await mkdir(join(platform.userDataDir, 'cloudflare'), { recursive: true })
}

export function registerCloudflareCoreManagersIpc(platform: CorePlatform): CloudflareCoreManagers {
  const manager = new CloudflareCoreManagers(platform)
  void ensureCloudflareDataDir(platform)
  platform.handle(IPC.cloudflareCoreRuntime, () => manager.runtime())
  platform.handle(IPC.cloudflareCoreCredentials, () => manager.credentials())
  platform.handle(IPC.cloudflareCoreSaveCredential, (input) => manager.saveCredential(input))
  platform.handle(IPC.cloudflareCoreRemoveCredential, (credentialId: string) => manager.removeCredential(credentialId))
  platform.handle(IPC.cloudflareCoreBinding, (nodeId: string) => manager.binding(nodeId))
  platform.handle(IPC.cloudflareCoreBind, (input) => manager.bind(input))
  platform.handle(IPC.cloudflareCoreUnbind, (nodeId: string) => manager.unbind(nodeId))
  platform.handle(IPC.cloudflareCorePreview, (nodeId: string, request: CloudflareOperationRequest) => manager.preview(nodeId, request))
  platform.handle(IPC.cloudflareCoreExecute, (nodeId: string, request: CloudflareOperationRequest) => manager.execute(nodeId, request))
  platform.handle(IPC.cloudflareCoreCancel, (operationId: string) => manager.cancel(operationId))
  platform.handle(IPC.cloudflareCoreTunnelState, (nodeId: string) => manager.tunnelState(nodeId))
  platform.handle(IPC.cloudflareCoreTunnelProbe, (nodeId: string, facet: TunnelFacet) => manager.probeTunnelFacet(nodeId, facet))
  platform.handle(IPC.cloudflareCoreTunnelCancel, (nodeId: string) => manager.cancelTunnelProbe(nodeId))
  return manager
}
