import { IPC } from '../../shared/ipc'
import type { OpenWebUiApi, OpenWebUiConfigureInput } from '../../shared/open-webui'
import type { CorePlatform } from '../platform'
import { OpenWebUiManager } from './manager'

/** Register the typed Open WebUI lifecycle on the shared desktop/browser core seam. */
export function registerOpenWebUiIpc(platform: CorePlatform): { manager: OpenWebUiManager } {
  const manager = new OpenWebUiManager({
    userDataDir: platform.userDataDir,
    onStatus: (status) => platform.broadcast(IPC.openWebUiEvent, status)
  })
  const api: OpenWebUiApi = {
    configure: (input: OpenWebUiConfigureInput) => manager.configure(input),
    status: (id) => manager.status(id),
    start: (id) => manager.start(id),
    stop: (id) => manager.stop(id),
    listBackups: (id) => manager.listBackups(id),
    createBackup: (id) => manager.createBackup(id),
    restoreBackup: (id, backupId) => manager.restoreBackup(id, backupId),
    update: (id) => manager.update(id),
    rollback: (id) => manager.rollback(id),
    tunnelHandoff: (id) => manager.tunnelHandoff(id),
    onEvent: () => () => {}
  }
  platform.handle(IPC.openWebUiConfigure, (input: OpenWebUiConfigureInput) => api.configure(input))
  platform.handle(IPC.openWebUiStatus, (id: string) => api.status(id))
  platform.handle(IPC.openWebUiStart, (id: string) => api.start(id))
  platform.handle(IPC.openWebUiStop, (id: string) => api.stop(id))
  platform.handle(IPC.openWebUiBackupsList, (id: string) => api.listBackups(id))
  platform.handle(IPC.openWebUiBackupCreate, (id: string) => api.createBackup(id))
  platform.handle(IPC.openWebUiBackupRestore, (id: string, backupId: string) => api.restoreBackup(id, backupId))
  platform.handle(IPC.openWebUiUpdate, (id: string) => api.update(id))
  platform.handle(IPC.openWebUiRollback, (id: string) => api.rollback(id))
  platform.handle(IPC.openWebUiTunnelHandoff, (id: string) => api.tunnelHandoff(id))
  return { manager }
}
