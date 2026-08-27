/**
 * Typed Cloudflare Tunnel inventory and route-adoption contracts.
 *
 * The renderer chooses records from a verified inventory and sends closed actions. It never sends
 * an API token, raw request, shell command, provider URL, or machine path. Portable intent keeps
 * only the route a person wants, so another computer can offer Configure, Rebind, Adopt, or Leave
 * Unbound rather than replaying a provider mutation during import.
 */

export type CloudflareTunnelHealth = 'healthy' | 'degraded' | 'inactive' | 'unknown'
export type CloudflareRouteOwnership = 'managed' | 'unmanaged' | 'unknown'
export type CloudflareConflictKind = 'none' | 'hostname-in-use' | 'route-in-use' | 'dns-in-use' | 'unknown'
export type CloudflareAdoptionAction = 'leave-unmanaged' | 'adopt-existing' | 'replace-after-confirmation'

export interface CloudflareTunnelSummary {
  id: string
  name: string
  accountId: string
  createdAt: string | null
  deletedAt: string | null
  health: CloudflareTunnelHealth
  connectorCount: number
  hostnameCount: number
  sourceRevision: string
}

export interface CloudflareTunnelOrigin {
  service: string
  path: string
  protocol: 'http' | 'https' | 'tcp' | 'ssh'
}

export interface CloudflareTunnelRoute {
  id: string
  tunnelId: string
  hostname: string
  path: string
  origin: CloudflareTunnelOrigin
  ownership: CloudflareRouteOwnership
  dnsRecordId: string | null
  dnsProxied: boolean | null
  sourceRevision: string
}

export interface CloudflareDnsRecordSummary {
  id: string
  zoneId: string
  type: 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'other'
  name: string
  content: string
  proxied: boolean | null
  ttl: number | null
  sourceRevision: string
}

export interface CloudflareZoneSummary {
  id: string
  name: string
  status: 'active' | 'pending' | 'other'
  sourceRevision: string
}

export interface CloudflareTunnelInventory {
  accountId: string
  zoneId: string | null
  fetchedAt: number
  sourceRevision: string
  complete: boolean
  partial: boolean
  tunnels: CloudflareTunnelSummary[]
  routes: CloudflareTunnelRoute[]
  dnsRecords: CloudflareDnsRecordSummary[]
  reason: string | null
}

/** A route is intentionally a closed, typed choice. There is no arbitrary API payload editor. */
export interface CloudflareTunnelRouteInput {
  accountId: string
  tunnelId: string
  zoneId: string
  hostname: string
  path?: string
  service: string
  protocol?: CloudflareTunnelOrigin['protocol']
  preserveExistingRoutes: boolean
}

export interface CloudflareRouteConflict {
  kind: CloudflareConflictKind
  hostname: string
  requestedPath: string
  existingRoute: CloudflareTunnelRoute | null
  existingDnsRecords: CloudflareDnsRecordSummary[]
  canAdopt: boolean
  reason: string
}

export interface CloudflareRoutePlan {
  status: 'ready' | 'conflict' | 'invalid'
  route: CloudflareTunnelRouteInput | null
  conflict: CloudflareRouteConflict | null
  reason: string | null
}

export interface CloudflareDnsAdoptionInput {
  route: CloudflareTunnelRouteInput
  recordId: string
  action: CloudflareAdoptionAction
  reviewText: string
}

export interface CloudflareDnsAdoptionPlan {
  status: 'ready' | 'review-required' | 'invalid'
  record: CloudflareDnsRecordSummary | null
  action: CloudflareAdoptionAction | null
  changes: string[]
  reason: string | null
}

/** Schema 3 safe intent. Account, zone, tunnel, DNS ids, credentials, and live state are omitted. */
export interface CloudflareTunnelPortableIntent {
  schemaVersion: 3
  featureId: 'cloudflare-tunnel-inventory'
  displayLabel: string
  hostname: string
  path: string
  service: string
  protocol: CloudflareTunnelOrigin['protocol']
  preserveExistingRoutes: true
  binding: 'configure-on-this-computer' | 'rebind-on-this-computer' | 'leave-unbound'
}

export interface CloudflareTunnelProgress {
  operationId: string
  phase: 'queued' | 'reading-tunnels' | 'reading-routes' | 'reading-dns' | 'review-required' | 'completed' | 'failed' | 'cancelled'
  progress: number
  message: string
}

export interface CloudflareTunnelApi {
  zones(accountId: string): Promise<CloudflareZoneSummary[]>
  inventory(accountId: string, zoneId?: string): Promise<CloudflareTunnelInventory>
  planRoute(input: CloudflareTunnelRouteInput): Promise<CloudflareRoutePlan>
  planDnsAdoption(input: CloudflareDnsAdoptionInput): Promise<CloudflareDnsAdoptionPlan>
  saveRoute(input: CloudflareTunnelRouteInput): Promise<CloudflareTunnelRoute>
  adoptDnsRecord(input: CloudflareDnsAdoptionInput): Promise<CloudflareTunnelRoute>
  cancel(operationId: string): void
  onProgress(listener: (progress: CloudflareTunnelProgress) => void): () => void
}

