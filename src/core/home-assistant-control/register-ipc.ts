import { IPC } from '../../shared/ipc'
import type { HomeAssistantCallInput, HomeAssistantConnectionInput } from '../../shared/home-assistant-control'
import type { CorePlatform } from '../platform'
import { HomeAssistantControlService } from './service'

export function registerHomeAssistantControlIpc(platform: CorePlatform): HomeAssistantControlService {
  const service = new HomeAssistantControlService(platform.userDataDir)
  platform.handle(IPC.homeAssistantConnections, () => service.connections())
  platform.handle(IPC.homeAssistantConfigure, (input: HomeAssistantConnectionInput) => service.configure(input))
  platform.handle(IPC.homeAssistantBind, (nodeId: string, connectionId: string | null) => service.bind(nodeId, connectionId))
  platform.handle(IPC.homeAssistantStatus, (nodeId: string) => service.status(nodeId))
  platform.handle(IPC.homeAssistantEntities, (nodeId: string) => service.entities(nodeId))
  platform.handle(IPC.homeAssistantServices, (nodeId: string) => service.services(nodeId))
  platform.handle(IPC.homeAssistantCall, (input: HomeAssistantCallInput) => service.call(input))
  platform.handle(IPC.homeAssistantCancel, (nodeId: string) => service.cancel(nodeId))
  return service
}

