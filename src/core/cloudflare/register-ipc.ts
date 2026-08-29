import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import { CloudflareManager } from './manager'

/** Registers the finite Cloudflare manager surface on both desktop and Server Edition shells. */
export function registerCloudflareIpc(platform: CorePlatform): { manager: CloudflareManager } {
  const manager = new CloudflareManager(platform)
  platform.handle(IPC.cloudflareTokenStatus, () => manager.tokenStatus())
  platform.handle(IPC.cloudflareSaveToken, (token: string) => manager.saveToken(token))
  platform.handle(IPC.cloudflareClearToken, () => manager.clearToken())
  platform.handle(IPC.cloudflareStatus, () => manager.status())
  platform.handle(IPC.cloudflarePermissions, () => manager.permissions())
  platform.handle(IPC.cloudflareAccounts, (page?: number) => manager.accounts(page))
  platform.handle(IPC.cloudflareZones, (page?: number) => manager.zones(page))
  platform.handle(IPC.cloudflareDnsRecords, (zoneId: string, page?: number, search?: string) => manager.dnsRecords(zoneId, page, search))
  platform.handle(IPC.cloudflareSslTls, (zoneId: string) => manager.sslTlsSettings(zoneId))
  platform.handle(IPC.cloudflareRulesets, (zoneId: string, page?: number) => manager.rulesets(zoneId, page))
  platform.handle(IPC.cloudflareRedirects, (zoneId: string, page?: number) => manager.redirectRules(zoneId, page))
  platform.handle(IPC.cloudflareAnalytics, (zoneId: string, since: string, until: string) => manager.analytics(zoneId, since, until))
  platform.handle(IPC.cloudflareDnsCreate, (zoneId, input) => manager.createDnsRecord(zoneId, input))
  platform.handle(IPC.cloudflareDnsUpdate, (zoneId, id, input) => manager.updateDnsRecord(zoneId, id, input))
  platform.handle(IPC.cloudflareDnsDeletePreview, (zoneId, id) => manager.previewDeleteDnsRecord(zoneId, id))
  platform.handle(IPC.cloudflareDnsDelete, (zoneId, id, preview) => manager.deleteDnsRecord(zoneId, id, preview))
  platform.handle(IPC.cloudflareSslTlsUpdate, (zoneId, input) => manager.updateSslTlsSetting(zoneId, input))
  platform.handle(IPC.cloudflareRulesetCreate, (zoneId, input) => manager.createRuleset(zoneId, input))
  platform.handle(IPC.cloudflareRulesetUpdate, (zoneId, id, input) => manager.updateRuleset(zoneId, id, input))
  platform.handle(IPC.cloudflareRulesetDeletePreview, (zoneId, id) => manager.previewDeleteRuleset(zoneId, id))
  platform.handle(IPC.cloudflareRulesetDelete, (zoneId, id, preview) => manager.deleteRuleset(zoneId, id, preview))
  platform.handle(IPC.cloudflareRedirectCreate, (zoneId, input) => manager.createRedirectRule(zoneId, input))
  platform.handle(IPC.cloudflareRedirectUpdate, (zoneId, id, input) => manager.updateRedirectRule(zoneId, id, input))
  platform.handle(IPC.cloudflareRedirectDeletePreview, (zoneId, id) => manager.previewDeleteRedirectRule(zoneId, id))
  platform.handle(IPC.cloudflareRedirectDelete, (zoneId, id, preview) => manager.deleteRedirectRule(zoneId, id, preview))
  platform.handle(IPC.cloudflareCachePurgePreview, (input) => manager.previewPurgeCache(input))
  platform.handle(IPC.cloudflareCachePurge, (preview) => manager.purgeCache(preview))
  return { manager }
}