const ACCOUNT_ID = /^[a-f0-9]{32}$/i
const ZONE_ID = ACCOUNT_ID
const TUNNEL_ID = /^[a-f0-9-]{16,64}$/i
const RECORD_ID = /^[a-f0-9]{8,64}$/i
const HOST_LABEL = /^(?=.{1,253}$)(?!.*\.\.)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i
const SERVICE = /^(?=.{1,2048}$)(?:https?|tcp|ssh):\/\/[^\s\\]+$/i

export function isCloudflareAccountId(value: unknown): value is string {
  return typeof value === 'string' && ACCOUNT_ID.test(value)
}

export function isCloudflareZoneId(value: unknown): value is string {
  return typeof value === 'string' && ZONE_ID.test(value)
}

export function isCloudflareTunnelId(value: unknown): value is string {
  return typeof value === 'string' && TUNNEL_ID.test(value)
}

export function isCloudflareRecordId(value: unknown): value is string {
  return typeof value === 'string' && RECORD_ID.test(value)
}

export function normalizeCloudflareHostname(value: unknown): string {
  if (typeof value !== 'string' || value.length > 253 || /[\u0000-\u0020\u007f]/.test(value)) {
    throw new Error('Hostname is invalid.')
  }
  const hostname = value.trim().toLowerCase().replace(/\.$/, '')
  if (!HOST_LABEL.test(hostname) || hostname.includes('*')) throw new Error('Enter a complete hostname without a wildcard.')
  return hostname
}

export function normalizeCloudflarePath(value: unknown): string {
  if (value === undefined || value === '') return '/'
  if (typeof value !== 'string' || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value) || !value.startsWith('/')) {
    throw new Error('Route path must start with / and contain at most 512 printable characters.')
  }
  return value.replace(/\/+/g, '/').replace(/\/\.\//g, '/') || '/'
}

export function normalizeCloudflareService(value: unknown, protocol?: unknown): CloudflareTunnelOrigin {
  if (typeof value !== 'string' || !SERVICE.test(value.trim())) throw new Error('Origin service must be an HTTPS, HTTP, TCP, or SSH URL.')
  const service = value.trim()
  let url: URL
  try { url = new URL(service) } catch { throw new Error('Origin service is not a valid URL.') }
  const actual = url.protocol.slice(0, -1) as CloudflareTunnelOrigin['protocol']
  if (!['http', 'https', 'tcp', 'ssh'].includes(actual)) throw new Error('Origin protocol is not supported.')
  if (protocol !== undefined && protocol !== actual) throw new Error('Origin protocol does not match the service scheme.')
  if (url.username || url.password || url.hash) throw new Error('Origin service must not contain credentials or a fragment.')
  return { service, path: url.pathname === '/' ? '' : url.pathname, protocol: actual }
}

export function validateCloudflareRouteInput(input: CloudflareTunnelRouteInput): CloudflareTunnelRouteInput {
  if (!input || typeof input !== 'object' || !isCloudflareAccountId(input.accountId) || !isCloudflareTunnelId(input.tunnelId) || !isCloudflareZoneId(input.zoneId)) {
    throw new Error('Tunnel and zone selections are invalid. Refresh the inventory and choose them again.')
  }
  const hostname = normalizeCloudflareHostname(input.hostname)
  const path = normalizeCloudflarePath(input.path)
  const origin = normalizeCloudflareService(input.service, input.protocol)
  if (input.preserveExistingRoutes !== true) throw new Error('Existing routes must be preserved. Review the preservation choice before continuing.')
  return { accountId: input.accountId.toLowerCase(), tunnelId: input.tunnelId, zoneId: input.zoneId, hostname, path, service: origin.service, protocol: origin.protocol, preserveExistingRoutes: true }
}

