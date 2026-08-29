import { IPC } from '../../shared/ipc'
import type { AwsApi } from '../../shared/aws'
import type { CorePlatform } from '../platform'
import { createAwsCliService } from './service'

export function registerAwsIpc(platform: CorePlatform): { service: ReturnType<typeof createAwsCliService> } {
  const service = createAwsCliService(platform)
  platform.handle(IPC.awsStatus, () => service.status())
  platform.handle(IPC.awsEnsure, () => service.ensure())
  platform.handle(IPC.awsRepair, () => service.repair())
  platform.handle(IPC.awsCancel, () => service.cancel())
  platform.handle(IPC.awsModels, () => service.models())
  platform.handle(IPC.awsRefreshModels, () => service.refreshModels())
  service.onStatus((status) => platform.broadcast(IPC.awsStatusChanged, status))
  return { service }
}

export type AwsApiContract = AwsApi
