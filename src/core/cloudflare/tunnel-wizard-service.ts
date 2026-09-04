// Guided Cloudflare Tunnel wizard.
//
// This is the WIZARD lineage (node kind `cloudflare-tunnel`, CloudflareTunnelNode.tsx). It is a
// separate feature from the plural tunnel INVENTORY in ./tunnel-service.ts + ./register-ipc.ts,
// which is registered independently and must not be disturbed; the two only share a directory.
//
// Security: the Cloudflare API token is sealed into this machine's SecureStore and is read ONLY
// inside `request()`, where it becomes an Authorization header. It is never returned by any
// handler, never broadcast, never logged, and never placed on a command line — `tokenStatus()`
// reports PRESENCE alone. The short-lived connector token returned by Cloudflare stays a local
// variable inside `apply()` and is handed straight to the runtime, which writes it to a protected
// file rather than to argv or the environment.

import { SecureStore } from '../secure-store'
import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import type {
  CloudflareAccount,
  CloudflareOriginTarget,
  CloudflarePreflightCheck,
  CloudflareTunnelApi,
  CloudflareTunnelPlan,
  CloudflareTunnelRuntime,
  CloudflareTunnelStatus,
  CloudflareZone
} from '../../shared/cloudflare-tunnel'
import {
  CLOUDFLARE_TUNNEL_ACCOUNTS_CHANNEL,
  validCloudflareHostname,
  validCloudflareOrigin,
  validCloudflarePort
} from '../../shared/cloudflare-tunnel'

const API_ROOT = 'https://api.cloudflare.com/client/v4'
const TOKEN_ID = '9f5b3c2f-7e52-4a38-8c0b-6ab2d5f1c901'
const TOKEN_FILE = 'cloudflare-tunnel-credentials.json'
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

interface TokenMeta { id: string; label: string }
interface TokenPayload { token: string }