export function planCloudflareRoute(
  input: CloudflareTunnelRouteInput,
  routes: readonly CloudflareTunnelRoute[],
  dnsRecords: readonly CloudflareDnsRecordSummary[]
): CloudflareRoutePlan {
  try {
    const route = validateCloudflareRouteInput(input)
    const sameHost = routes.filter((item) => item.hostname === route.hostname)
    const existingRoute = sameHost.find((item) => item.path === route.path) ?? null
    const existingDnsRecords = dnsRecords.filter((item) => item.name === route.hostname)
    if (existingRoute) {
      return {
        status: 'conflict',
        route,
        conflict: {
          kind: existingRoute.tunnelId === route.tunnelId ? 'route-in-use' : 'hostname-in-use',
          hostname: route.hostname,
          requestedPath: route.path,
          existingRoute,
          existingDnsRecords,
          canAdopt: existingRoute.tunnelId === route.tunnelId && existingRoute.ownership === 'managed',
          reason: existingRoute.tunnelId === route.tunnelId
            ? 'This route already belongs to the selected tunnel. Review it before saving.'
            : 'Another tunnel already uses this hostname and path. Existing routes are preserved.'
        },
        reason: 'Review the existing route before continuing.'
      }
    }
    if (existingDnsRecords.length && !sameHost.length) return { status: 'conflict', route, conflict: { kind: 'dns-in-use', hostname: route.hostname, requestedPath: route.path, existingRoute: null, existingDnsRecords, canAdopt: existingDnsRecords.every((record) => record.type === 'CNAME'), reason: 'A DNS record already uses this hostname. Adopt it explicitly or leave it unmanaged.' }, reason: 'DNS adoption requires an explicit review.' }
    return { status: 'ready', route, conflict: null, reason: null }
  } catch (error) {
    return { status: 'invalid', route: null, conflict: null, reason: error instanceof Error ? error.message : 'Route details are invalid.' }
  }
}

export function planCloudflareDnsAdoption(
  input: CloudflareDnsAdoptionInput,
  record: CloudflareDnsRecordSummary | null,
  existingRoutes: readonly CloudflareTunnelRoute[]
): CloudflareDnsAdoptionPlan {
  try {
    const route = validateCloudflareRouteInput(input.route)
    if (!isCloudflareRecordId(input.recordId) || !record || record.id !== input.recordId || record.zoneId !== route.zoneId || record.name !== route.hostname) {
      return { status: 'invalid', record: null, action: null, changes: [], reason: 'Choose the DNS record that exactly matches the selected zone and hostname.' }
    }
    if (input.action === 'leave-unmanaged') return { status: 'ready', record, action: input.action, changes: ['Keep the existing DNS record unchanged.', 'Save the route without changing ownership.'], reason: null }
    if (input.action === 'adopt-existing') {
      if (record.type !== 'CNAME') return { status: 'review-required', record, action: input.action, changes: [], reason: 'Only an existing CNAME can be adopted without replacing its content.' }
      if (existingRoutes.some((item) => item.hostname === route.hostname && item.path === route.path && item.tunnelId !== route.tunnelId)) return { status: 'review-required', record, action: input.action, changes: [], reason: 'Another tunnel already owns this hostname and path. Resolve that route first.' }
      return { status: 'review-required', record, action: input.action, changes: ['Adopt the existing CNAME record after review.', 'Preserve its current content and proxy setting.', 'Do not delete or replace unrelated DNS records.'], reason: 'Confirm the exact record and route ownership before adoption.' }
    }
    if (input.action === 'replace-after-confirmation') {
      if (input.reviewText.trim() !== `ADOPT ${route.hostname}`) return { status: 'review-required', record, action: input.action, changes: [], reason: `Type ADOPT ${route.hostname} to confirm replacing this DNS record.` }
      return { status: 'review-required', record, action: input.action, changes: ['Replace only this exact DNS record.', 'Preserve every other record for the hostname and zone.', 'Refresh the inventory after the provider acknowledges the change.'], reason: 'A destructive DNS replacement needs the application confirmation flow.' }
    }
    return { status: 'invalid', record, action: null, changes: [], reason: 'Choose a supported DNS adoption action.' }
  } catch (error) {
    return { status: 'invalid', record: null, action: null, changes: [], reason: error instanceof Error ? error.message : 'DNS adoption details are invalid.' }
  }
}

export function cloudflareTunnelPortableIntent(input: CloudflareTunnelRouteInput, displayLabel: string): CloudflareTunnelPortableIntent {
  const route = validateCloudflareRouteInput(input)
  if (typeof displayLabel !== 'string' || !displayLabel.trim() || displayLabel.length > 120) throw new Error('Tunnel label must contain 1 to 120 characters.')
  return { schemaVersion: 3, featureId: 'cloudflare-tunnel-inventory', displayLabel: displayLabel.trim(), hostname: route.hostname, path: route.path, service: route.service, protocol: route.protocol, preserveExistingRoutes: true, binding: 'configure-on-this-computer' }
}

export function searchCloudflareTunnelInventory<T extends CloudflareTunnelSummary | CloudflareTunnelRoute | CloudflareDnsRecordSummary>(items: readonly T[], query: string, tester?: (corpus: string) => boolean): T[] {
  const normalized = query.trim().toLocaleLowerCase()
  return items.filter((item) => {
    const corpus = Object.values(item as Record<string, unknown>).flatMap((value) => Array.isArray(value) ? value : [value]).filter((value) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean').join(' ')
    return tester ? tester(corpus) : !normalized || corpus.toLocaleLowerCase().includes(normalized)
  })
}
