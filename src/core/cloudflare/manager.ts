import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { renameAtomic, tempNameFor } from '../fs-atomic'
import type { CorePlatform } from '../platform'
import type {
  CloudflareAnalytics,
  CloudflareApi,
  CloudflareCachePurgePreview,
  CloudflareDnsRecord,
  CloudflareDnsRecordInput,
  CloudflareMutationPreview,
  CloudflarePage,
  CloudflareRedirectRule,
  CloudflareRedirectRuleInput,
  CloudflareRuleset,
  CloudflareRulesetInput,
  CloudflareSslTlsSetting,
  CloudflareSslTlsUpdateInput,
  CloudflareStatus,
  CloudflareTokenStatus,
  CloudflareTokenPermissions,
  CloudflareZone,
  CloudflareAccount
} from '../../shared/cloudflare'
import { CloudflareClient } from './client'
import { CloudflareTokenVault } from './token-vault'

type PartialSnapshot = {
  version: 1
  savedAt: number
  accounts?: CloudflareAccount[]
  zones?: CloudflarePage<CloudflareZone>
  dns?: Record<string, CloudflarePage<CloudflareDnsRecord>>
  sslTls?: Record<string, CloudflareSslTlsSetting[]>
  rulesets?: Record<string, CloudflarePage<CloudflareRuleset>>
  redirects?: Record<string, CloudflarePage<CloudflareRedirectRule>>
  analytics?: Record<string, CloudflareAnalytics>
}

function id(value: string, name: string): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(`${name} is invalid`); return value }
function preview(operation: string, resource: string, affectedIds: string[]): CloudflareMutationPreview { return { operation, resource, affectedIds, destructive: true, summary: `${operation} will permanently change ${resource}. Review the affected item before confirming.` } }

/** Account and zone manager backed only by Cloudflare's documented v4 REST resources. It keeps a
 * best-effort, non-secret partial snapshot so offline users can inspect the last successful tab.
 * A failed refresh never replaces a previously fetched category with an empty list. */
export class CloudflareManager implements CloudflareApi {
  readonly vault: CloudflareTokenVault
  readonly client: CloudflareClient
  private readonly snapshotFile: string
  private snapshot: PartialSnapshot = { version: 1, savedAt: 0 }

  constructor(private readonly platform: CorePlatform) {
    this.vault = new CloudflareTokenVault(platform)
    this.client = new CloudflareClient(() => this.vault.readSecret())
    this.snapshotFile = join(platform.userDataDir, 'cloudflare', 'snapshot.json')
  }

  async tokenStatus(): Promise<CloudflareTokenStatus> { return this.vault.status() }
  async saveToken(token: string): Promise<CloudflareTokenStatus> { return this.vault.save(token) }
  async clearToken(): Promise<CloudflareTokenStatus> { return this.vault.clear() }

  async status(): Promise<CloudflareStatus> {
    const configured = (await this.vault.status()).present
    if (!configured) return { configured: false, authenticated: false, accountCount: null, checkedAt: Date.now(), error: null }
    try {
      const accountPage = await this.client.accounts(); await this.savePart({ accounts: accountPage.items })
      return { configured: true, authenticated: true, accountCount: accountPage.totalItems, checkedAt: Date.now(), error: null }
    } catch (error) {
      const info = (error as { info?: CloudflareStatus['error'] }).info ?? { code: 'unreachable' as const, message: 'Cloudflare could not be reached.', retryAfterSeconds: null, requestId: null }
      return { configured: true, authenticated: info.code !== 'unauthorized' && info.code !== 'forbidden', accountCount: this.snapshot.accounts?.length ?? null, checkedAt: Date.now(), error: info }
    }
  }
  async permissions(): Promise<CloudflareTokenPermissions> {
    try {
      const result = await this.client.verifyToken()
      return { valid: result.status === 'active', status: result.status, checkedAt: Date.now(), capabilities: result.status === 'active' ? ['token.verify'] : [] }
    } catch { return { valid: false, status: null, checkedAt: Date.now(), capabilities: [] } }
  }

