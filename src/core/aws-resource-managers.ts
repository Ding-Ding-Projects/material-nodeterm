import { randomUUID } from 'node:crypto'
import { IPC } from '../shared/ipc'
import type {
  AwsManagerListRequest,
  AwsManagerListResult,
  AwsManagerOperationProgress,
  AwsManagerRunRequest,
  AwsResourceManagerAdapter,
  AwsResourceManagerApi,
  AwsResourceManagerId
} from '../shared/aws-resource-managers'
import {
  AWS_RESOURCE_MANAGERS,
  isAwsResourceManagerId,
  validateAwsManagerRunRequest
} from '../shared/aws-resource-managers'
import type { CorePlatform } from './platform'

const MAX_QUERY_LENGTH = 256
const MAX_CURSOR_LENGTH = 512
const MAX_JOB_ID_LENGTH = 128

function boundedOptionalText(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

function unavailable(reason: string, nextAction: string): { available: false; reason: string; nextAction: string } {
  return { available: false, reason, nextAction }
}

function normalizeProgress(value: AwsManagerOperationProgress): AwsManagerOperationProgress {
  const phase = ['queued', 'running', 'completed', 'failed', 'cancelled'].includes(value.phase)
    ? value.phase
    : 'failed'
  const completed = Number.isFinite(value.completed) ? Math.max(0, Math.floor(value.completed)) : 0
  const total = Number.isFinite(value.total) ? Math.max(completed, Math.floor(value.total)) : completed
  const list = (items: unknown): string[] => Array.isArray(items)
    ? items.filter((item): item is string => typeof item === 'string' && item.length <= 512 && !/[\u0000-\u001f\u007f]/.test(item)).slice(0, 500)
    : []
  return {
    jobId: typeof value.jobId === 'string' && value.jobId.length <= MAX_JOB_ID_LENGTH ? value.jobId : randomUUID(),
    phase,
    stage: typeof value.stage === 'string' ? value.stage.slice(0, 256) : 'Unknown stage',
    completed,
    total,
    message: typeof value.message === 'string' ? value.message.slice(0, 1024) : 'AWS operation status is unavailable.',
    canCancel: value.canCancel === true,
    canRetry: value.canRetry === true,
    succeededResourceIds: list(value.succeededResourceIds),
    failedResourceIds: list(value.failedResourceIds)
  }
}

function normalizeResource(value: unknown): import('../shared/aws-resource-managers').AwsManagerResource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const resource = value as Record<string, unknown>
  const text = (candidate: unknown, max: number): string | null =>
    typeof candidate === 'string' && candidate.length > 0 && candidate.length <= max && !/[\u0000-\u001f\u007f]/.test(candidate)
      ? candidate
      : null
  const id = text(resource.id, 512)
  const label = text(resource.label, 512)
  const kind = text(resource.kind, 128)
  const region = text(resource.region, 128)
  const status = text(resource.status, 128)
  if (!id || !label || !kind || !region || !status) return null
  return { id, label, kind, region, status, description: text(resource.description, 1024) ?? '' }
}

/**
 * Core-side coordinator for the eight guided AWS manager families.
 *
 * The coordinator owns validation, bounded result shaping, and job routing. An AWS adapter is
 * deliberately injected by the host so credentials and provider sessions never cross IPC. With no
 * adapter installed, every manager remains visible and reports the exact unavailable state instead
 * of becoming a decorative button or guessing from a local command.
 */
export class AwsResourceManagerService implements AwsResourceManagerApi {
  private readonly adapters = new Map<AwsResourceManagerId, AwsResourceManagerAdapter>()
  private readonly jobs = new Map<string, AwsResourceManagerId>()

  constructor(adapters: readonly AwsResourceManagerAdapter[] = []) {
    for (const adapter of adapters) {
      if (!isAwsResourceManagerId(adapter.manager) || this.adapters.has(adapter.manager)) {
        throw new Error('AWS manager adapter id is invalid or duplicated.')
      }
      this.adapters.set(adapter.manager, adapter)
    }
  }

  async catalog(): Promise<readonly typeof AWS_RESOURCE_MANAGERS[number][]> {
    return AWS_RESOURCE_MANAGERS
  }

