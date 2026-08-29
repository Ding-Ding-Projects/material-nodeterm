import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import type { NextcloudApi, NextcloudBackupSummary, NextcloudInstallInput, NextcloudRelease, NextcloudStatus } from '../../shared/nextcloud'
import { NextcloudManager, type NextcloudManagerOptions } from './manager'

export interface RegisterNextcloudIpcDeps {
  managerOptions?: Partial<NextcloudManagerOptions>
}

export function registerNextcloudIpc(platform: CorePlatform, deps: RegisterNextcloudIpcDeps = {}): { manager: NextcloudManager } {
  const manager = new NextcloudManager({
    userDataDir: platform.userDataDir,
    ...deps.managerOptions,
    onEvent: (event) => {
      deps.managerOptions?.onEvent?.(event)
      platform.broadcast(IPC.nextcloudEvent, event)
    }
  })
  platform.handle(IPC.nextcloudStatus, (id: string): Promise<NextcloudStatus> => manager.status(id))
  platform.handle(IPC.nextcloudInstall, (input: NextcloudInstallInput): Promise<NextcloudStatus> => manager.install(input))
  platform.handle(IPC.nextcloudUpdate, (id: string, release: NextcloudRelease): Promise<NextcloudStatus> => manager.update(id, release))
  platform.handle(IPC.nextcloudBackupsList, (id: string): Promise<NextcloudBackupSummary[]> => manager.listBackups(id))
  platform.handle(IPC.nextcloudBackup, (id: string): Promise<NextcloudBackupSummary> => manager.backup(id))
  platform.handle(IPC.nextcloudRestore, (id: string, backupId: string): Promise<NextcloudStatus> => manager.restore(id, backupId))
  platform.handle(IPC.nextcloudRollback, (id: string): Promise<NextcloudStatus> => manager.rollback(id))
  platform.handle(IPC.nextcloudTunnelHandoff, (id: string): Promise<NextcloudStatus> => manager.requestTunnelHandoff(id))
  platform.handle(IPC.nextcloudRemove, (id: string, deleteData: boolean): Promise<void> => manager.remove(id, deleteData))
  return { manager }
}

export type RegisteredNextcloudApi = Pick<NextcloudApi, 'status' | 'install' | 'update'>