  async accounts(page = 1): Promise<CloudflarePage<CloudflareAccount>> { const result = await this.client.accounts(page); await this.savePart({ accounts: result.items }); return result }
  async zones(page = 1): Promise<CloudflarePage<CloudflareZone>> { const result = await this.client.zones(page); await this.savePart({ zones: result }); return result }
  async dnsRecords(zoneId: string, page = 1, search?: string): Promise<CloudflarePage<CloudflareDnsRecord>> { const z = id(zoneId, 'Zone id'); const result = await this.client.dnsRecords(z, page, search); await this.savePart({ dns: { ...(this.snapshot.dns ?? {}), [z]: result } }); return result }
  async sslTlsSettings(zoneId: string): Promise<CloudflareSslTlsSetting[]> { const z = id(zoneId, 'Zone id'); const result = await this.client.sslTlsSettings(z); await this.savePart({ sslTls: { ...(this.snapshot.sslTls ?? {}), [z]: result } }); return result }
  async rulesets(zoneId: string, page = 1): Promise<CloudflarePage<CloudflareRuleset>> { const z = id(zoneId, 'Zone id'); const result = await this.client.rulesets(z, page); await this.savePart({ rulesets: { ...(this.snapshot.rulesets ?? {}), [z]: result } }); return result }
  async redirectRules(zoneId: string, page = 1): Promise<CloudflarePage<CloudflareRedirectRule>> { const z = id(zoneId, 'Zone id'); const result = await this.client.redirectRules(z, page); await this.savePart({ redirects: { ...(this.snapshot.redirects ?? {}), [z]: result } }); return result }
  async analytics(zoneId: string, since: string, until: string): Promise<CloudflareAnalytics> { const z = id(zoneId, 'Zone id'); const result = await this.client.analytics(z, since, until); await this.savePart({ analytics: { ...(this.snapshot.analytics ?? {}), [z]: result } }); return result }

