import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import { CloudflareTunnelService } from './service'

/** Registers the Cloudflare control-plane manager. No connector process is launched here. */
export function registerCloudflareIpc(platform: CorePlatform): CloudflareTunnelService {
  const service = new CloudflareTunnelService({
    userDataDir: platform.userDataDir,
    ...(platform.sealSecret && platform.unsealSecret
      ? { sealSecret: platform.sealSecret, unsealSecret: platform.unsealSecret }
      : {})
  })
  platform.handle(IPC.cloudflareStatus, () => service.status())
  platform.handle(IPC.cloudflareRefresh, () => service.refresh())
  platform.handle(IPC.cloudflareSaveToken, (token: string) => service.saveToken(token))
  platform.handle(IPC.cloudflareClearToken, () => service.clearToken())
  platform.handle(IPC.cloudflareBind, (input) => service.bind(input))
  platform.handle(IPC.cloudflareUnbind, () => service.unbind())
  platform.handle(IPC.cloudflarePreviewConfiguration, (input) => service.previewConfiguration(input))
  platform.handle(IPC.cloudflareApplyConfiguration, (previewId: string) => service.applyConfiguration(previewId))
  platform.handle(IPC.cloudflarePreviewDnsAdoption, (input) => service.previewDnsAdoption(input))
  platform.handle(IPC.cloudflareAdoptDnsRecord, (previewId: string) => service.adoptDnsRecord(previewId))
  return service
}

