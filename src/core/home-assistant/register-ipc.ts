import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import type { HomeAssistantSensorConfig } from '../../shared/home-assistant'
import { HomeAssistantSensorService } from './sensor-service'

const safeNodeId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)
const safeClientId = (value: unknown): value is number => Number.isSafeInteger(value) && value > 0

export function registerHomeAssistantIpc(platform: CorePlatform): { service: HomeAssistantSensorService } {
  const service = new HomeAssistantSensorService({
    onUpdate: (update, clientId) => platform.sendTo(clientId, IPC.homeAssistantSensorUpdate, update)
  })
  platform.handleWithSender(IPC.homeAssistantListEntities, (_clientId, connection) => service.listEntities(connection))
  platform.handleWithSender(IPC.homeAssistantReadSensor, (clientId: number, nodeId: string, connection, config: HomeAssistantSensorConfig) => {
    if (!safeClientId(clientId) || !safeNodeId(nodeId)) throw new Error('Home Assistant sensor ownership reference is invalid.')
    return service.read(clientId, nodeId, connection, config)
  })
  platform.handleWithSender(IPC.homeAssistantWatchSensor, (clientId: number, nodeId: string, connection, config: HomeAssistantSensorConfig) => {
    if (!safeClientId(clientId) || !safeNodeId(nodeId)) throw new Error('Home Assistant sensor ownership reference is invalid.')
    return service.watch(clientId, nodeId, connection, config)
  })
  platform.handleWithSender(IPC.homeAssistantUnwatchSensor, (clientId: number, nodeId: string) => {
    if (!safeClientId(clientId) || !safeNodeId(nodeId)) return undefined
    return service.unwatch(clientId, nodeId)
  })
  platform.handle(IPC.homeAssistantSetToken, (credentialKey: string, token: string | null) => service.setToken(credentialKey, token))
  platform.handle(IPC.homeAssistantTokenStatus, (credentialKey: string) => service.tokenStatus(credentialKey))
  return { service }
}
