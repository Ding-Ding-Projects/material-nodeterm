import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import type { AwsInventoryRequest, AwsOperationInput, AwsServiceKind } from '../../shared/aws'
import { AwsManager } from './manager'

export function registerAwsIpc(platform: CorePlatform): AwsManager {
  const manager = new AwsManager(platform)
  platform.handle(IPC.awsCatalog, () => manager.catalog())
  platform.handle(IPC.awsForms, (service?: AwsServiceKind) => manager.forms(service))
  platform.handle(IPC.awsInventory, (request: AwsInventoryRequest) => manager.inventory(request))
  platform.handle(IPC.awsPreview, (input: AwsOperationInput) => manager.preview(input))
  platform.handle(IPC.awsExecute, (input: AwsOperationInput) => manager.execute(input))
  platform.handle(IPC.awsCancel, (operationId: string) => manager.cancel(operationId))
  platform.handle(IPC.awsBulkPreview, (input: AwsOperationInput, ids: string[]) => manager.bulkPreview(input, ids))
  platform.handle(IPC.awsBulkExecute, (input: AwsOperationInput, ids: string[]) => manager.bulkExecute(input, ids))
  platform.handle(IPC.awsStatus, () => manager.status())
  return manager
}
