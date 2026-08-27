import { IPC } from '../../shared/ipc'
import type { HomeAssistantConfigureInput, HomeAssistantSensorConfig } from '../../shared/home-assistant-sensor'
import type { CorePlatform } from '../platform'
import { HomeAssistantSensorService } from './service'

export function registerHomeAssistantSensorIpc(platform: CorePlatform): HomeAssistantSensorService {
  const service = new HomeAssistantSensorService(platform)
  platform.handle(IPC.homeAssistantSensorBinding, (nodeId: string) => service.binding(nodeId))
  platform.handle(IPC.homeAssistantSensorConfigure, (input: HomeAssistantConfigureInput) => service.configure(input))
  platform.handle(IPC.homeAssistantSensorLeaveUnbound, (nodeId: string) => service.leaveUnbound(nodeId))
  platform.handle(IPC.homeAssistantSensorDiscover, (nodeId: string) => service.discover(nodeId))
  platform.handle(IPC.homeAssistantSensorRefresh, (nodeId: string, config: HomeAssistantSensorConfig) => service.refresh(nodeId, config))
  return service
}
