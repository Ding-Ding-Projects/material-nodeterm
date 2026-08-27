import { IPC } from '../shared/ipc'
import type { CorePlatform } from './platform'
import type { AwsCoreRequest } from '../shared/aws-core-services'
import { AwsCoreServicesManager, ensureAwsCoreDataDir } from './aws-core-services'

/** Register the seven guided AWS core-service managers on the shared core seam. */
export function registerAwsCoreServicesIpc(platform: CorePlatform): AwsCoreServicesManager {
  const manager = new AwsCoreServicesManager(platform)
  void ensureAwsCoreDataDir(platform)
  platform.handle(IPC.awsCoreRuntime, () => manager.runtime())
  platform.handle(IPC.awsCoreProfiles, () => manager.profiles())
  platform.handle(IPC.awsCoreBinding, (nodeId: string) => manager.binding(nodeId))
  platform.handle(IPC.awsCoreBind, (input) => manager.bind(input))
  platform.handle(IPC.awsCoreUnbind, (nodeId: string) => manager.unbind(nodeId))
  platform.handle(IPC.awsCorePreview, (nodeId: string, request: AwsCoreRequest) => manager.preview(nodeId, request))
  platform.handle(IPC.awsCoreExecute, (nodeId: string, request: AwsCoreRequest) => manager.execute(nodeId, request))
  platform.handle(IPC.awsCoreCancel, (operationId: string) => manager.cancel(operationId))
  return manager
}
