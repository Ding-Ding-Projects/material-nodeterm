import type { CorePlatform } from '../platform'
import { IPC } from '../../shared/ipc'
import {
  GITHUB_API_OPERATIONS,
  type GitHubApiCapabilities,
  type GitHubApiProgress,
  type GitHubApiRequest,
  type GitHubApiResult
} from '../../shared/github-api'
import type { GitHubIssuesClient } from './client'
import type { GitHubIssueServiceContext } from './service'

const MAX_ACTIVE_PER_UI = 4
const MAX_CURSOR = 256
const MAX_OPERATION_ID = 128

type Credential = { token: string; userId: string }
type ApiClient = Pick<GitHubIssuesClient, 'executeApi'>
type ApiServiceOptions = {
  platform: CorePlatform
  contextForProject(projectId: string): Promise<GitHubIssueServiceContext>
  credential(): Promise<Credential | null>
  client(token: string): ApiClient
}

type ActiveOperation = { uiId: number; controller: AbortController; operation: GitHubApiRequest['operation'] }

const capabilities: GitHubApiCapabilities = {
  apiVersion: '2022-11-28',
  restBaseUrl: 'https://api.github.com',
  graphqlUrl: 'https://api.github.com/graphql',
  operations: GITHUB_API_OPERATIONS,
  scopes: ['repository', 'account', 'organization'],
  maxPageSize: 100,
  maxResponseBytes: 8 * 1024 * 1024,
  rawRequests: false,
  arbitraryShell: false,
  rendererCredentials: false
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function messageFor(error: unknown): string {
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    return String((error as { code: string }).code)
  }
  return 'request-failed'
}

export class GitHubApiService {
  private sequence = 0
  private readonly active = new Map<string, ActiveOperation>()
  private readonly listeners = new Set<(progress: GitHubApiProgress) => void>()

  constructor(private readonly options: ApiServiceOptions) {}

  capabilities(): Promise<GitHubApiCapabilities> {
    return Promise.resolve(capabilities)
  }

  onProgress(listener: (progress: GitHubApiProgress) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async execute(uiId: number, request: GitHubApiRequest): Promise<GitHubApiResult> {
    const spec = GITHUB_API_OPERATIONS.find((item) => item.id === request.operation)
    if (!spec || !record(request.params)) throw new Error('invalid-request')
    if (request.cursor !== undefined && (typeof request.cursor !== 'string' || request.cursor.length > MAX_CURSOR)) {
      throw new Error('invalid-request')
    }
    if (request.page !== undefined && (!Number.isSafeInteger(request.page) || request.page < 1 || request.page > 100_000)) {
      throw new Error('invalid-request')
    }
    if (spec.destructive && (
      request.destructiveConfirmation?.completed !== true ||
      request.destructiveConfirmation.operation !== request.operation
    )) throw new Error('destructive-confirmation-required')
    const activeForUi = [...this.active.values()].filter((item) => item.uiId === uiId)
    if (activeForUi.length >= MAX_ACTIVE_PER_UI) throw new Error('operation-limit')
    const credential = await this.options.credential()
    if (!credential) throw new Error('not-authenticated')
    let context: GitHubIssueServiceContext | undefined
    if (spec.scope === 'repository') {
      if (!request.projectId) throw new Error('project-required')
      context = await this.options.contextForProject(request.projectId)
    }
    const operationId = `${uiId}:${++this.sequence}`
    const controller = new AbortController()
    this.active.set(operationId, { uiId, controller, operation: request.operation })
    const emit = (phase: GitHubApiProgress['phase'], completed: number, message: string, total: number | null = 1) => {
      const progress: GitHubApiProgress = { operationId, operation: request.operation, phase, completed, total, message }
      this.options.platform.sendTo(uiId, IPC.githubApiProgress, progress)
      for (const listener of this.listeners) listener(progress)
    }
    emit('requesting', 0, 'Requesting the selected GitHub capability.')
    try {
      const result = await this.options.client(credential.token).executeApi(
        request,
        context?.repository,
        controller.signal
      )
      emit('completed', 1, 'The GitHub capability completed.')
      return result
    } catch (error) {
      if (controller.signal.aborted) {
        emit('cancelled', 0, 'The GitHub capability was cancelled.')
      } else {
        emit('failed', 0, messageFor(error))
      }
      throw error
    } finally {
      this.active.delete(operationId)
    }
  }

  async cancel(uiId: number, operationId: string): Promise<void> {
    if (typeof operationId !== 'string' || operationId.length < 1 || operationId.length > MAX_OPERATION_ID) {
      throw new Error('invalid-operation')
    }
    const active = this.active.get(operationId)
    if (active?.uiId === uiId) active.controller.abort()
  }
}
