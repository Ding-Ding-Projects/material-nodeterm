import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { renameAtomic, tempNameFor } from '../fs-atomic'
import { platform, type CorePlatform } from '../platform'
import {
  isCloudflareAccountId,
  isCloudflareRecordId,
  isCloudflareTunnelId,
  isCloudflareZoneId,
  normalizeCloudflareHostname,
  normalizeCloudflarePath,
  normalizeCloudflareService,
  planCloudflareDnsAdoption,
  planCloudflareRoute,
  validateCloudflareRouteInput,
  type CloudflareDnsRecordSummary,
  type CloudflareDnsAdoptionInput,
  type CloudflareDnsAdoptionPlan,
  type CloudflareRoutePlan,
  type CloudflareRouteOwnership,
  type CloudflareTunnelRouteInput,
  type CloudflareTunnelApi,
  type CloudflareTunnelInventory,
  type CloudflareTunnelProgress,
  type CloudflareTunnelRoute,
  type CloudflareTunnelSummary,
  type CloudflareZoneSummary
} from '../../shared/cloudflare-tunnels'

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const MAX_PAGES = 100
const MAX_TUNNELS = 2_000
const MAX_ROUTES = 10_000
const MAX_DNS_RECORDS = 10_000
const MAX_ZONES = 500
const REQUEST_TIMEOUT_MS = 20_000
interface StoredRoute {
  id: string
  accountId: string
  zoneId: string
  tunnelId: string
  hostname: string
  path: string
  service: string
  protocol: 'http' | 'https' | 'tcp' | 'ssh'
  createdAt: number
  updatedAt: number
}

type FetchLike = typeof fetch

function accountId(value: unknown): string {
  if (!isCloudflareAccountId(value)) throw new Error('Cloudflare account selection is invalid.')
  return value.toLowerCase()
}

function zoneId(value: unknown): string {
  if (!isCloudflareZoneId(value)) throw new Error('Cloudflare zone selection is invalid.')
  return value.toLowerCase()
}

function recordId(value: unknown): string {
  if (!isCloudflareRecordId(value)) throw new Error('Cloudflare DNS record selection is invalid.')
  return value
}

