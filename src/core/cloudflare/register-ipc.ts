import type { CorePlatform } from '../platform'
import { IPC } from '../../shared/ipc'
import { CloudflareTunnelService } from './tunnel-service'
import type { CloudflareDnsAdoptionInput, CloudflareTunnelRouteInput } from '../../shared/cloudflare-tunnels'

/** Registers the typed Cloudflare Tunnel inventory over the shared core seam.
 *
 * This registrar is intentionally shared by Desktop and Server Edition. The provider token is
 * accepted only by the write-only credential handler, and every other handler carries ids and
 * closed route choices rather than raw Cloudflare request data.
 */
export function registerCloudflareTunnelIpc(platform: CorePlatform): CloudflareTunnelService {
  const service = new CloudflareTunnelService(platform)
  service.onProgress((progress) => platform.broadcast(IPC.cloudflareTunnelProgress, progress))
  platform.handle(IPC.cloudflareTunnelCredentialSave, (accountId: string, token: string) => service.saveCredential(accountId, token))
  platform.handle(IPC.cloudflareTunnelCredentialClear, (accountId: string) => service.clearCredential(accountId))
  platform.handle(IPC.cloudflareTunnelCredentialStatus, (accountId: string) => service.credentialStatus(accountId))
  platform.handle(IPC.cloudflareTunnelInventory, (accountId: string, zoneId?: string) => service.inventory(accountId, zoneId))
  platform.handle(IPC.cloudflareTunnelPlanRoute, (input: CloudflareTunnelRouteInput) => service.planRoute(input))
  platform.handle(IPC.cloudflareTunnelPlanDnsAdoption, (input: CloudflareDnsAdoptionInput) => service.planDnsAdoption(input))
  platform.handle(IPC.cloudflareTunnelSaveRoute, (input: CloudflareTunnelRouteInput) => service.saveRoute(input))
  platform.handle(IPC.cloudflareTunnelAdoptDnsRecord, (input: CloudflareDnsAdoptionInput) => service.adoptDnsRecord(input))
  platform.on(IPC.cloudflareTunnelCancel, (operationId: string) => service.cancel(operationId))
  return service
}
