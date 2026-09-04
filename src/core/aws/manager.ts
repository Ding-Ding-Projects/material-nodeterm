import type { CorePlatform } from '../platform'
import { spawn } from 'node:child_process'
import { IPC } from '../../shared/ipc'
import {
  AWS_OPERATION_CATALOG,
  type AwsBulkPreview,
  type AwsEvent,
  type AwsExecutionPreview,
  type AwsInventoryPage,
  type AwsInventoryRequest,
  type AwsOperationInput,
  type AwsOperationSpec,
  type AwsPermissionState,
  type AwsResourceRecord,
  type AwsServiceKind
} from '../../shared/aws'
import { SpawnAwsCommandExecutor, buildAwsArgv, type AwsCommandExecutor } from './executor'

type AnyAwsResponse = Record<string, unknown>

function permissionFromError(message: string): AwsPermissionState {
  const denied = /accessdenied|unauthori[sz]ed|not authorized|forbidden/i.test(message)
  return { state: denied ? 'denied' : 'unavailable', missingActions: [], detail: message || 'AWS returned no diagnostic.' }
}

function resourceId(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function normalizeItems(service: AwsServiceKind, body: unknown, region: string): AwsResourceRecord[] {
  if (!body || typeof body !== 'object') return []
  const input = body as AnyAwsResponse
  const arrays = Object.entries(input).filter(([, value]) => Array.isArray(value))
  const source = arrays.flatMap(([, value]) => value as unknown[])
  return source.map((item, index) => {
    const row = item && typeof item === 'object' ? item as AnyAwsResponse : { value: item }
    const id = resourceId(row.arn ?? row.resourceArn ?? row.clusterArn ?? row.DBInstanceArn ?? row.VpcId ?? row.Id ?? row.id, `${service}-${index + 1}`)
    const name = resourceId(row.name ?? row.repositoryName ?? row.clusterName ?? row.DBInstanceIdentifier ?? row.VpcId ?? row.Id, id)
    const status = resourceId(row.status ?? row.Status ?? row.State ?? row.state, 'unknown')
    const properties: Record<string, string | number | boolean | null> = {}
    for (const [key, value] of Object.entries(row)) {
      if (['arn', 'resourceArn', 'clusterArn', 'DBInstanceArn', 'VpcId', 'Id', 'id', 'name', 'repositoryName', 'clusterName', 'DBInstanceIdentifier', 'status', 'Status', 'State', 'state'].includes(key)) continue
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) properties[key] = value
    }
    return { id, service, kind: service, name, status, region, arn: typeof row.arn === 'string' ? row.arn : undefined, properties }
  })
}

function findOperation(id: string): AwsOperationSpec {
  const operation = AWS_OPERATION_CATALOG.find((candidate) => candidate.id === id)
  if (!operation) throw new Error(`Unknown AWS operation: ${id}`)
  return operation
}

function validateValues(operation: AwsOperationSpec, values: Record<string, unknown>): void {
  for (const field of operation.fields) {
    if (field.required && (values[field.key] === undefined || values[field.key] === null || String(values[field.key]).trim() === '')) throw new Error(`${field.label} is required.`)
    if (field.type === 'number' && values[field.key] !== undefined && typeof values[field.key] !== 'number') throw new Error(`${field.label} must be a number.`)
    if (field.pattern && values[field.key] !== undefined && !new RegExp(field.pattern).test(String(values[field.key]))) throw new Error(`${field.label} is not valid.`)
    if (field.type === 'enum' && values[field.key] !== undefined && field.options && !field.options.some((option) => option.value === values[field.key])) throw new Error(`${field.label} is not one of the available choices.`)
  }
}

export class AwsManager {
  private readonly executor: AwsCommandExecutor
  private readonly events = new Set<(event: AwsEvent) => void>()
  private readonly controllers = new Map<string, AbortController>()

