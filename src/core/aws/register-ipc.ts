import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import type { AwsApi } from '../../shared/aws'
import { AwsManager, type AwsManagerOptions } from './aws-manager'

export interface RegisterAwsIpcDeps {
  managerOptions?: AwsManagerOptions
}

/** Registers both AWS manager surfaces on the shared desktop and Server Edition core seam. */
export function registerAwsIpc(platform: CorePlatform, deps: RegisterAwsIpcDeps = {}): { manager: AwsManager } {
  const manager = new AwsManager(deps.managerOptions)
  platform.handle(IPC.awsStatus, () => manager.status())
  platform.handle(IPC.awsContext, (input) => manager.context(input))
  platform.handle(IPC.awsDiscoverResources, (input) => manager.discoverResources(input))
  platform.handle(IPC.awsListResourceTypes, (input) => manager.listResourceTypes(input))
  platform.handle(IPC.awsListResources, (input) => manager.listResources(input))
  platform.handle(IPC.awsReadResource, (input) => manager.readResource(input))
  platform.handle(IPC.awsPreview, (input) => manager.preview(input))
  platform.handle(IPC.awsCreateResource, (input) => manager.createResource(input))
  platform.handle(IPC.awsUpdateResource, (input) => manager.updateResource(input))
  platform.handle(IPC.awsDeleteResource, (input) => manager.deleteResource(input))
  return { manager }
}

export type { AwsApi }
