import type { CorePlatform } from '../platform'
import { IPC } from '../../shared/ipc'
import { CloudflareTunnelService } from './tunnel-service'
import type { CloudflareCoreManagers } from '../cloudflare-core-managers'
import type { CloudflareDnsAdoptionInput, CloudflareTunnelRouteInput } from '../../shared/cloudflare-tunnels'

/** Registers the typed Cloudflare Tunnel inventory over the shared core seam.
 *
 * This registrar is intentionally shared by Desktop and Server Edition. The existing Cloudflare
 * core manager supplies the local token, and every tunnel handler carries ids and closed route
 * choices rather than raw Cloudflare request data.
 */
export function registerCloudflareTunnelIpc(platform: CorePlatform, coreManagers: CloudflareCoreManagers): CloudflareTunnelService {
  const service = new CloudflareTunnelService(platform, fetch, (accountId) => coreManagers.tokenForAccount(accountId))
  service.onProgress((progress) => platform.broadcast(IPC.cloudflareTunnelProgress, progress))
  platform.handle(IPC.cloudflareTunnelZones, (accountId: string) => service.zones(accountId))
  platform.handle(IPC.cloudflareTunnelInventory, (accountId: string, zoneId?: string) => service.inventory(accountId, zoneId))
  platform.handle(IPC.cloudflareTunnelPlanRoute, (input: CloudflareTunnelRouteInput) => service.planRoute(input))
  platform.handle(IPC.cloudflareTunnelPlanDnsAdoption, (input: CloudflareDnsAdoptionInput) => service.planDnsAdoption(input))
  platform.handle(IPC.cloudflareTunnelSaveRoute, (input: CloudflareTunnelRouteInput) => service.saveRoute(input))
  platform.handle(IPC.cloudflareTunnelAdoptDnsRecord, (input: CloudflareDnsAdoptionInput) => service.adoptDnsRecord(input))
  platform.on(IPC.cloudflareTunnelCancel, (operationId: string) => service.cancel(operationId))
  return service
}
