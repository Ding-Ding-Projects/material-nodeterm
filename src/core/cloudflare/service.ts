import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type {
  CloudflareAccount, CloudflareConfigurationPreview, CloudflareDnsAdoptionPreview,
  CloudflareDnsRecord, CloudflareErrorInfo, CloudflareMachineBinding, CloudflareMutationResult,
  CloudflareRouteInput, CloudflareTunnel, CloudflareTunnelBinding, CloudflareTunnelConnection, CloudflareTunnelInventory,
  CloudflareTunnelRoute, CloudflareZone
} from '../../shared/cloudflare'
import {
  findDnsHostnameConflicts, isValidCloudflareHostname, isValidCloudflareId,
  isValidCloudflareService, preserveUnmanagedRoutes
} from '../../shared/cloudflare'
import { CloudflareApiError, CloudflareClient } from './client'
import { CloudflareCredentialStore } from './credential-store'
import { writeFileAtomic } from '../fs-atomic'

const STATE_FILE = 'cloudflare-tunnel-state.json'
type StoredState = { version: 1; revision: number; binding: CloudflareMachineBinding | null }
const EMPTY_STATE: StoredState = { version: 1, revision: 0, binding: null }

type TunnelConfiguration = { config?: { ingress?: Array<{ hostname?: string; service?: string; path?: string; originRequest?: Record<string, unknown> }> } }

function machineId(userDataDir: string): string {
  return createHash('sha256').update(`${process.platform}:${userDataDir}`).digest('hex').slice(0, 32)
}

function errorInfo(error: unknown): CloudflareErrorInfo {
  if (error instanceof CloudflareApiError) return {
    operation: error.operation, status: error.status, code: error.code, message: error.message,
    retryAfterSeconds: error.retryAfterSeconds, retryable: error.status === 429 || error.status === null
  }
  return { operation: 'accounts', status: null, code: 'local-error', message: error instanceof Error ? error.message : String(error), retryAfterSeconds: null, retryable: false }
}

export interface CloudflareServiceDeps {
  userDataDir: string
  sealSecret?: (value: Buffer) => Buffer
  unsealSecret?: (value: Buffer) => Buffer
}

/** Cloudflare control plane only. It never starts cloudflared or stores connector state. */
export class CloudflareTunnelService {
  private readonly credentials: CloudflareCredentialStore
  private previews = new Map<string, CloudflareConfigurationPreview | CloudflareDnsAdoptionPreview>()
  private writeChain: Promise<void> = Promise.resolve()
  private readonly machine: string

  constructor(private readonly deps: CloudflareServiceDeps) {
    this.machine = machineId(deps.userDataDir)
    const codec = deps.sealSecret && deps.unsealSecret
      ? { seal: (value: string) => deps.sealSecret!(Buffer.from(value, 'utf8')), unseal: (value: Buffer) => deps.unsealSecret!(value).toString('utf8') }
      : undefined
    this.credentials = new CloudflareCredentialStore(deps.userDataDir, codec)
  }

  async saveToken(token: string): Promise<CloudflareTunnelInventory> { await this.credentials.save(token); return this.inventory() }
  async clearToken(): Promise<CloudflareTunnelInventory> { await this.credentials.clear(); return this.inventory() }
  async status(): Promise<CloudflareTunnelInventory> { return this.inventory() }
  async bind(input: CloudflareTunnelBinding): Promise<CloudflareTunnelInventory> {
    if (!isValidCloudflareId(input.accountId) || !isValidCloudflareId(input.tunnelId) || (input.zoneId !== null && !isValidCloudflareId(input.zoneId))) throw new Error('Account, zone, and tunnel identifiers must be valid Cloudflare ids.')
    if (input.hostname !== null && !isValidCloudflareHostname(input.hostname)) throw new Error('The bound hostname is not valid.')
    await this.writeState({ version: 1, revision: (await this.state()).revision + 1, binding: { ...input, machineId: this.machine, updatedAt: Date.now() } })
    return this.inventory()
  }
  async unbind(): Promise<CloudflareTunnelInventory> { const state = await this.state(); await this.writeState({ version: 1, revision: state.revision + 1, binding: null }); return this.inventory() }
  async refresh(): Promise<CloudflareTunnelInventory> { return this.inventory() }

