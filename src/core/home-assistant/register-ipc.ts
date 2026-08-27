import { IPC } from '../../shared/ipc'
import type { HomeAssistantDiscoveryRequest, HomeAssistantInstanceInput } from '../../shared/home-assistant'
import type { CorePlatform } from '../platform'
import { HomeAssistantService } from './service'

export function registerHomeAssistantIpc(platform: CorePlatform): HomeAssistantService {
  const service = new HomeAssistantService(platform.userDataDir, (event) => platform.broadcast(IPC.homeAssistantEvent, event))
  platform.handle(IPC.homeAssistantInstances, () => service.instances())
  platform.handle(IPC.homeAssistantSaveInstance, (input: HomeAssistantInstanceInput) => service.saveInstance(input))
  platform.handle(IPC.homeAssistantRemoveInstance, (id: string) => service.removeInstance(id))
  platform.handle(IPC.homeAssistantDiscover, (request: HomeAssistantDiscoveryRequest) => service.discover(request))
  platform.handle(IPC.homeAssistantCancel, (operationId: string) => service.cancel(operationId))
  return service
}
