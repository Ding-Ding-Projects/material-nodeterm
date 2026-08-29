import { IPC } from '../shared/ipc'
import type { CorePlatform } from './platform'
import type { RepositoryGraphApi, RepositoryGraphExportInput, RepositoryGraphRefreshInput } from '../shared/repository-graph'
import { RepositoryGraphService, type RepositoryGraphTarget } from './repository-graph-service'

export interface RepositoryGraphRegisterOptions {
  projectTargetInfo: (projectId: string) => RepositoryGraphTarget | null
}

export function registerRepositoryGraphIpc(platform: CorePlatform, options: RepositoryGraphRegisterOptions): { service: RepositoryGraphApi } {
  const service = new RepositoryGraphService({ userDataDir: platform.userDataDir, projectTargetInfo: options.projectTargetInfo })
  service.onProgress((progress) => platform.broadcast(IPC.repositoryGraphProgress, progress))
  platform.handle(IPC.repositoryGraphInspect, (projectId: string, mode?: 'code' | 'dependencies' | 'combined') => service.inspect(projectId, mode))
  platform.handle(IPC.repositoryGraphRefresh, (input: RepositoryGraphRefreshInput) => service.refresh(input))
  platform.handle(IPC.repositoryGraphCancel, (operationId: string) => service.cancel(operationId))
  platform.handle(IPC.repositoryGraphExport, (input: RepositoryGraphExportInput) => service.export(input))
  return { service }
}
