import type { CorePlatform } from '../platform'
import { IPC } from '../../shared/ipc'
import type { GitHubApiRequest } from '../../shared/github-api'
import type { GitHubApiService } from './api-service'

export function registerGitHubApiHandlers(platform: CorePlatform, service: GitHubApiService): void {
  platform.handle(IPC.githubApiCapabilities, () => service.capabilities())
  platform.handleWithSender(IPC.githubApiExecute, (uiId, request: GitHubApiRequest) =>
    service.execute(uiId, request))
  platform.handleWithSender(IPC.githubApiCancel, (uiId, operationId: string) =>
    service.cancel(uiId, operationId))
}
