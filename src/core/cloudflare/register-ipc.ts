import { IPC } from '../../shared/ipc'
import type { CloudflareApi, CloudflareDestructiveMutation, CloudflareManagerKind, CloudflareMutation, CloudflareMutationConfirmation } from '../../shared/cloudflare'
import { CloudflareManagerService, type CloudflareServiceOptions } from './service'
import type { CorePlatform } from '../platform'

/** Register the Cloudflare manager API on either shell. The shell supplies only the credential
 * provider and permission reader. No token value is ever sent to the renderer or relay. */
export function registerCloudflareIpc(platform: CorePlatform, options: CloudflareServiceOptions = {}): CloudflareApi {
  const service = new CloudflareManagerService(options)
  platform.handle(IPC.cloudflareSecretPresence, () => service.secretPresence())
  platform.handle(IPC.cloudflarePermissions, (accountId: string) => service.permissions(accountId))
  platform.handle(IPC.cloudflareList, (manager: CloudflareManagerKind, accountId: string, page?: number, perPage?: number) => service.list(manager, accountId, page, perPage))
  platform.handle(IPC.cloudflareListAll, (manager: CloudflareManagerKind, accountId: string, perPage?: number) => service.listAll(manager, accountId, perPage))
  platform.handle(IPC.cloudflareGraphql, (operation: 'account-summary' | 'workers-analytics', accountId: string) => service.graphql(operation, accountId))
  platform.handle(IPC.cloudflarePreview, (mutation: CloudflareDestructiveMutation) => service.preview(mutation))
  platform.handle(IPC.cloudflareMutate, (mutation: CloudflareMutation, confirmation?: CloudflareMutationConfirmation) => service.mutate(mutation, confirmation))
  return service
}