  async createDnsRecord(zoneId: string, input: CloudflareDnsRecordInput): Promise<CloudflareDnsRecord> { return this.client.createDnsRecord(id(zoneId, 'Zone id'), input) }
  async updateDnsRecord(zoneId: string, recordId: string, input: CloudflareDnsRecordInput): Promise<CloudflareDnsRecord> { return this.client.updateDnsRecord(id(zoneId, 'Zone id'), id(recordId, 'Record id'), input) }
  async previewDeleteDnsRecord(zoneId: string, recordId: string): Promise<CloudflareMutationPreview> { const z = id(zoneId, 'Zone id'); const r = id(recordId, 'Record id'); const page = await this.client.dnsRecords(z, 1); if (!page.items.some((x) => x.id === r)) throw new Error('DNS record was not found in the current discovery result.'); return preview('Delete DNS record', `DNS record ${r}`, [r]) }
  async deleteDnsRecord(zoneId: string, recordId: string, p: CloudflareMutationPreview): Promise<void> { this.confirmPreview(p, 'Delete DNS record', recordId); await this.client.deleteDnsRecord(id(zoneId, 'Zone id'), id(recordId, 'Record id')) }
  async updateSslTlsSetting(zoneId: string, input: CloudflareSslTlsUpdateInput): Promise<CloudflareSslTlsSetting> { return this.client.updateSslTlsSetting(id(zoneId, 'Zone id'), input) }
  async createRuleset(zoneId: string, input: CloudflareRulesetInput): Promise<CloudflareRuleset> { return this.client.createRuleset(id(zoneId, 'Zone id'), input) }
  async updateRuleset(zoneId: string, rulesetId: string, input: CloudflareRulesetInput): Promise<CloudflareRuleset> { return this.client.updateRuleset(id(zoneId, 'Zone id'), id(rulesetId, 'Ruleset id'), input) }
  async previewDeleteRuleset(zoneId: string, rulesetId: string): Promise<CloudflareMutationPreview> { const z = id(zoneId, 'Zone id'); const r = id(rulesetId, 'Ruleset id'); const page = await this.client.rulesets(z, 1); if (!page.items.some((x) => x.id === r)) throw new Error('Ruleset was not found in the current discovery result.'); return preview('Delete ruleset', `ruleset ${r}`, [r]) }
  async deleteRuleset(zoneId: string, rulesetId: string, p: CloudflareMutationPreview): Promise<void> { this.confirmPreview(p, 'Delete ruleset', rulesetId); await this.client.deleteRuleset(id(zoneId, 'Zone id'), id(rulesetId, 'Ruleset id')) }
  async createRedirectRule(zoneId: string, input: CloudflareRedirectRuleInput): Promise<CloudflareRedirectRule> { return this.client.createRedirectRule(id(zoneId, 'Zone id'), input) }
  async updateRedirectRule(zoneId: string, ruleId: string, input: CloudflareRedirectRuleInput): Promise<CloudflareRedirectRule> { return this.client.updateRedirectRule(id(zoneId, 'Zone id'), id(ruleId, 'Redirect rule id'), input) }
  async previewDeleteRedirectRule(zoneId: string, ruleId: string): Promise<CloudflareMutationPreview> { const z = id(zoneId, 'Zone id'); const r = id(ruleId, 'Redirect rule id'); const page = await this.client.redirectRules(z, 1); if (!page.items.some((x) => x.id === r)) throw new Error('Redirect rule was not found in the current discovery result.'); return preview('Delete redirect rule', `redirect rule ${r}`, [r]) }
  async deleteRedirectRule(zoneId: string, ruleId: string, p: CloudflareMutationPreview): Promise<void> { this.confirmPreview(p, 'Delete redirect rule', ruleId); await this.client.deleteRedirectRule(id(zoneId, 'Zone id'), id(ruleId, 'Redirect rule id')) }
  async previewPurgeCache(input: { zoneId: string; scope: 'everything' | 'urls'; urls?: string[] }): Promise<CloudflareCachePurgePreview> { const z = id(input.zoneId, 'Zone id'); if (input.scope !== 'everything' && input.scope !== 'urls') throw new Error('Cache purge scope is invalid.'); const urls = (input.urls ?? []).slice(0, 100).map((value) => { try { const parsed = new URL(value); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); return parsed.href } catch { throw new Error('Cache purge URLs must be valid HTTP(S) URLs without credentials.') } }); if (input.scope === 'urls' && urls.length === 0) throw new Error('Choose at least one URL before previewing cache purge.'); return { zoneId: z, scope: input.scope, urls, destructive: true, summary: input.scope === 'everything' ? `Purge every cached object in zone ${z}.` : `Purge ${urls.length} selected cached URL${urls.length === 1 ? '' : 's'} in zone ${z}.` } }
  async purgeCache(p: CloudflareCachePurgePreview): Promise<void> { if (!p || p.destructive !== true) throw new Error('A fresh cache purge preview is required.'); await this.client.purgeCache(id(p.zoneId, 'Zone id'), p.scope, p.urls) }

  private confirmPreview(p: CloudflareMutationPreview, op: string, resourceId: string): void { if (!p || p.destructive !== true || p.operation !== op || !p.affectedIds.includes(resourceId)) throw new Error('A fresh destructive preview is required before this mutation.') }
  private async savePart(part: Partial<PartialSnapshot>): Promise<void> { this.snapshot = { ...this.snapshot, ...part, version: 1, savedAt: Date.now() }; await mkdir(join(this.platform.userDataDir, 'cloudflare'), { recursive: true }); const tmp = tempNameFor(this.snapshotFile); const fs = await import('node:fs/promises'); await fs.writeFile(tmp, JSON.stringify(this.snapshot), { mode: 0o600 }); await renameAtomic(tmp, this.snapshotFile) }
  async loadSnapshot(): Promise<PartialSnapshot | null> { try { const parsed = JSON.parse(await readFile(this.snapshotFile, 'utf8')) as PartialSnapshot; if (parsed.version !== 1) return null; this.snapshot = parsed; return parsed } catch { return null } }
}
