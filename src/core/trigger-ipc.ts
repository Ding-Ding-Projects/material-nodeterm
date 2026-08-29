import { IPC } from '../shared/ipc'
import { isSafeNodeId } from '../shared/safe-id'
import { sanitizeTriggerSpec } from '../shared/trigger'
import { type CorePlatform } from './platform'
import { type TriggerScheduler } from './trigger-scheduler'

function safeId(value: unknown): value is string {
  return typeof value === 'string' && isSafeNodeId(value)
}

function invalid(): never {
  throw new Error('Invalid trigger identity')
}

/**
 * Register the same trigger API for Electron and the Server Edition. All values cross a hostile
 * IPC boundary, so ids and specs are checked again here instead of trusting renderer types.
 */
export function registerTriggerIpc(platform: CorePlatform, scheduler: TriggerScheduler): void {
  platform.handle(IPC.triggerStatus, (projectId: unknown, nodeId: unknown) =>
    safeId(projectId) && safeId(nodeId) ? scheduler.status(projectId, nodeId) : invalid())
  platform.handle(IPC.triggerArm, async (projectId: unknown, nodeId: unknown, value: unknown) => {
    if (!safeId(projectId) || !safeId(nodeId)) return false
    const spec = sanitizeTriggerSpec(value)
    return spec ? scheduler.arm(projectId, nodeId, spec) : false
  })
  platform.handle(IPC.triggerDisarm, async (projectId: unknown, nodeId: unknown) => {
    if (!safeId(projectId) || !safeId(nodeId)) return false
    await scheduler.disarm(projectId, nodeId)
    return true
  })
  platform.handle(IPC.triggerRunNow, (projectId: unknown, nodeId: unknown) =>
    safeId(projectId) && safeId(nodeId) ? scheduler.runNow(projectId, nodeId) : invalid())
  platform.handle(IPC.triggerHistory, (projectId: unknown, nodeId?: unknown) => {
    if (!safeId(projectId) || (nodeId !== undefined && !safeId(nodeId))) return []
    return scheduler.listHistory(projectId, nodeId)
  })
}

export function triggerIpcNotify(platform: CorePlatform, receipt: unknown): void {
  platform.broadcast(IPC.triggerChanged, receipt)
}
