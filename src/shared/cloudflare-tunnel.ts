// Guided Cloudflare Tunnel management.  The renderer only receives typed metadata and status;
// access tokens and tunnel tokens stay inside the trusted core and the host runtime.

export type CloudflareCheckState = 'pass' | 'warn' | 'fail'

export interface CloudflarePreflightCheck {
  id: 'permission' | 'hostname' | 'origin' | 'egress' | 'access'
  label: string
  state: CloudflareCheckState
  detail: string
  recovery: string | null
}

export interface CloudflareAccount {
  id: string
  name: string
  status: 'active' | 'unavailable'
}

export interface CloudflareZone {
  id: string
  name: string
  status: 'active' | 'pending' | 'inactive' | 'unknown'
}

export interface CloudflareOriginTarget {
  id: string
  hostId: string
  hostLabel: string
  containerId: string | null
  containerName: string | null
  networkId: string | null
  networkName: string | null
  port: number
  originUrl: string
  state: 'running' | 'stopped' | 'unknown'
}

export interface CloudflareTunnelPlan {
  accountId: string
  zoneId: string
  hostname: string
  hostId: string
  targetId: string
  port: number
  originUrl: string
  tunnelName: string
  /** The first Access policy is always deny for every user.  Allow rules are a later action. */
  accessMode: 'deny-first'
}

/** Safe project-owned intent. Provider ids, machine targets, and connector state stay local. */
export interface CloudflareTunnelSpec {
  hostname: string
  tunnelName: string
  accessMode: 'deny-first'
}

/** Machine-local binding restored from the workspace index, never written to project.json. */
export interface CloudflareTunnelLocalBinding {
  accountId: string
  zoneId: string
  hostId: string
  targetId: string
  port: number
  originUrl: string
  tunnelId?: string
  dnsRecordId?: string
  connectorContainerId?: string
  tokenFilePath?: string
}

export type CloudflareTunnelPhase =
  | 'idle'
  | 'preflighting'
  | 'ready'
  | 'applying'
  | 'active'
  | 'rolling-back'
  | 'failed'

export interface CloudflareTunnelStatus {
  phase: CloudflareTunnelPhase
  tunnelId: string | null
  hostname: string | null
  dnsRecordId: string | null
  connectorContainerId: string | null
  tokenFilePath: string | null
  checks: CloudflarePreflightCheck[]
  detail: string | null
  updatedAt: number
}

export interface CloudflareTunnelRuntime {
  discoverTargets(): Promise<CloudflareOriginTarget[]>
  /** Writes a secret to a protected file and starts the pinned connector without argv/env tokens. */
  installConnector(input: {
    hostId: string
    tunnelId: string
    token: string
    target: CloudflareOriginTarget
  }): Promise<{ connectorContainerId: string; tokenFilePath: string }>
  removeConnector(input: { hostId: string; connectorContainerId: string; tokenFilePath: string }): Promise<void>
  checkOrigin(target: CloudflareOriginTarget): Promise<{ ok: boolean; detail: string }>
}

export interface CloudflareTunnelApi {
  tokenStatus(): Promise<{ configured: boolean }>
  setToken(token: string | null): Promise<void>
  accounts(): Promise<CloudflareAccount[]>
  zones(accountId: string): Promise<CloudflareZone[]>
  targets(): Promise<CloudflareOriginTarget[]>
  preflight(plan: CloudflareTunnelPlan): Promise<CloudflarePreflightCheck[]>
  apply(plan: CloudflareTunnelPlan): Promise<CloudflareTunnelStatus>
  rollback(): Promise<CloudflareTunnelStatus>
  status(): Promise<CloudflareTunnelStatus>
}

export function validCloudflareHostname(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 3 || value.length > 253) return false
  if (value !== value.trim() || value.includes('..') || value.endsWith('.')) return false
  const labels = value.split('.')
  return labels.length >= 2 && labels.every((label) =>
    label.length > 0 && label.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  )
}

export function validCloudflareOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' && url.password === '' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1' ||
        /^10\./.test(url.hostname) || /^192\.168\./.test(url.hostname) ||
        /^172\.(?:1[6-9]|2\d|3[01])\./.test(url.hostname))
  } catch {
    return false
  }
}

export function validCloudflarePort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
}

/**
 * Channel for the tunnel wizard's account list.
 *
 * This one channel is NOT in `IPC`: the natural key there, `cloudflareAccounts`, is already bound
 * to the Zero Trust manager ('cloudflare-zero-trust:accounts') and re-pointing it would
 * cross-bind two handlers. The remaining eight wizard channels are the original `IPC.cloudflare*`
 * keys. The value 'cloudflare:accounts' is unused elsewhere.
 */
export const CLOUDFLARE_TUNNEL_ACCOUNTS_CHANNEL = 'cloudflare:accounts'