  async previewConfiguration(input: { accountId: string; tunnelId: string; routes: CloudflareRouteInput[] }): Promise<CloudflareConfigurationPreview> {
    if (!isValidCloudflareId(input.accountId) || !isValidCloudflareId(input.tunnelId) || !Array.isArray(input.routes) || input.routes.length > 100) throw new Error('Choose a real account and tunnel, then provide at most 100 routes.')
    for (const route of input.routes) if (!isValidCloudflareHostname(route.hostname) || !isValidCloudflareService(route.service)) throw new Error('Every route needs a valid hostname and an http or https service URL.')
    const client = await this.client()
    const current = await this.configuration(client, input.accountId, input.tunnelId)
    const preservation = preserveUnmanagedRoutes(current, input.routes)
    const allConflicts = [...preservation.conflicts]
    const preview: CloudflareConfigurationPreview = {
      previewId: randomUUID(), accountId: input.accountId, tunnelId: input.tunnelId, desiredRoutes: input.routes,
      preservedRoutes: preservation.preserved, conflicts: allConflicts, allowed: !allConflicts.some((c) => c.blocking),
      summary: [
        `Apply ${input.routes.length} managed route${input.routes.length === 1 ? '' : 's'} to tunnel ${input.tunnelId}.`,
        `Preserve ${preservation.preserved.length} unmanaged route${preservation.preserved.length === 1 ? '' : 's'} unchanged.`,
        allConflicts.length ? `${allConflicts.length} hostname conflict${allConflicts.length === 1 ? '' : 's'} block the mutation.` : 'No hostname conflicts were found.'
      ], generatedAt: Date.now()
    }
    this.previews.set(preview.previewId, preview)
    return preview
  }