function printable(value: unknown, label: string, max = 512): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} is invalid.`)
  return value
}

function parseNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const advertised = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(advertised) && advertised > MAX_RESPONSE_BYTES) throw new Error('Cloudflare response exceeds the 5 MB safety limit.')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Cloudflare returned an empty response body.')
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('Cloudflare response exceeds the 5 MB safety limit.')
      }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new Error('Cloudflare returned malformed JSON.') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Cloudflare returned an invalid response envelope.')
  return parsed as Record<string, unknown>
}

function resultArray(body: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(body.result)) throw new Error('Cloudflare returned an invalid result list.')
  return body.result.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
}

function resultInfo(body: Record<string, unknown>): { page: number; totalPages: number } {
  const info = body.result_info && typeof body.result_info === 'object' ? body.result_info as Record<string, unknown> : {}
  return { page: Math.max(1, Math.floor(parseNumber(info.page, 1))), totalPages: Math.min(MAX_PAGES, Math.max(1, Math.floor(parseNumber(info.total_pages, 1)))) }
}

function health(value: unknown): CloudflareTunnelSummary['health'] {
  if (value === 'healthy' || value === 'degraded' || value === 'inactive') return value
  return 'unknown'
}

function routeOwnership(value: unknown): CloudflareRouteOwnership {
  if (value === 'managed' || value === 'unmanaged') return value
  return 'unknown'
}

function mapTunnel(item: Record<string, unknown>, account: string, revision: string): CloudflareTunnelSummary | null {
  if (!isCloudflareTunnelId(item.id) || typeof item.name !== 'string' || !item.name.trim()) return null
  return {
    id: item.id,
    name: printable(item.name, 'Cloudflare tunnel name', 240),
    accountId: account,
    createdAt: typeof item.created_at === 'string' ? item.created_at : null,
    deletedAt: typeof item.deleted_at === 'string' ? item.deleted_at : null,
    health: health(item.health),
    connectorCount: Math.min(10_000, Math.floor(parseNumber(item.connector_count))),
    hostnameCount: Math.min(10_000, Math.floor(parseNumber(item.hostname_count))),
    sourceRevision: revision
  }
}

function mapRoute(item: Record<string, unknown>, tunnel: string, revision: string): CloudflareTunnelRoute | null {
  const hostname = typeof item.hostname === 'string' ? item.hostname : ''
  const service = typeof item.service === 'string' ? item.service : ''
  if (!isCloudflareTunnelId(tunnel) || typeof item.id !== 'string' || !hostname || !service) return null
  try {
    const normalizedHost = normalizeCloudflareHostname(hostname)
    const origin = normalizeCloudflareService(service)
    return { id: printable(item.id, 'Cloudflare route id', 128), tunnelId: tunnel, hostname: normalizedHost, path: normalizeCloudflarePath(item.path), origin, ownership: routeOwnership(item.ownership), dnsRecordId: isCloudflareRecordId(item.dns_record_id) ? item.dns_record_id : null, dnsProxied: typeof item.dns_proxied === 'boolean' ? item.dns_proxied : null, sourceRevision: revision }
  } catch { return null }
}

function mapDns(item: Record<string, unknown>, zone: string, revision: string): CloudflareDnsRecordSummary | null {
  if (!isCloudflareRecordId(item.id) || typeof item.name !== 'string' || typeof item.content !== 'string') return null
  const type = item.type === 'A' || item.type === 'AAAA' || item.type === 'CNAME' || item.type === 'TXT' ? item.type : 'other'
  return { id: item.id, zoneId: zone, type, name: printable(item.name, 'DNS record name', 253).toLowerCase().replace(/\.$/, ''), content: printable(item.content, 'DNS record content', 2048), proxied: typeof item.proxied === 'boolean' ? item.proxied : null, ttl: typeof item.ttl === 'number' && Number.isFinite(item.ttl) ? item.ttl : null, sourceRevision: revision }
}

/** Keep provider catch-all and otherwise unmanaged ingress rules when adding one route. */
function safeIngressRule(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  if (typeof item.service !== 'string') return null
  try {
    const origin = normalizeCloudflareService(item.service)
    const rule: Record<string, unknown> = { ...item, service: origin.service }
    if (typeof item.hostname === 'string' && item.hostname.trim()) rule.hostname = normalizeCloudflareHostname(item.hostname)
    if (typeof item.path === 'string' && item.path.trim()) rule.path = normalizeCloudflarePath(item.path)
    return rule
  } catch { return null }
}

export class CloudflareTunnelService implements CloudflareTunnelApi {
  private readonly root: string
  private readonly routesFile: string
  private readonly operations = new Map<string, AbortController>()
  private readonly progressListeners = new Set<(progress: CloudflareTunnelProgress) => void>()

  constructor(
    private readonly host: CorePlatform = platform(),
    private readonly request: FetchLike = fetch,
    private readonly resolveToken: (accountId: string) => Promise<string> = async () => {
      throw new Error('Choose a Cloudflare credential from the Cloudflare manager before using tunnels.')
    }
  ) {
    this.root = path.join(host.userDataDir, 'cloudflare-tunnels')
    this.routesFile = path.join(this.root, 'routes.json')
  }

  private emit(progress: CloudflareTunnelProgress): void { this.progressListeners.forEach((listener) => listener(progress)) }

  onProgress(listener: (progress: CloudflareTunnelProgress) => void): () => void { this.progressListeners.add(listener); return () => this.progressListeners.delete(listener) }

  private async token(rawAccountId: string): Promise<string> {
    return this.resolveToken(accountId(rawAccountId))
  }

  private async get(account: string, pathname: string, query: Record<string, string>, controller: AbortController): Promise<Record<string, unknown>> {
    const url = new URL(`https://api.cloudflare.com/client/v4${pathname}`)
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value))
    const response = await this.request(url.href, { method: 'GET', headers: { Authorization: `Bearer ${await this.token(account)}`, Accept: 'application/json' }, redirect: 'manual', signal: controller.signal })
    if (response.status >= 300 && response.status < 400) throw new Error('Cloudflare redirected the request, which is not allowed.')
    if (response.status === 401 || response.status === 403) throw new Error('Cloudflare rejected the stored API token.')
    if (!response.ok) throw new Error(`Cloudflare returned HTTP ${response.status}.`)
    const body = await boundedJson(response)
    if (body.success !== true) throw new Error('Cloudflare returned an unsuccessful response.')
    return body
  }

  private async mutate(account: string, pathname: string, method: 'PUT', body: Record<string, unknown>, controller: AbortController): Promise<Record<string, unknown>> {
    const response = await this.request(`https://api.cloudflare.com/client/v4${pathname}`, { method, headers: { Authorization: `Bearer ${await this.token(account)}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual', signal: controller.signal })
    if (response.status >= 300 && response.status < 400) throw new Error('Cloudflare redirected the request, which is not allowed.')
    if (response.status === 401 || response.status === 403) throw new Error('Cloudflare rejected the stored API token.')
    if (!response.ok) throw new Error(`Cloudflare returned HTTP ${response.status}.`)
    const result = await boundedJson(response)
    if (result.success !== true) throw new Error('Cloudflare rejected the requested change.')
    return result
  }

  async inventory(rawAccountId: string, rawZoneId?: string): Promise<CloudflareTunnelInventory> {
    const account = accountId(rawAccountId)
    const zone = rawZoneId === undefined ? null : zoneId(rawZoneId)
    const operationId = randomUUID()
    const controller = new AbortController()
    this.operations.set(operationId, controller)
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    this.emit({ operationId, phase: 'queued', progress: 0, message: 'Preparing a bounded Cloudflare inventory.' })
    try {
      const tunnels: CloudflareTunnelSummary[] = []
      let page = 1
      let revision = 'cloudflare-api-v1'
      while (page <= MAX_PAGES) {
        this.emit({ operationId, phase: 'reading-tunnels', progress: Math.min(0.35, page / MAX_PAGES), message: `Reading Cloudflare tunnels page ${page}.` })
        const body = await this.get(account, `/accounts/${account}/cfd_tunnel`, { page: String(page), per_page: '100' }, controller)
        const info = resultInfo(body)
        tunnels.push(...resultArray(body).map((item) => mapTunnel(item, account, revision)).filter((item): item is CloudflareTunnelSummary => item !== null))
        if (page >= info.totalPages || tunnels.length >= MAX_TUNNELS) break
        page = info.page + 1
      }
      const routes: CloudflareTunnelRoute[] = []
      for (const tunnel of tunnels.slice(0, MAX_TUNNELS)) {
        this.emit({ operationId, phase: 'reading-routes', progress: 0.35 + Math.min(0.35, routes.length / Math.max(1, tunnels.length) * 0.35), message: `Reading routes for ${tunnel.name}.` })
        const body = await this.get(account, `/accounts/${account}/cfd_tunnel/${tunnel.id}/configurations`, {}, controller)
        const result = body.result && typeof body.result === 'object' ? body.result as Record<string, unknown> : {}
        const ingress = Array.isArray(result.ingress) ? result.ingress : []
        for (const item of ingress) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) continue
          const route = mapRoute(item as Record<string, unknown>, tunnel.id, revision)
          if (route && route.hostname && routes.length < MAX_ROUTES) routes.push(route)
        }
      }
      const dnsRecords: CloudflareDnsRecordSummary[] = []
      if (zone) {
        page = 1
        while (page <= MAX_PAGES) {
          this.emit({ operationId, phase: 'reading-dns', progress: 0.7 + Math.min(0.25, page / MAX_PAGES * 0.25), message: `Reading DNS records page ${page}.` })
          const body = await this.get(account, `/zones/${zone}/dns_records`, { page: String(page), per_page: '100' }, controller)
          const info = resultInfo(body)
          dnsRecords.push(...resultArray(body).map((item) => mapDns(item, zone, revision)).filter((item): item is CloudflareDnsRecordSummary => item !== null))
          if (page >= info.totalPages || dnsRecords.length >= MAX_DNS_RECORDS) break
          page = info.page + 1
        }
      }
      const partial = tunnels.length >= MAX_TUNNELS || routes.length >= MAX_ROUTES || dnsRecords.length >= MAX_DNS_RECORDS
      const result: CloudflareTunnelInventory = { accountId: account, zoneId: zone, fetchedAt: Date.now(), sourceRevision: revision, complete: !partial, partial, tunnels, routes, dnsRecords, reason: partial ? 'The inventory reached a safety bound. Refresh after narrowing the selected account or zone.' : null }
      this.emit({ operationId, phase: 'completed', progress: 1, message: `Inventory contains ${tunnels.length} tunnels, ${routes.length} routes, and ${dnsRecords.length} DNS records.` })
      return result
    } catch (error) {
      const message = controller.signal.aborted ? 'Cloudflare inventory timed out or was cancelled.' : error instanceof Error ? error.message : 'Cloudflare inventory failed.'
      this.emit({ operationId, phase: controller.signal.aborted ? 'cancelled' : 'failed', progress: 0, message })
      throw new Error(message)
    } finally { clearTimeout(timeout); this.operations.delete(operationId) }
  }

  async zones(rawAccountId: string): Promise<CloudflareZoneSummary[]> {
    const account = accountId(rawAccountId)
    const controller = new AbortController()
    const zones: CloudflareZoneSummary[] = []
    for (let page = 1; page <= MAX_PAGES && zones.length < MAX_ZONES; page += 1) {
      const body = await this.get(account, `/accounts/${account}/zones`, { page: String(page), per_page: '100' }, controller)
      const info = resultInfo(body)
      zones.push(...resultArray(body).flatMap((item): CloudflareZoneSummary[] => {
        if (!isCloudflareZoneId(item.id) || typeof item.name !== 'string' || !item.name.trim()) return []
        return [{ id: item.id, name: item.name.trim().toLowerCase(), status: item.status === 'active' || item.status === 'pending' ? item.status : 'other', sourceRevision: 'cloudflare-api-v1' }]
      }))
      if (page >= info.totalPages) break
    }
    return zones.slice(0, MAX_ZONES)
  }

  async planRoute(input: CloudflareTunnelRouteInput): Promise<CloudflareRoutePlan> {
    const route = validateCloudflareRouteInput(input)
    const inventory = await this.inventoryFor(route)
    return planCloudflareRoute(route, inventory.routes, inventory.dnsRecords)
  }

  async planDnsAdoption(input: CloudflareDnsAdoptionInput): Promise<CloudflareDnsAdoptionPlan> {
    const route = validateCloudflareRouteInput(input.route)
    const inventory = await this.inventoryFor(route)
    return planCloudflareDnsAdoption(input, inventory.dnsRecords.find((record) => record.id === recordId(input.recordId)) ?? null, inventory.routes)
  }

  async saveRoute(input: CloudflareTunnelRouteInput): Promise<CloudflareTunnelRoute> {
    const route = validateCloudflareRouteInput(input)
    const inventory = await this.inventoryFor(route)
    const plan = planCloudflareRoute(route, inventory.routes, inventory.dnsRecords)
    if (plan.status !== 'ready' || !plan.route) throw new Error(plan.reason ?? 'Review the existing route before saving.')
    const controller = new AbortController()
    try {
      // Read the full configuration again immediately before the write. The inventory intentionally
      // omits the provider's catch-all rule from the renderer list, but it must still survive a
      // route addition. Sanitizing here keeps the request typed and prevents stale UI data from
      // overwriting a route that appeared after the last refresh.
      const currentConfig = await this.get(routeAccount(route, inventory), `/accounts/${routeAccount(route, inventory)}/cfd_tunnel/${route.tunnelId}/configurations`, {}, controller)
      const configResult = currentConfig.result && typeof currentConfig.result === 'object' ? currentConfig.result as Record<string, unknown> : {}
      if (!Array.isArray(configResult.ingress) || configResult.ingress.length > MAX_ROUTES) throw new Error('Cloudflare returned an unsupported ingress configuration. No route was changed.')
      const ingress = configResult.ingress.map(safeIngressRule)
      if (ingress.some((item) => item === null)) throw new Error('Cloudflare returned an ingress rule this manager cannot preserve. No route was changed.')
      const safeIngress = ingress as Record<string, unknown>[]
      await this.mutate(routeAccount(route, inventory), `/accounts/${routeAccount(route, inventory)}/cfd_tunnel/${route.tunnelId}/configurations`, 'PUT', { config: { ingress: [...safeIngress, { hostname: route.hostname, path: route.path, service: route.service }] } }, controller)
      const saved: CloudflareTunnelRoute = { id: `route-${randomUUID()}`, tunnelId: route.tunnelId, hostname: route.hostname, path: route.path ?? '/', origin: normalizeCloudflareService(route.service, route.protocol), ownership: 'managed', dnsRecordId: null, dnsProxied: null, sourceRevision: 'local-pending-refresh' }
      await this.saveLocalRoute(route, saved)
      return saved
    } finally { controller.abort() }
  }

  async adoptDnsRecord(input: CloudflareDnsAdoptionInput): Promise<CloudflareTunnelRoute> {
    const route = validateCloudflareRouteInput(input.route)
    const inventory = await this.inventoryFor(route)
    const record = inventory.dnsRecords.find((candidate) => candidate.id === recordId(input.recordId)) ?? null
    const plan = planCloudflareDnsAdoption(input, record, inventory.routes)
    if ((plan.status !== 'review-required' && !(plan.status === 'ready' && plan.action === 'leave-unmanaged')) || !plan.action || !record) throw new Error(plan.reason ?? 'Review the DNS record before adoption.')
    if (plan.action === 'replace-after-confirmation' && input.reviewText.trim() !== `ADOPT ${route.hostname}`) throw new Error(`Type ADOPT ${route.hostname} to confirm replacing this DNS record.`)
    if (plan.action === 'replace-after-confirmation') await this.mutate(routeAccount(route, inventory), `/zones/${route.zoneId}/dns_records/${record.id}`, 'PUT', { type: 'CNAME', name: route.hostname, content: `${route.tunnelId}.cfargotunnel.com`, ttl: record.ttl ?? 1, proxied: true }, new AbortController())
    const saved = await this.saveRoute({ ...route, preserveExistingRoutes: true })
    return { ...saved, dnsRecordId: record.id, dnsProxied: record.proxied }
  }

  cancel(operationId: string): void { if (typeof operationId === 'string') this.operations.get(operationId)?.abort() }

  private async inventoryFor(route: CloudflareTunnelRouteInput): Promise<CloudflareTunnelInventory> {
    return this.inventory(route.accountId, route.zoneId)
  }

  private async readRoutes(): Promise<StoredRoute[]> {
    try {
      const parsed = JSON.parse(await readFile(this.routesFile, 'utf8')) as { version?: unknown; routes?: unknown }
      if (parsed.version !== 1 || !Array.isArray(parsed.routes) || parsed.routes.length > MAX_ROUTES) throw new Error('Stored Cloudflare route metadata has an unsupported shape.')
      return parsed.routes.filter((item): item is StoredRoute => !!item && typeof item === 'object' && typeof (item as StoredRoute).accountId === 'string' && typeof (item as StoredRoute).tunnelId === 'string')
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  }

  private async saveLocalRoute(input: CloudflareTunnelRouteInput, route: CloudflareTunnelRoute): Promise<void> {
    const current = await this.readRoutes()
    const now = Date.now()
    const next: StoredRoute = { id: route.id, accountId: input.accountId, zoneId: input.zoneId, tunnelId: input.tunnelId, hostname: input.hostname, path: input.path ?? '/', service: input.service, protocol: normalizeCloudflareService(input.service, input.protocol).protocol, createdAt: now, updatedAt: now }
    const filtered = current.filter((item) => !(item.tunnelId === next.tunnelId && item.hostname === next.hostname && item.path === next.path))
    filtered.push(next)
    await mkdir(this.root, { recursive: true })
    const temporary = tempNameFor(this.routesFile)
    await writeFile(temporary, `${JSON.stringify({ version: 1, routes: filtered.slice(-MAX_ROUTES) }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await renameAtomic(temporary, this.routesFile)
  }
}

function routeAccount(route: CloudflareTunnelRouteInput, inventory: CloudflareTunnelInventory): string {
  const account = inventory.tunnels.find((tunnel) => tunnel.id === route.tunnelId)?.accountId
  if (!account) throw new Error('The selected tunnel is no longer in the account inventory. Refresh and choose it again.')
  return account
}