  constructor(private readonly platform: CorePlatform, executor?: AwsCommandExecutor) {
    this.executor = executor ?? new SpawnAwsCommandExecutor()
  }

  catalog(): AwsOperationSpec[] { return AWS_OPERATION_CATALOG.map((operation) => ({ ...operation, fields: operation.fields.map((field) => ({ ...field, options: field.options?.map((option) => ({ ...option })) })) })) }
  forms(service?: AwsServiceKind): AwsOperationSpec[] { return this.catalog().filter((operation) => !service || operation.service === service) }
  subscribe(listener: (event: AwsEvent) => void): () => void { this.events.add(listener); return () => this.events.delete(listener) }
  private emit(event: AwsEvent): void { for (const listener of this.events) listener(event); this.platform.broadcast(IPC.awsEvent, event) }

  async status(): Promise<{ available: boolean; cliVersion: string | null; profile: string | null; region: string | null; detail: string | null; checkedAt: number }> {
    try {
      const result = await new Promise<{ ok: boolean; output: string; detail?: string }>((resolve) => {
        const child = spawn('aws', ['--version'], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        const chunks: Buffer[] = []; const errors: Buffer[] = []
        child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk)); child.stderr?.on('data', (chunk: Buffer) => errors.push(chunk))
        child.once('error', (error: Error) => resolve({ ok: false, output: '', detail: error.message }))
        child.once('close', (code: number) => resolve({ ok: code === 0, output: Buffer.concat([...chunks, ...errors]).toString('utf8').trim() }))
      })
      return { available: result.ok, cliVersion: result.ok ? result.output : null, profile: null, region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? null, detail: result.detail ?? null, checkedAt: Date.now() }
    } catch (error) { return { available: false, cliVersion: null, profile: null, region: null, detail: String(error), checkedAt: Date.now() } }
  }

  async inventory(request: AwsInventoryRequest): Promise<AwsInventoryPage> {
    const operation = this.forms(request.service).find((candidate) => candidate.paginated && candidate.risk === 'read')
    if (!operation) throw new Error(`No inventory operation is registered for ${request.service}.`)
    const values: Record<string, unknown> = { ...(request.query ? { query: request.query } : {}), ...(request.continuationToken ? { nextToken: request.continuationToken } : {}) }
    this.emit({ kind: 'started', operationId: operation.id, at: Date.now(), message: `Loading ${operation.label}` })
    try {
      const result = await this.executor.run(operation, { region: request.region, profile: request.profile }, values)
      if (!result.ok) return { service: request.service, items: [], nextToken: null, page: request.page ?? 1, complete: false, permission: permissionFromError(result.stderr), fetchedAt: Date.now() }
      const body = result.output as AnyAwsResponse
      const token = typeof body?.nextToken === 'string' ? body.nextToken : typeof body?.NextToken === 'string' ? body.NextToken : null
      const items = normalizeItems(request.service, result.output, request.region)
      this.emit({ kind: 'page', operationId: operation.id, page: request.page ?? 1, received: items.length, at: Date.now() })
      return { service: request.service, items, nextToken: token, page: request.page ?? 1, complete: token === null, permission: { state: 'granted', missingActions: [], detail: 'The selected operation completed.' }, fetchedAt: Date.now() }
    } catch (error) { return { service: request.service, items: [], nextToken: null, page: request.page ?? 1, complete: false, permission: permissionFromError(String(error)), fetchedAt: Date.now() } }
  }

  async preview(input: AwsOperationInput): Promise<AwsExecutionPreview> {
    const operation = findOperation(input.operationId); validateValues(operation, input.values)
    return { operation, context: input.context, argv: buildAwsArgv(operation, input.context, input.values), risk: operation.risk, pagination: { enabled: !!operation.paginated, pageSize: 100, maxPages: 100 }, waiter: operation.waiter ?? null, credentialSource: input.context.profile ? 'local-profile' : 'environment', warnings: operation.risk === 'destructive' ? ['This operation changes provider state and requires the app confirmation flow.'] : [] }
  }

  async execute(input: AwsOperationInput): Promise<{ ok: boolean; output: unknown; permission: AwsPermissionState }> {
    const operation = findOperation(input.operationId); validateValues(operation, input.values)
    if (this.controllers.has(operation.id)) return { ok: false, output: null, permission: { state: 'unavailable', missingActions: [], detail: 'This AWS operation is already running. Cancel it or wait for its status before starting another.' } }
    this.emit({ kind: 'started', operationId: operation.id, at: Date.now(), message: operation.label })
    const controller = new AbortController(); this.controllers.set(operation.id, controller)
    let result
    try {
      result = await this.executor.run(operation, input.context, input.values, (completed, total) => this.emit({ kind: 'progress', operationId: operation.id, completed, total, at: Date.now() }), controller.signal)
    } catch (error) {
      this.controllers.delete(operation.id)
      const permission = permissionFromError(String(error)); this.emit({ kind: 'failed', operationId: operation.id, at: Date.now(), error: permission.detail })
      return { ok: false, output: null, permission }
    } finally { this.controllers.delete(operation.id) }
    if (!result.ok) { const permission = permissionFromError(result.stderr); this.emit({ kind: 'failed', operationId: operation.id, at: Date.now(), error: permission.detail }); return { ok: false, output: result.output, permission } }
    if (operation.waiter && this.executor.wait) {
      this.emit({ kind: 'waiting', operationId: operation.id, state: operation.waiter.name, at: Date.now() })
      const waited = await this.executor.wait(operation, input.context, input.values, (state) => this.emit({ kind: 'waiting', operationId: operation.id, state, at: Date.now() }))
      if (!waited.ok) { const permission = permissionFromError(waited.stderr); this.emit({ kind: 'failed', operationId: operation.id, at: Date.now(), error: permission.detail }); return { ok: false, output: waited.output, permission } }
    }
    this.emit({ kind: 'completed', operationId: operation.id, at: Date.now(), message: operation.label })
    return { ok: true, output: result.output, permission: { state: 'granted', missingActions: [], detail: 'The selected operation completed.' } }
  }

  async cancel(operationId: string): Promise<boolean> {
    const controller = this.controllers.get(operationId)
    if (!controller) return false
    controller.abort(); this.emit({ kind: 'failed', operationId, at: Date.now(), error: 'AWS operation cancelled.' }); return true
  }

  async bulkPreview(input: AwsOperationInput, selectedIds: string[]): Promise<AwsBulkPreview> {
    const operation = findOperation(input.operationId); validateValues(operation, input.values)
    const unique = [...new Set(selectedIds.filter((id) => id.trim() !== ''))]
    return { operation, selectedIds: unique, affectedCount: unique.length, skipped: [], requiresConfirmation: operation.risk === 'destructive', summary: `${unique.length} ${operation.label.toLowerCase()} operation(s) will run.` }
  }

  async bulkExecute(input: AwsOperationInput, selectedIds: string[]): Promise<{ ok: boolean; completed: string[]; failed: Array<{ id: string; error: string }> }> {
    const results: { completed: string[]; failed: Array<{ id: string; error: string }> } = { completed: [], failed: [] }
    for (const id of [...new Set(selectedIds)]) {
      try {
        const key = findOperation(input.operationId).fields.find((field) => field.key !== 'region')?.key ?? 'resourceId'
        const result = await this.execute({ ...input, values: { ...input.values, [key]: id } })
        if (result.ok) results.completed.push(id); else results.failed.push({ id, error: result.permission.detail })
      } catch (error) { results.failed.push({ id, error: String(error) }) }
    }
    if (results.failed.length) this.emit({ kind: 'partial', operationId: input.operationId, completed: results.completed.length, failed: results.failed.length, at: Date.now(), detail: 'Some selected operations did not complete.' })
    return { ok: results.failed.length === 0, ...results }
  }
}