  async applyConfiguration(previewId: string): Promise<CloudflareMutationResult> {
    const preview = this.previews.get(previewId)
    if (!preview || !('desiredRoutes' in preview)) return { ok: false, revision: (await this.state()).revision, previewId, message: 'Configuration preview expired. Refresh and preview again.' }
    const state = await this.state()
    if (!preview.allowed) return { ok: false, revision: state.revision, previewId, message: 'Configuration preview contains a hostname conflict.' }
    try {
      const client = await this.client()
      const ingress = [
        ...preview.desiredRoutes.map((route) => ({ hostname: route.hostname, service: route.service, ...(route.path ? { path: route.path } : {}), ...(route.originRequest ? { originRequest: route.originRequest } : {}) })),
        ...preview.preservedRoutes.map((route) => ({ ...(route.hostname !== '*' ? { hostname: route.hostname } : {}), service: route.service, ...(route.path ? { path: route.path } : {}), ...(route.originRequest ? { originRequest: route.originRequest } : {}) }))
      ]
      await client.request('configuration', `/accounts/${preview.accountId}/cfd_tunnel/${preview.tunnelId}/configurations`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: { ingress } }) })
      this.previews.delete(previewId)
      const next = { version: 1 as const, revision: state.revision + 1, binding: state.binding }
      await this.writeState(next)
      return { ok: true, revision: next.revision, previewId, message: 'Tunnel configuration applied with unmanaged routes preserved.' }
    } catch (error) { return { ok: false, revision: state.revision, previewId, message: 'Cloudflare rejected the tunnel configuration.', error: errorInfo(error) } }
  }

  async previewDnsAdoption(input: { accountId: string; zoneId: string; tunnelId: string; hostname: string }): Promise<CloudflareDnsAdoptionPreview> {
    if (!isValidCloudflareId(input.accountId) || !isValidCloudflareId(input.zoneId) || !isValidCloudflareId(input.tunnelId) || !isValidCloudflareHostname(input.hostname)) throw new Error('Choose a real account, zone, tunnel, and hostname.')
    const client = await this.client()
    const [zone, records, routes] = await Promise.all([
      client.request<CloudflareZone>('zones', `/zones/${input.zoneId}`),
      client.request<CloudflareDnsRecord[]>('dns-records', `/zones/${input.zoneId}/dns_records?per_page=100`),
      this.allRoutes(client, input.accountId, input.tunnelId)
    ])
    const tunnelTarget = `${input.tunnelId.toLowerCase()}.cfargotunnel.com`
    const record = records.find((candidate) => candidate.name.toLowerCase() === input.hostname.toLowerCase() && candidate.type.toUpperCase() === 'CNAME' && candidate.content.toLowerCase().replace(/\.$/, '') === tunnelTarget) ?? null
    const conflicts = findDnsHostnameConflicts(input.hostname, records, routes)
    const proof = record && (zone.accountId === null || zone.accountId === input.accountId) ? { zoneId: zone.id, zoneName: zone.name, recordId: record.id, recordName: record.name, recordType: record.type, recordContent: record.content, accountId: input.accountId, observedAt: Date.now() } : null
    const preview: CloudflareDnsAdoptionPreview = {
      previewId: randomUUID(), hostname: input.hostname, tunnelId: input.tunnelId, zoneId: input.zoneId, ownershipProof: proof,
      conflicts, allowed: !!proof && !conflicts.some((c) => c.blocking), summary: [
        proof ? `Proved zone ${zone.name} owns DNS record ${record!.name}.` : 'No existing CNAME ownership proof was found in the selected zone.',
        conflicts.length ? `${conflicts.length} hostname conflict${conflicts.length === 1 ? '' : 's'} block adoption.` : 'No tunnel conflict was found.'
      ], generatedAt: Date.now()
    }
    this.previews.set(preview.previewId, preview)
    return preview
  }

  async adoptDnsRecord(previewId: string): Promise<CloudflareMutationResult> {
    const preview = this.previews.get(previewId)
    const state = await this.state()
    if (!preview || !('ownershipProof' in preview)) return { ok: false, revision: state.revision, previewId, message: 'DNS adoption preview expired. Refresh and preview again.' }
    if (!preview.allowed || !preview.ownershipProof) return { ok: false, revision: state.revision, previewId, message: 'DNS adoption requires an ownership proof and no hostname conflicts.' }
    // Adoption is intentionally a recorded local binding, not a blind DNS rewrite. The existing
    // CNAME is retained exactly after the user reviews the proof, so an unmanaged record is never
    // deleted or replaced by this lane.
    await this.writeState({ version: 1, revision: state.revision + 1, binding: { accountId: preview.ownershipProof.accountId, zoneId: preview.zoneId, tunnelId: preview.tunnelId, hostname: preview.hostname, machineId: this.machine, updatedAt: Date.now() } })
    this.previews.delete(previewId)
    return { ok: true, revision: state.revision + 1, previewId, message: 'Existing DNS record adopted after zone ownership proof. No DNS record was replaced.' }
  }

  async inventory(): Promise<CloudflareTunnelInventory> {
    const binding = (await this.state()).binding
    const tokenPresent = await this.credentials.hasToken()
    const empty = { checkedAt: Date.now(), availability: tokenPresent ? 'unreachable' as const : 'not-configured' as const, tokenPresent, accounts: [], zones: [], tunnels: [], connections: [], routes: [], dnsRecords: [], errors: [], binding, connectorRuntime: 'not-included' as const }
    if (!tokenPresent) return empty
    try {
      const client = await this.client()
      const errors: CloudflareErrorInfo[] = []
      const accounts = await this.listAccounts(client, errors)
      const zones = await this.listZones(client, errors)
      const accountId = binding?.accountId ?? accounts[0]?.id
      const tunnels = accountId ? await this.listTunnels(client, accountId, errors) : []
      const tunnelId = binding?.tunnelId ?? tunnels[0]?.id
      const connections = accountId && tunnelId ? await this.listConnections(client, accountId, tunnelId, errors) : []
      const routes = accountId && tunnelId ? await this.allRoutes(client, accountId, tunnelId, errors) : []
      const dnsRecords = binding?.zoneId ? await this.listDns(client, binding.zoneId, errors) : []
      return { ...empty, availability: errors.some((e) => e.code === 'rate-limited') ? 'rate-limited' : errors.some((e) => e.code === 'forbidden') ? 'partial-permissions' : errors.length ? 'unreachable' : 'ready', accounts, zones, tunnels, connections, routes, dnsRecords, errors }
    } catch (error) {
      return { ...empty, availability: error instanceof CloudflareApiError && error.code === 'unauthorized' ? 'unauthorized' : 'unreachable', errors: [errorInfo(error)] }
    }
  }

  private async client(): Promise<CloudflareClient> { const token = await this.credentials.readForRequest(); if (!token) throw new Error('Cloudflare API token is not configured.'); return new CloudflareClient(token) }
  private async state(): Promise<StoredState> { try { const parsed = JSON.parse(await fs.readFile(join(this.deps.userDataDir, STATE_FILE), 'utf8')) as StoredState; if (parsed.version === 1 && Number.isSafeInteger(parsed.revision) && (parsed.binding === null || typeof parsed.binding === 'object')) return parsed } catch {} return EMPTY_STATE }
  private async writeState(next: StoredState): Promise<void> { this.writeChain = this.writeChain.then(async () => { await fs.mkdir(this.deps.userDataDir, { recursive: true }); const file = join(this.deps.userDataDir, STATE_FILE); await writeFileAtomic(file, JSON.stringify(next), { mode: 0o600 }); await fs.chmod(file, 0o600) }); await this.writeChain }
  private async configuration(client: CloudflareClient, accountId: string, tunnelId: string): Promise<CloudflareTunnelRoute[]> { const response = await client.request<TunnelConfiguration>('configuration', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`); return (response.config?.ingress ?? []).filter((route) => typeof route.service === 'string').map((route) => ({ hostname: route.hostname ?? '*', service: route.service!, path: route.path ?? null, originRequest: route.originRequest ?? null, managed: false })) }
  private async allRoutes(client: CloudflareClient, accountId: string, tunnelId: string, errors: CloudflareErrorInfo[] = []): Promise<CloudflareTunnelRoute[]> { try { return await this.configuration(client, accountId, tunnelId) } catch (error) { errors.push(errorInfo(error)); return [] } }
  private async listAccounts(client: CloudflareClient, errors: CloudflareErrorInfo[]): Promise<CloudflareAccount[]> { try { const r = await client.request<any[]>('accounts', '/accounts?per_page=100'); return r.map((x) => ({ id: String(x.id), name: String(x.name ?? x.id), status: x.status ?? null })) } catch (error) { errors.push(errorInfo(error)); return [] } }
  private async listZones(client: CloudflareClient, errors: CloudflareErrorInfo[]): Promise<CloudflareZone[]> { try { const r = await client.request<any[]>('zones', '/zones?per_page=100'); return r.map((x) => ({ id: String(x.id), name: String(x.name), status: x.status ?? null, accountId: x.account?.id ?? null })) } catch (error) { errors.push(errorInfo(error)); return [] } }
  private async listTunnels(client: CloudflareClient, accountId: string, errors: CloudflareErrorInfo[]): Promise<CloudflareTunnel[]> { try { const r = await client.request<any[]>('tunnels', `/accounts/${accountId}/cfd_tunnel?per_page=100`); return r.map((x) => ({ id: String(x.id), name: String(x.name ?? x.id), createdAt: x.created_at ?? null, status: x.status ?? null, deletedAt: x.deleted_at ?? null })) } catch (error) { errors.push(errorInfo(error)); return [] } }
  private async listConnections(client: CloudflareClient, accountId: string, tunnelId: string, errors: CloudflareErrorInfo[]): Promise<CloudflareTunnelConnection[]> { try { const r = await client.request<any[]>('connections', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/connections`); return r.map((x) => ({ id: String(x.id ?? x.client_id), coloName: x.colo_name ?? null, clientId: x.client_id ?? null, connectedAt: x.connected_at ?? null, isHealthy: x.is_pending === undefined ? null : !x.is_pending })) } catch (error) { errors.push(errorInfo(error)); return [] } }
  private async listDns(client: CloudflareClient, zoneId: string, errors: CloudflareErrorInfo[]): Promise<CloudflareDnsRecord[]> { try { const r = await client.request<any[]>('dns-records', `/zones/${zoneId}/dns_records?per_page=100`); return r.map((x) => ({ id: String(x.id), type: String(x.type), name: String(x.name), content: String(x.content), proxied: x.proxied ?? null, ttl: x.ttl ?? null })) } catch (error) { errors.push(errorInfo(error)); return [] } }
}