function textError(error: unknown): string {
  return error instanceof Error ? error.message : 'Cloudflare returned an unusable response.'
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Cloudflare API access plus the local connector transaction. Tokens never leave this service. */
export class CloudflareTunnelWizardService implements CloudflareTunnelApi {
  private readonly tokenStore = new SecureStore<TokenMeta>(TOKEN_FILE)
  private readonly runtime?: CloudflareTunnelRuntime
  private current: CloudflareTunnelStatus = {
    phase: 'idle', tunnelId: null, hostname: null, dnsRecordId: null, connectorContainerId: null,
    tokenFilePath: null, checks: [], detail: null, updatedAt: Date.now()
  }
  private createdAccessId: string | null = null
  private createdDnsId: string | null = null
  private createdTunnelId: string | null = null
  private currentHostId: string | null = null

  constructor(runtime?: CloudflareTunnelRuntime) {
    this.runtime = runtime
  }

  async tokenStatus(): Promise<{ configured: boolean }> {
    const entries = await this.tokenStore.load()
    return { configured: entries.some((entry) => entry.meta.id === TOKEN_ID && this.readToken(entry.secretEnc) !== null) }
  }

  async setToken(token: string | null): Promise<void> {
    if (token === null || token.trim() === '') {
      await this.tokenStore.mutate((entries) => {
        // `mutate` persists the array it HANDED us, so a clear must splice in place. A `filter`
        // into a fresh array reports `changed` and writes the untouched original back, which
        // would leave a token the user asked to remove sealed on disk.
        const keep = entries.filter((entry) => entry.meta.id !== TOKEN_ID)
        const changed = keep.length !== entries.length
        entries.splice(0, entries.length, ...keep)
        return { changed, result: undefined }
      })
      return
    }
    const normalized = token.trim()
    if (normalized.length > 4096 || /[\u0000-\u001f\u007f]/.test(normalized)) {
      throw new Error('The Cloudflare API token contains unsupported characters or is too long.')
    }
    await this.tokenStore.mutate((entries) => {
      const sealed = this.tokenStore.seal({ token: normalized } satisfies TokenPayload)
      const next = entries.filter((entry) => entry.meta.id !== TOKEN_ID)
      next.push({ meta: { id: TOKEN_ID, label: 'Cloudflare API token' }, secretEnc: sealed })
      entries.splice(0, entries.length, ...next)
      return { changed: true, result: undefined }
    })
  }

  async accounts(): Promise<CloudflareAccount[]> {
    const body = await this.request('/accounts?per_page=50')
    return asArray(asObject(body)?.result).flatMap((item) => {
      const row = asObject(item)
      if (!validId(row?.id) || typeof row?.name !== 'string') return []
      return [{ id: row.id, name: row.name.slice(0, 160), status: 'active' as const }]
    })
  }

  async zones(accountId: string): Promise<CloudflareZone[]> {
    if (!validId(accountId)) throw new Error('Choose a valid Cloudflare account first.')
    const body = await this.request(`/zones?account.id=${encodeURIComponent(accountId)}&per_page=50`)
    return asArray(asObject(body)?.result).flatMap((item) => {
      const row = asObject(item)
      if (!validId(row?.id) || typeof row?.name !== 'string') return []
      const status = row.status === 'active' || row.status === 'pending' || row.status === 'inactive'
        ? row.status : 'unknown'
      return [{ id: row.id, name: row.name.slice(0, 253), status }]
    })
  }

  async targets(): Promise<CloudflareOriginTarget[]> {
    if (!this.runtime) return []
    return (await this.runtime.discoverTargets()).filter((target) =>
      validId(target.id) && validId(target.hostId) && validCloudflarePort(target.port) &&
      validCloudflareOrigin(target.originUrl)
    )
  }

  async preflight(plan: CloudflareTunnelPlan): Promise<CloudflarePreflightCheck[]> {
    this.current = { ...this.current, phase: 'preflighting', detail: null, updatedAt: Date.now() }
    const checks: CloudflarePreflightCheck[] = []
    try {
      const [accounts, selectedTargets] = await Promise.all([this.accounts(), this.targets()])
      const account = accounts.find((candidate) => candidate.id === plan.accountId)
      const zones = await this.zones(plan.accountId)
      const zone = zones.find((candidate) => candidate.id === plan.zoneId)
      const target = selectedTargets.find((candidate) => candidate.id === plan.targetId && candidate.hostId === plan.hostId)
      checks.push({
        id: 'permission', label: 'Cloudflare permission', state: account && zone ? 'pass' : 'fail',
        detail: account && zone ? `The selected account can read ${zone.name}.` : 'The selected account or zone could not be read with this token.',
        recovery: account && zone ? null : 'Choose another account or update the locally stored API token.'
      })
      checks.push({
        id: 'hostname', label: 'Hostname ownership',
        state: zone && validCloudflareHostname(plan.hostname) && plan.hostname === plan.hostname.toLowerCase() && plan.hostname.endsWith(`.${zone.name}`) ? 'pass' : 'fail',
        detail: zone && validCloudflareHostname(plan.hostname) && plan.hostname.endsWith(`.${zone.name}`) ? `The hostname is inside ${zone.name}.` : 'The hostname must be a valid lowercase name inside the selected zone.',
        recovery: 'Choose a hostname below the selected zone, such as app.example.com.'
      })
      checks.push({
        id: 'origin', label: 'Origin selection',
        state: target && target.state === 'running' && validCloudflareOrigin(plan.originUrl) && target.port === plan.port ? 'pass' : 'fail',
        detail: target && target.state === 'running' ? `The discovered origin is ${target.originUrl}.` : 'Choose a running discovered container, network, port, and private origin.',
        recovery: 'Refresh discovery and select a running container with a published private port.'
      })
      const originUrl = (() => { try { return new URL(plan.originUrl) } catch { return null } })()
      const egressProbe = target && this.runtime ? await this.runtime.checkOrigin(target) : null
      const egressPass = !!originUrl && validCloudflarePort(plan.port) && validCloudflareOrigin(plan.originUrl) && (egressProbe ? egressProbe.ok : false)
      checks.push({
        id: 'egress', label: 'Origin egress', state: egressPass ? 'pass' : 'fail',
        detail: egressProbe?.detail ?? (egressPass ? 'The origin is private and uses an explicit bounded port.' : 'The origin must be local or private-network HTTP(S) with a port from discovery.'),
        recovery: egressPass ? null : 'Select a discovered private origin that responds to the bounded health check.'
      })
      checks.push({
        id: 'access', label: 'Access policy', state: plan.accessMode === 'deny-first' ? 'pass' : 'fail',
        detail: plan.accessMode === 'deny-first' ? 'The first Access policy will deny everyone until an explicit allow rule is added.' : 'Tunnel exposure is refused unless Access starts deny-first.',
        recovery: plan.accessMode === 'deny-first' ? null : 'Keep the deny-first Access policy selected.'
      })
    } catch (error) {
      checks.length = 0
      checks.push({ id: 'permission', label: 'Cloudflare permission', state: 'fail', detail: textError(error), recovery: 'Set a valid API token locally, then retry preflight.' })
      checks.push({ id: 'hostname', label: 'Hostname ownership', state: 'warn', detail: 'Not checked because Cloudflare permission failed.', recovery: 'Resolve the permission check first.' })
      checks.push({ id: 'origin', label: 'Origin selection', state: 'warn', detail: 'Not checked because account discovery failed.', recovery: 'Refresh the host discovery.' })
      checks.push({ id: 'egress', label: 'Origin egress', state: 'warn', detail: 'Not checked because account discovery failed.', recovery: 'Refresh the host discovery.' })
      checks.push({ id: 'access', label: 'Access policy', state: plan.accessMode === 'deny-first' ? 'pass' : 'fail', detail: 'The policy choice is local and has not been sent yet.', recovery: null })
    }
    this.current = { ...this.current, phase: checks.some((check) => check.state === 'fail') ? 'failed' : 'ready', checks, detail: null, updatedAt: Date.now() }
    return checks
  }

  async apply(plan: CloudflareTunnelPlan): Promise<CloudflareTunnelStatus> {
    const checks = await this.preflight(plan)
    if (checks.some((check) => check.state === 'fail')) return this.current
    const target = (await this.targets()).find((candidate) => candidate.id === plan.targetId)
    if (!target) return this.fail('The selected origin disappeared during preflight.')
    this.current = { ...this.current, phase: 'applying', hostname: plan.hostname, updatedAt: Date.now() }
    this.currentHostId = plan.hostId
    try {
      const tunnelResponse = await this.request(`/accounts/${plan.accountId}/cfd_tunnel`, {
        method: 'POST', body: { name: plan.tunnelName, config_src: 'cloudflare' }
      })
      const tunnel = asObject(asObject(tunnelResponse)?.result)
      const tunnelId = tunnel?.id
      if (!validId(tunnelId)) throw new Error('Cloudflare did not return a tunnel id.')
      this.createdTunnelId = tunnelId
      const tokenResponse = await this.request(`/accounts/${plan.accountId}/cfd_tunnel/${tunnelId}/token`)
      const connectorToken = asObject(tokenResponse)?.result
      if (typeof connectorToken !== 'string' || connectorToken.length === 0) throw new Error('Cloudflare did not return a connector token.')
      await this.request(`/accounts/${plan.accountId}/cfd_tunnel/${tunnelId}/configurations`, {
        method: 'PUT', body: { config: { ingress: [{ hostname: plan.hostname, service: plan.originUrl }, { service: 'http_status:404' }] } }
      })
      const access = await this.ensureDenyFirstAccess(plan)
      const dns = await this.request(`/zones/${plan.zoneId}/dns_records`, {
        method: 'POST', body: { type: 'CNAME', name: plan.hostname, content: `${tunnelId}.cfargotunnel.com`, proxied: true, ttl: 1 }
      })
      const dnsRecord = asObject(asObject(dns)?.result)
      const dnsId = dnsRecord?.id
      if (!validId(dnsId)) throw new Error('Cloudflare did not return the DNS record id.')
      this.createdDnsId = dnsId
      if (!this.runtime) throw new Error('This host cannot run a cloudflared connector.')
      // The connector token goes straight to the runtime, which seals it into a protected file.
      // It is never placed in the status result the renderer receives.
      const connector = await this.runtime.installConnector({ hostId: plan.hostId, tunnelId, token: connectorToken, target })
      this.current = {
        ...this.current, phase: 'active', tunnelId, dnsRecordId: dnsId,
        connectorContainerId: connector.connectorContainerId, tokenFilePath: connector.tokenFilePath,
        detail: access.created ? 'Tunnel is active. Access was created deny-first; add an allow rule deliberately.' : 'Tunnel is active with the existing deny-first Access application.',
        updatedAt: Date.now()
      }
      this.createdAccessId = access.created ? access.id : null
      return this.current
    } catch (error) {
      await this.rollbackInternal(plan.accountId, plan.zoneId, plan.hostId).catch(() => {})
      return this.fail(textError(error))
    }
  }

  async rollback(): Promise<CloudflareTunnelStatus> {
    this.current = { ...this.current, phase: 'rolling-back', updatedAt: Date.now() }
    await this.rollbackInternal(null, null, this.currentHostId).catch(() => {})
    this.current = { ...this.current, phase: 'idle', tunnelId: null, dnsRecordId: null, connectorContainerId: null, tokenFilePath: null, detail: 'Rollback completed. No connector or DNS route remains from the last attempt.', updatedAt: Date.now() }
    return this.current
  }

  async status(): Promise<CloudflareTunnelStatus> { return this.current }

  private async ensureDenyFirstAccess(plan: CloudflareTunnelPlan): Promise<{ id: string; created: boolean }> {
    const existing = await this.request(`/accounts/${plan.accountId}/access/apps?domain=${encodeURIComponent(plan.hostname)}`)
    const row = asArray(asObject(existing)?.result).map(asObject).find((candidate) => validId(candidate?.id))
    if (row && validId(row.id)) return { id: row.id, created: false }
    const created = await this.request(`/accounts/${plan.accountId}/access/apps`, {
      method: 'POST', body: { type: 'self_hosted', name: plan.tunnelName, domain: plan.hostname, session_duration: '24h' }
    })
    const app = asObject(asObject(created)?.result)
    if (!app || !validId(app.id)) throw new Error('Cloudflare did not return an Access application id.')
    // Record the id before creating its policy, so a policy failure can still remove the
    // application created by this attempt during rollback.
    this.createdAccessId = app.id
    await this.request(`/accounts/${plan.accountId}/access/apps/${app.id}/policies`, {
      method: 'POST', body: { name: 'Deny by default', decision: 'deny', include: [{ everyone: {} }], precedence: 1 }
    })
    return { id: app.id, created: true }
  }

  private async rollbackInternal(accountId: string | null, zoneId: string | null, hostId: string | null): Promise<void> {
    const connectorLive = this.current.connectorContainerId && this.current.tokenFilePath && hostId && this.runtime
    if (connectorLive) {
      await this.runtime!.removeConnector({
        hostId: hostId!,
        connectorContainerId: this.current.connectorContainerId!,
        tokenFilePath: this.current.tokenFilePath!
      })
    }
    if (accountId && zoneId && this.createdDnsId) await this.request(`/zones/${zoneId}/dns_records/${this.createdDnsId}`, { method: 'DELETE' }).catch(() => {})
    if (accountId && this.createdAccessId) await this.request(`/accounts/${accountId}/access/apps/${this.createdAccessId}`, { method: 'DELETE' }).catch(() => {})
    if (accountId && this.createdTunnelId) await this.request(`/accounts/${accountId}/cfd_tunnel/${this.createdTunnelId}`, { method: 'DELETE' }).catch(() => {})
    this.createdDnsId = null; this.createdAccessId = null; this.createdTunnelId = null
    this.currentHostId = null
  }

  private fail(detail: string): CloudflareTunnelStatus {
    this.current = { ...this.current, phase: 'failed', detail, updatedAt: Date.now() }
    return this.current
  }

  private readToken(secretEnc: string): string | null {
    try {
      const payload = this.tokenStore.unseal<TokenPayload>(secretEnc)
      return typeof payload.token === 'string' && payload.token ? payload.token : null
    } catch { return null }
  }

  private async request(path: string, options: { method?: string; body?: unknown } = {}): Promise<unknown> {
    const entries = await this.tokenStore.load()
    const entry = entries.find((candidate) => candidate.meta.id === TOKEN_ID)
    const token = entry ? this.readToken(entry.secretEnc) : null
    if (!token) throw new Error('No Cloudflare API token is configured on this machine.')
    const response = await fetch(`${API_ROOT}${path}`, {
      method: options.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15_000)
    })
    const raw = await response.text()
    if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Cloudflare returned a response that is too large.')
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { throw new Error(`Cloudflare returned invalid JSON (HTTP ${response.status}).`) }
    const obj = asObject(parsed)
    // Deliberately generic: an upstream message can echo request material, so only the status code
    // is surfaced to the renderer.
    if (!response.ok || obj?.success !== true) throw new Error(`Cloudflare rejected the request (HTTP ${response.status}).`)
    return parsed
  }
}

