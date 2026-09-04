import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import { AwsCliService, createAwsCliService } from './service'

/** Transport for the bundled AWS CLI v2 manager (docs/features/integrations/aws-cli-manager.md).
 *  Registered by BOTH shells over the same CorePlatform seam, exactly like registerAwsIpc beside
 *  it, so the desktop and the Server Edition cannot drift. Nothing here touches credentials: the
 *  service only installs/repairs the pinned CLI and reads its foundation-model inventory. */
export function registerAwsCliIpc(platform: CorePlatform): AwsCliService {
  const service = createAwsCliService(platform)
  platform.handle(IPC.awsCliStatus, () => service.status())
  platform.handle(IPC.awsCliEnsure, () => service.ensure())
  platform.handle(IPC.awsCliRepair, () => service.repair())
  platform.handle(IPC.awsCliCancel, () => service.cancel())
  platform.handle(IPC.awsCliModels, () => service.models())
  platform.handle(IPC.awsCliRefreshModels, () => service.refreshModels())
  service.onStatus((status) => platform.broadcast(IPC.awsCliStatusEvent, status))
  return service
}
