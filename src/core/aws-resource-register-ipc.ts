import { IPC } from '../shared/ipc'
import type { AwsManagerRequest } from '../shared/aws-resource'
import type { CorePlatform } from './platform'
import { AwsResourceManagerService, type AwsCliResolver } from './aws-resource-manager'
import type { AwsWizardModelService } from './aws-wizard/service'

export function registerAwsResourceIpc(platform: CorePlatform, resolveAwsCli?: AwsCliResolver, wizardModels?: AwsWizardModelService): AwsResourceManagerService {
  const service = new AwsResourceManagerService(platform, resolveAwsCli, wizardModels)
  platform.handle(IPC.awsResourceRuntime, () => service.runtime())
  platform.handle(IPC.awsResourceProfiles, () => service.profiles())
  platform.handle(IPC.awsResourceBinding, (nodeId: string) => service.binding(nodeId))
  platform.handle(IPC.awsResourceBind, (input) => service.bind(input))
  platform.handle(IPC.awsResourceUnbind, (nodeId: string) => service.unbind(nodeId))
  platform.handle(IPC.awsResourcePreview, (nodeId: string, request: AwsManagerRequest) => service.preview(nodeId, request))
  platform.handle(IPC.awsResourceExecute, (nodeId: string, operationId: string, request: AwsManagerRequest) => service.execute(nodeId, operationId, request))
  platform.handle(IPC.awsResourceCancel, (operationId: string) => service.cancel(operationId))
  return service
}
