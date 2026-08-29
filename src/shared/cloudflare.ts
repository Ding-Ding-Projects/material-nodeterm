/**
 * Cloudflare control-plane types for the tunnel manager.
 *
 * This namespace deliberately describes Cloudflare's API state only. It does not start or
 * supervise cloudflared. Credentials are represented by presence, never by their value, and the
 * portable project projection can safely retain only the binding intent fields.
 */

export type CloudflareOperation =
  | 'accounts'
  | 'zones'
  | 'tunnels'
  | 'configuration'
  | 'connections'
  | 'routes'
  | 'dns-records'

export type CloudflareAvailability =
  | 'not-configured'
  | 'ready'
  | 'partial-permissions'
  | 'rate-limited'
  | 'unauthorized'
  | 'unreachable'
  | 'unsupported'

export interface CloudflareAccount {
  id: string
  name: string
  status: string | null
}

export interface CloudflareZone {
  id: string
  name: string
  status: string | null
  accountId: string | null
}

export interface CloudflareTunnel {
  id: string
  name: string
  createdAt: string | null
  status: string | null
  deletedAt: string | null
}

export interface CloudflareTunnelConnection {
  id: string
  coloName: string | null
  clientId: string | null
  connectedAt: string | null
  isHealthy: boolean | null
}

export interface CloudflareTunnelRoute {
  hostname: string
  service: string
  path: string | null
  originRequest: Record<string, unknown> | null
  managed: boolean
}

export interface CloudflareDnsRecord {
  id: string
  type: string
  name: string
  content: string
  proxied: boolean | null
  ttl: number | null
}

export interface CloudflareErrorInfo {
  operation: CloudflareOperation
  status: number | null
  code: string
  message: string
  retryAfterSeconds: number | null
  /** True when this operation may be retried without changing credentials or configuration. */
  retryable: boolean
}

export interface CloudflareTunnelBinding {
  /** Safe project intent. This is the only binding shape that may enter a portable projection. */
  accountId: string
  zoneId: string | null
  tunnelId: string
  hostname: string | null
}

export interface CloudflareLocalBinding extends CloudflareTunnelBinding {
  /** Machine-local identity, never exported with the project. */
  machineId: string
  updatedAt: number
}

export type CloudflareMachineBinding = CloudflareLocalBinding

export interface CloudflareTunnelInventory {
  checkedAt: number
  availability: CloudflareAvailability
  tokenPresent: boolean
  accounts: CloudflareAccount[]
  zones: CloudflareZone[]
  tunnels: CloudflareTunnel[]
  connections: CloudflareTunnelConnection[]
  routes: CloudflareTunnelRoute[]
  dnsRecords: CloudflareDnsRecord[]
  errors: CloudflareErrorInfo[]
  binding: CloudflareMachineBinding | null
  /** No connector runtime is included in this lane. */
  connectorRuntime: 'not-included'
}

export interface CloudflareRouteInput {
  hostname: string
  service: string
  path?: string | null
  originRequest?: Record<string, unknown> | null
}

export interface CloudflareHostnameConflict {
  hostname: string
  kind: 'managed-route' | 'unmanaged-route' | 'dns-record' | 'invalid'
  detail: string
  blocking: boolean
}

export interface CloudflareConfigurationPreview {
  previewId: string
  accountId: string
  tunnelId: string
  desiredRoutes: CloudflareRouteInput[]
  preservedRoutes: CloudflareTunnelRoute[]
  conflicts: CloudflareHostnameConflict[]
  allowed: boolean
  /** Exactly what a mutation would change, with no token or private path. */
  summary: string[]
  generatedAt: number
}

export interface CloudflareDnsOwnershipProof {
  zoneId: string
  zoneName: string
  recordId: string
  recordName: string
  recordType: string
  recordContent: string
  accountId: string
  observedAt: number
}

export interface CloudflareDnsAdoptionPreview {
  previewId: string
  hostname: string
  tunnelId: string
  zoneId: string
  ownershipProof: CloudflareDnsOwnershipProof | null
  conflicts: CloudflareHostnameConflict[]
  allowed: boolean
  summary: string[]
  generatedAt: number
}

export interface CloudflareMutationResult {
  ok: boolean
  revision: number
  previewId: string
  message: string
  error?: CloudflareErrorInfo
}

