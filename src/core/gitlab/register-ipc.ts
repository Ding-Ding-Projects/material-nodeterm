import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import { GitLabServerManager, type GitLabServerManagerOptions } from './server-manager'
import type { GitLabCreateInput } from '../../shared/gitlab'

export interface RegisterGitLabIpcDeps {
  managerOptions?: Partial<Omit<GitLabServerManagerOptions, 'userDataDir'>>
}

/** Register the same GitLab manager for the desktop and Server Edition shells. */
export function registerGitLabIpc(
  platform: CorePlatform,
  deps: RegisterGitLabIpcDeps = {}
): { manager: GitLabServerManager } {
  const manager = new GitLabServerManager({
    userDataDir: platform.userDataDir,
    ...deps.managerOptions
  })
  platform.handle(IPC.gitlabCatalog, () => manager.catalog())
  platform.handle(IPC.gitlabStatus, (id: string) => manager.status(id))
  platform.handle(IPC.gitlabCreate, (input: GitLabCreateInput) => manager.create(input))
  platform.handle(IPC.gitlabHandoffCredential, (id: string) => manager.handoffCredential(id))
  platform.handle(IPC.gitlabBackupsList, (id: string) => manager.listBackups(id))
  platform.handle(IPC.gitlabBackupCreate, (id: string) => manager.createBackup(id))
  platform.handle(IPC.gitlabBackupRestore, (id: string, backupId: string) => manager.restoreBackup(id, backupId))
  platform.handle(IPC.gitlabUpdate, (id: string, profileId: string) => manager.update(id, profileId))
  platform.handle(IPC.gitlabRollback, (id: string) => manager.rollback(id))
  platform.handle(IPC.gitlabStart, (id: string) => manager.start(id))
  platform.handle(IPC.gitlabStop, (id: string) => manager.stop(id))
  platform.handle(IPC.gitlabTunnelHandoff, (id: string) => manager.tunnelHandoff(id))
  return { manager }
}