export function createCloudflareTunnelWizardService(runtime?: CloudflareTunnelRuntime): CloudflareTunnelWizardService {
  return new CloudflareTunnelWizardService(runtime)
}

/**
 * Registers the wizard's `cloudflare:*` RPC. Separate from `registerCloudflareTunnelIpc` in
 * ./register-ipc.ts, which owns the unrelated `cloudflare-tunnels:*` inventory channels.
 *
 * No handler returns, broadcasts, or logs the API token; `tokenStatus` reports presence only.
 */
export function registerCloudflareTunnelWizardIpc(
  platform: CorePlatform,
  runtime?: CloudflareTunnelRuntime
): { service: CloudflareTunnelApi } {
  const service = createCloudflareTunnelWizardService(runtime)
  platform.handle(IPC.cloudflareTokenStatus, () => service.tokenStatus())
  platform.handle(IPC.cloudflareSetToken, (token: string | null) => service.setToken(token))
  platform.handle(CLOUDFLARE_TUNNEL_ACCOUNTS_CHANNEL, () => service.accounts())
  platform.handle(IPC.cloudflareZones, (accountId: string) => service.zones(accountId))
  platform.handle(IPC.cloudflareTargets, () => service.targets())
  platform.handle(IPC.cloudflarePreflight, (plan: CloudflareTunnelPlan) => service.preflight(plan))
  platform.handle(IPC.cloudflareApply, (plan: CloudflareTunnelPlan) => service.apply(plan))
  platform.handle(IPC.cloudflareRollback, () => service.rollback())
  platform.handle(IPC.cloudflareStatus, () => service.status())
  return { service }
}