export interface CloudflareApi {
  status(): Promise<CloudflareTunnelInventory>
  saveToken(token: string): Promise<CloudflareTunnelInventory>
  clearToken(): Promise<CloudflareTunnelInventory>
  bind(input: CloudflareTunnelBinding): Promise<CloudflareTunnelInventory>
  unbind(): Promise<CloudflareTunnelInventory>
  refresh(): Promise<CloudflareTunnelInventory>
  previewConfiguration(input: { accountId: string; tunnelId: string; routes: CloudflareRouteInput[] }): Promise<CloudflareConfigurationPreview>
  applyConfiguration(previewId: string): Promise<CloudflareMutationResult>
  previewDnsAdoption(input: { accountId: string; zoneId: string; tunnelId: string; hostname: string }): Promise<CloudflareDnsAdoptionPreview>
  adoptDnsRecord(previewId: string): Promise<CloudflareMutationResult>
}

export const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4'

export function toPortableCloudflareBinding(binding: CloudflareLocalBinding | null): CloudflareTunnelBinding | null {
  if (!binding) return null
  return { accountId: binding.accountId, zoneId: binding.zoneId, tunnelId: binding.tunnelId, hostname: binding.hostname }
}

export function isValidCloudflareId(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(value.trim())
}

export function isValidCloudflareHostname(value: string): boolean {
  const hostname = value.trim().toLowerCase()
  return hostname.length <= 253 &&
    hostname.length > 0 &&
    !hostname.endsWith('.') &&
    hostname.split('.').every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part))
}

export function isValidCloudflareService(value: string): boolean {
  const service = value.trim()
  if (service.length === 0 || service.length > 2048) return false
  try {
    const url = new URL(service)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch {
    return false
  }
}

/** Preserve routes the user did not explicitly manage, and return hostname collisions separately. */
export function preserveUnmanagedRoutes(
  current: CloudflareTunnelRoute[],
  desired: CloudflareRouteInput[]
): { preserved: CloudflareTunnelRoute[]; conflicts: CloudflareHostnameConflict[] } {
  const desiredNames = new Set(desired.map((route) => route.hostname.trim().toLowerCase()))
  const seen = new Set<string>()
  const preserved: CloudflareTunnelRoute[] = []
  const conflicts: CloudflareHostnameConflict[] = []
  for (const route of current) {
    const hostname = route.hostname.trim().toLowerCase()
    if (seen.has(hostname)) {
      conflicts.push({ hostname, kind: route.managed ? 'managed-route' : 'unmanaged-route', detail: 'The current tunnel has duplicate hostname routes.', blocking: true })
      continue
    }
    seen.add(hostname)
    if (!desiredNames.has(hostname) && !route.managed) preserved.push(route)
    if (desiredNames.has(hostname) && !route.managed) {
      conflicts.push({ hostname, kind: 'unmanaged-route', detail: 'An unmanaged route already owns this hostname.', blocking: true })
    }
  }
  const desiredSeen = new Set<string>()
  for (const route of desired) {
    const hostname = route.hostname.trim().toLowerCase()
    if (!isValidCloudflareHostname(hostname)) {
      conflicts.push({ hostname, kind: 'invalid', detail: 'The hostname is not a valid DNS name.', blocking: true })
    } else if (desiredSeen.has(hostname)) {
      conflicts.push({ hostname, kind: 'managed-route', detail: 'The preview contains the same hostname more than once.', blocking: true })
    }
    desiredSeen.add(hostname)
  }
  return { preserved, conflicts }
}

export function findDnsHostnameConflicts(
  hostname: string,
  records: CloudflareDnsRecord[],
  routes: CloudflareTunnelRoute[]
): CloudflareHostnameConflict[] {
  const wanted = hostname.trim().toLowerCase()
  const conflicts: CloudflareHostnameConflict[] = []
  for (const route of routes) {
    if (route.hostname.trim().toLowerCase() === wanted) {
      conflicts.push({ hostname: wanted, kind: route.managed ? 'managed-route' : 'unmanaged-route', detail: `A ${route.managed ? 'managed' : 'unmanaged'} tunnel route already uses this hostname.`, blocking: true })
    }
  }
  for (const record of records) {
    if (record.name.trim().toLowerCase() === wanted && record.type.toUpperCase() !== 'CNAME') {
      conflicts.push({ hostname: wanted, kind: 'dns-record', detail: `DNS record ${record.type} already uses this hostname.`, blocking: true })
    }
  }
  return conflicts
}