  async availability(manager: AwsResourceManagerId): Promise<{ available: boolean; reason?: string; nextAction?: string }> {
    if (!isAwsResourceManagerId(manager)) throw new Error('AWS manager id is invalid.')
    const adapter = this.adapters.get(manager)
    if (!adapter) return unavailable('The AWS adapter is not installed on this computer.', 'Install or enable the bundled AWS adapter, then refresh.')
    try {
      const result = await adapter.availability()
      return {
        available: result.available === true,
        ...(result.reason ? { reason: String(result.reason).slice(0, 512) } : {}),
        ...(result.nextAction ? { nextAction: String(result.nextAction).slice(0, 512) } : {})
      }
    } catch {
      return unavailable('The AWS adapter health check could not be completed.', 'Check the AWS adapter status and retry the health check.')
    }
  }

  async list(request: AwsManagerListRequest): Promise<AwsManagerListResult> {
    if (!isAwsResourceManagerId(request.manager)) throw new Error('AWS manager id is invalid.')
    const query = boundedOptionalText(request.query, 'AWS resource search', MAX_QUERY_LENGTH)
    const nextToken = boundedOptionalText(request.nextToken, 'AWS pagination cursor', MAX_CURSOR_LENGTH)
    const region = boundedOptionalText(request.region, 'AWS region', 128)
    const adapter = this.adapters.get(request.manager)
    if (!adapter) return { resources: [], partial: false, warning: 'The AWS adapter is unavailable. Install or enable it, then refresh.' }
    const result = await adapter.list({ manager: request.manager, ...(region ? { region } : {}), ...(query ? { query } : {}), ...(nextToken ? { nextToken } : {}) })
    return {
      resources: Array.isArray(result.resources) ? result.resources.map(normalizeResource).filter((resource): resource is NonNullable<typeof resource> => resource !== null).slice(0, 500) : [],
      ...(typeof result.nextToken === 'string' && result.nextToken.length <= MAX_CURSOR_LENGTH ? { nextToken: result.nextToken } : {}),
      partial: result.partial === true,
      ...(result.warning ? { warning: String(result.warning).slice(0, 1024) } : {})
    }
  }

  async run(request: AwsManagerRunRequest): Promise<AwsManagerOperationProgress> {
    const safe = validateAwsManagerRunRequest(request)
    const adapter = this.adapters.get(safe.manager)
    if (!adapter) throw new Error('The AWS adapter is unavailable. Install or enable it, then retry this operation.')
    const result = normalizeProgress(await adapter.run(safe))
    this.jobs.set(result.jobId, safe.manager)
    return result
  }

  async progress(jobId: string): Promise<AwsManagerOperationProgress> {
    const manager = this.requireJob(jobId)
    return normalizeProgress(await this.requireAdapter(manager).progress(jobId))
  }

  async cancel(jobId: string): Promise<AwsManagerOperationProgress> {
    const manager = this.requireJob(jobId)
    return normalizeProgress(await this.requireAdapter(manager).cancel(jobId))
  }

  async retry(jobId: string): Promise<AwsManagerOperationProgress> {
    const manager = this.requireJob(jobId)
    return normalizeProgress(await this.requireAdapter(manager).retry(jobId))
  }

  private requireJob(jobId: string): AwsResourceManagerId {
    if (typeof jobId !== 'string' || jobId.length === 0 || jobId.length > MAX_JOB_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(jobId)) {
      throw new Error('AWS operation id is invalid.')
    }
    const manager = this.jobs.get(jobId)
    if (!manager) throw new Error('AWS operation was not found on this computer.')
    return manager
  }

  private requireAdapter(manager: AwsResourceManagerId): AwsResourceManagerAdapter {
    const adapter = this.adapters.get(manager)
    if (!adapter) throw new Error('The AWS adapter is unavailable. Install or enable it, then retry.')
    return adapter
  }
}

export function registerAwsResourceManagersIpc(
  platform: CorePlatform,
  adapters: readonly AwsResourceManagerAdapter[] = []
): { awsManagers: AwsResourceManagerService } {
  const awsManagers = new AwsResourceManagerService(adapters)
  platform.handle(IPC.awsManagerCatalog, () => awsManagers.catalog())
  platform.handle(IPC.awsManagerAvailability, (manager: AwsResourceManagerId) => awsManagers.availability(manager))
  platform.handle(IPC.awsManagerList, (request: AwsManagerListRequest) => awsManagers.list(request))
  platform.handle(IPC.awsManagerRun, (request: AwsManagerRunRequest) => awsManagers.run(request))
  platform.handle(IPC.awsManagerProgress, (jobId: string) => awsManagers.progress(jobId))
  platform.handle(IPC.awsManagerCancel, (jobId: string) => awsManagers.cancel(jobId))
  platform.handle(IPC.awsManagerRetry, (jobId: string) => awsManagers.retry(jobId))
  return { awsManagers }
}
