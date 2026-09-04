import { randomUUID } from 'node:crypto'
import { AWS_MANAGER_CATALOG, findAwsOperation } from './catalog'
import type {
  AwsBulkExecutionResult,
  AwsBulkItemResult,
  AwsDestructivePreview,
  AwsExecutionRequest,
  AwsExecutionResult,
  AwsManagerApi,
  AwsManagerDescriptor,
  AwsManagerService,
  AwsOperationSchema,
  AwsPage,
  AwsPermissionResult,
  AwsProgressEvent,
  AwsExecutionTarget,
  AwsFieldSchema,
  AwsPortableManagerIntent
} from '../../shared/aws-managers'

/** The only boundary that may talk to an AWS CLI/API implementation. It accepts typed data, never
 * a shell line, script, executable path, profile file, or credential value. The production adapter
 * is expected to resolve the bundled CLI and local vault inside the trusted host process. */
export interface AwsTransport {
  invoke(request: {
    service: AwsManagerService
    operation: AwsOperationSchema
    input: Readonly<Record<string, unknown>>
    target: AwsExecutionTarget
    signal: AbortSignal
  }): Promise<{ data: unknown; nextToken?: string }>
  stream?(request: {
    service: AwsManagerService
    operation: AwsOperationSchema
    input: Readonly<Record<string, unknown>>
    target: AwsExecutionTarget
    signal: AbortSignal
  }): AsyncIterable<unknown>
  wait?(request: {
    service: AwsManagerService
    operation: AwsOperationSchema
    input: Readonly<Record<string, unknown>>
    target: AwsExecutionTarget
    signal: AbortSignal
  }): Promise<unknown>
  permission?(service: AwsManagerService, permissions: readonly string[], target: AwsExecutionTarget, signal: AbortSignal): Promise<AwsPermissionResult>
}

export interface AwsSchemaExecutorOptions {
  transport: AwsTransport
  now?: () => number
  maxRetries?: number
  retryBaseMs?: number
  confirmationTtlMs?: number
  onProgress?: (event: AwsProgressEvent) => void
}

type ValidationResult = { ok: true } | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeRegion(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(value)
}

function isSafeTarget(target: AwsExecutionTarget): boolean {
  if (!isSafeRegion(target.region)) return false
  if (target.profileId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(target.profileId)) return false
  if (target.roleArn !== undefined && (target.roleArn.length > 2048 || /[\u0000-\u001f\u007f]/.test(target.roleArn))) return false
  if (target.endpointUrl !== undefined) {
    try {
      const url = new URL(target.endpointUrl)
      const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return false
      if (url.username || url.password) return false
    } catch {
      return false
    }
  }
  return true
}

function validateField(field: AwsFieldSchema, value: unknown, path: string): ValidationResult {
  if (value === undefined || value === null) {
    return field.required ? { ok: false, error: `${path} is required.` } : { ok: true }
  }
  if (field.kind === 'string' || field.kind === 'date-time' || field.kind === 'file') {
    if (typeof value !== 'string' && field.kind !== 'file') return { ok: false, error: `${path} must be text.` }
    if (field.kind === 'file') {
      if (!isRecord(value) || typeof value.name !== 'string' || typeof value.size !== 'number' || typeof value.handle !== 'string') {
        return { ok: false, error: `${path} must be a file selected through the native picker.` }
      }
      if (value.name.length > 255 || value.size < 0 || value.size > 512 * 1024 * 1024) return { ok: false, error: `${path} exceeds the bounded file limits.` }
      return { ok: true }
    }
    if (typeof value !== 'string') return { ok: false, error: `${path} must be text.` }
    if (field.maxLength !== undefined && value.length > field.maxLength) return { ok: false, error: `${path} is too long.` }
    if (field.pattern !== undefined && !(new RegExp(field.pattern).test(value))) return { ok: false, error: `${path} has an invalid format.` }
    if (field.kind === 'date-time' && Number.isNaN(Date.parse(value))) return { ok: false, error: `${path} must be a valid date and time.` }
    return { ok: true }
  }
  if (field.kind === 'enum') {
    if (typeof value !== 'string' || !field.options?.some((option) => option.value === value && option.disabledReason === undefined)) return { ok: false, error: `${path} must be selected from the available choices.` }
    return { ok: true }
  }
  if (field.kind === 'boolean') return typeof value === 'boolean' ? { ok: true } : { ok: false, error: `${path} must be on or off.` }
  if (field.kind === 'integer' || field.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (field.kind === 'integer' && !Number.isInteger(value))) return { ok: false, error: `${path} must be a finite ${field.kind}.` }
    if (field.min !== undefined && value < field.min || field.max !== undefined && value > field.max) return { ok: false, error: `${path} is outside the supported range.` }
    return { ok: true }
  }
  if (field.kind === 'json') {
    if (typeof value !== 'string' || value.length > (field.maxLength ?? 1024 * 1024)) return { ok: false, error: `${path} must be bounded JSON text.` }
    try { JSON.parse(value) } catch { return { ok: false, error: `${path} is not valid JSON.` }
    }
    return { ok: true }
  }
  if (field.kind === 'list') {
    if (!Array.isArray(value) || value.length > 10000) return { ok: false, error: `${path} must be a bounded list.` }
    if (!field.item) return { ok: true }
    for (let index = 0; index < value.length; index++) {
      const result = validateField(field.item, value[index], `${path}[${index}]`)
      if (!result.ok) return result
    }
    return { ok: true }
  }
  if (field.kind === 'map') {
    if (!isRecord(value) || Object.keys(value).length > 1000) return { ok: false, error: `${path} must be a bounded map.` }
    if (!field.item) return { ok: true }
    for (const [key, item] of Object.entries(value)) {
      if (!/^[A-Za-z0-9_.-]{1,128}$/.test(key)) return { ok: false, error: `${path} contains an unsafe key.` }
      const result = validateField(field.item, item, `${path}.${key}`)
      if (!result.ok) return result
    }
    return { ok: true }
  }
  if (field.kind === 'object') {
    if (!isRecord(value)) return { ok: false, error: `${path} must be an object.` }
    const fields = field.fields ?? []
    const known = new Set(fields.map((item) => item.key))
    for (const key of Object.keys(value)) if (!known.has(key)) return { ok: false, error: `${path}.${key} is not supported by this schema.` }
    for (const child of fields) {
      const result = validateField(child, value[child.key], `${path}.${child.key}`)
      if (!result.ok) return result
    }
    return { ok: true }
  }
  return { ok: false, error: `${path} uses an unsupported field kind.` }
}

function validateInput(operation: AwsOperationSchema, input: Readonly<Record<string, unknown>>): ValidationResult {
  if (!isRecord(input)) return { ok: false, error: 'The operation input must be an object.' }
  const known = new Set(operation.input.map((field) => field.key))
  for (const key of Object.keys(input)) if (!known.has(key)) return { ok: false, error: `${key} is not part of ${operation.id}.` }
  for (const field of operation.input) {
    const result = validateField(field, input[field.key], field.key)
    if (!result.ok) return result
  }
  return { ok: true }
}

function isTransient(error: unknown): boolean {
  if (!isRecord(error)) return false
  const code = String(error.code ?? error.name ?? error.status ?? '')
  return ['Throttling', 'ThrottlingException', 'RequestLimitExceeded', 'ServiceUnavailable', 'InternalError', 'TooManyRequestsException', 'TimeoutError', 'ECONNRESET', 'ETIMEDOUT'].some((item) => code.includes(item))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : isRecord(error) && typeof error.message === 'string' ? error.message : 'The AWS operation failed for an unknown reason.'
}

export class AwsSchemaExecutor implements AwsManagerApi {
  private readonly transport: AwsTransport
  private readonly now: () => number
  private readonly maxRetries: number
  private readonly retryBaseMs: number
  private readonly confirmationTtlMs: number
  private readonly onProgress?: (event: AwsProgressEvent) => void
  private readonly confirmations = new Map<string, { operationId: string; expiresAt: number }>()

  constructor(options: AwsSchemaExecutorOptions) {
    this.transport = options.transport
    this.now = options.now ?? Date.now
    this.maxRetries = Math.max(0, Math.min(8, options.maxRetries ?? 3))
    this.retryBaseMs = Math.max(100, Math.min(30_000, options.retryBaseMs ?? 500))
    this.confirmationTtlMs = Math.max(10_000, Math.min(15 * 60_000, options.confirmationTtlMs ?? 5 * 60_000))
    this.onProgress = options.onProgress
  }

  catalog(): Promise<readonly AwsManagerDescriptor[]> {
    return Promise.resolve(AWS_MANAGER_CATALOG)
  }

  permission(service: AwsManagerService, permissions: readonly string[], target: AwsExecutionTarget): Promise<AwsPermissionResult> {
    const signal = new AbortController().signal
    if (!this.transport.permission) return Promise.resolve({ allowed: true, missing: [] })
    return this.transport.permission(service, permissions, target, signal)
  }

  async previewDestructive(request: AwsExecutionRequest): Promise<AwsDestructivePreview> {
    const operation = this.operationFor(request)
    if (!operation.destructive) throw new Error(`${operation.label} is not a destructive operation.`)
    const valid = validateInput(operation, request.input)
    if (!valid.ok) throw new Error(valid.error)
    if (!isSafeTarget(request.target)) throw new Error('Choose a valid region, profile, role, and endpoint from the guided controls.')
    const permissions = await this.permission(request.service, operation.requiredPermissions, request.target)
    if (!permissions.allowed) throw new Error(permissions.reason ?? `Missing permissions: ${permissions.missing.join(', ')}.`)
    const confirmationNonce = randomUUID()
    const expiresAt = this.now() + this.confirmationTtlMs
    this.confirmations.set(confirmationNonce, { operationId: operation.id, expiresAt })
    const affected = Object.entries(request.input)
      .filter(([name]) => /(?:name|names|ids|key|keys|bucket|function)/i.test(name))
      .flatMap(([, value]) => Array.isArray(value) ? value.map(String) : [String(value)])
      .filter((value) => value !== '[object Object]')
    return { requestId: request.requestId, operationId: operation.id, service: request.service, affected, input: { ...request.input }, permissions: operation.requiredPermissions, confirmationNonce, expiresAt }
  }

  async execute<T = unknown>(request: AwsExecutionRequest): Promise<AwsExecutionResult<T>> {
    const operation = this.operationFor(request)
    this.progress(request, 'validating', 0, `Validating ${operation.label}.`)
    const valid = validateInput(operation, request.input)
    if (!valid.ok) throw new Error(valid.error)
    if (!isSafeTarget(request.target)) throw new Error('Choose a valid region, profile, role, and endpoint from the guided controls.')
    if (operation.destructive) this.requireConfirmation(request, operation)
    this.progress(request, 'authorizing', 0, `Checking permissions for ${operation.label}.`)
    const permissions = await this.permission(request.service, operation.requiredPermissions, request.target)
    if (!permissions.allowed) throw new Error(permissions.reason ?? `Missing permissions: ${permissions.missing.join(', ')}.`)
    const controller = new AbortController()
    const abort = () => controller.abort()
    request.signal?.addEventListener('abort', abort, { once: true })
    const pages: AwsPage<T>[] = []
    let retries = 0
    let input: Record<string, unknown> = { ...request.input }
    try {
      const maxPages = operation.pagination?.maxPages ?? 1
      for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
        this.throwIfCancelled(controller.signal)
        const response = await this.invokeWithRetry(request, operation, input, controller.signal, (count) => { retries += count })
        const items = this.pageItems(response.data) as T[]
        pages.push({ items, pageNumber, ...(response.nextToken ? { nextToken: response.nextToken } : {}) })
        this.progress(request, 'page', pageNumber, `Loaded page ${pageNumber}${response.nextToken ? '.' : '.'}`)
        if (!operation.pagination || !response.nextToken) break
        input = { ...input, [operation.pagination.inputToken]: response.nextToken }
      }
      if (operation.waiter && this.transport.wait) {
        this.progress(request, 'waiting', pages.length, `Waiting for ${operation.waiter.name}.`)
        await this.waitFor(request, operation, controller.signal)
      }
      this.progress(request, 'done', pages.length, `${operation.label} finished.`)
      return { requestId: request.requestId, service: request.service, operationId: operation.id, pages, partial: false, cancelled: false, retries }
    } catch (error) {
      if (controller.signal.aborted || request.signal?.aborted) {
        this.progress(request, 'cancelled', pages.length, `${operation.label} cancelled. Completed pages remain available.`)
        return { requestId: request.requestId, service: request.service, operationId: operation.id, pages, partial: true, cancelled: true, retries }
      }
      throw error
    } finally {
      request.signal?.removeEventListener('abort', abort)
    }
  }

  async *stream<T = unknown>(request: AwsExecutionRequest): AsyncIterable<AwsProgressEvent | T> {
    const operation = this.operationFor(request)
    const valid = validateInput(operation, request.input)
    if (!valid.ok) throw new Error(valid.error)
    if (!operation.stream || !this.transport.stream) {
      const result = await this.execute<T>(request)
      for (const page of result.pages) for (const item of page.items) yield item
      return
    }
    const controller = new AbortController()
    const abort = () => controller.abort()
    request.signal?.addEventListener('abort', abort, { once: true })
    let count = 0
    try {
      this.progress(request, 'running', 0, `${operation.label} is streaming.`)
      for await (const value of this.transport.stream({ service: request.service, operation, input: request.input, target: request.target, signal: controller.signal })) {
        this.throwIfCancelled(controller.signal)
        if (++count > operation.stream.maxRecords) throw new Error(`The stream exceeded its ${operation.stream.maxRecords} record limit.`)
        const bytes = Buffer.byteLength(JSON.stringify(value) ?? '')
        if (bytes > operation.stream.maxRecordBytes) throw new Error(`A streamed record exceeded its ${operation.stream.maxRecordBytes}-byte limit.`)
        this.progress(request, 'record', count, `Received record ${count}.`)
        yield value as T
      }
      this.progress(request, 'done', count, `${operation.label} stream finished.`)
    } catch (error) {
      if (controller.signal.aborted || request.signal?.aborted) {
        this.progress(request, 'cancelled', count, `${operation.label} stream cancelled.`)
        return
      }
      throw error
    } finally {
      request.signal?.removeEventListener('abort', abort)
    }
  }

  async bulk<T = unknown>(requests: readonly AwsExecutionRequest[], signal?: AbortSignal): Promise<AwsBulkExecutionResult<T>> {
    const items: AwsBulkItemResult<T>[] = []
    let completed = 0
    let failed = 0
    let cancelled = 0
    for (const request of requests) {
      if (signal?.aborted) {
        cancelled += 1
        items.push({ itemId: request.requestId, status: 'cancelled' })
        continue
      }
      try {
        const result = await this.execute<T>({ ...request, signal })
        if (result.cancelled) {
          cancelled += 1
          items.push({ itemId: request.requestId, result, status: 'cancelled' })
        } else {
          completed += 1
          items.push({ itemId: request.requestId, result, status: 'completed' })
        }
      } catch (error) {
        failed += 1
        items.push({ itemId: request.requestId, status: 'failed', error: errorMessage(error) })
      }
    }
    return { requestId: randomUUID(), items, completed, failed, cancelled, partial: failed > 0 || cancelled > 0 }
  }

  toPortableIntent(request: AwsExecutionRequest): AwsPortableManagerIntent {
    const operation = this.operationFor(request)
    const allowed = new Set(operation.portableIntent.allowedFields)
    const safeInput: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(request.input)) if (allowed.has(key)) safeInput[key] = value
    return { schemaVersion: 1, service: request.service, operationId: operation.id, safeInput, omitted: operation.portableIntent.omittedFields }
  }

  private operationFor(request: AwsExecutionRequest): AwsOperationSchema {
    const operation = findAwsOperation(request.operationId)
    if (!operation || operation.service !== request.service) throw new Error(`Unknown AWS operation ${request.operationId}.`)
    return operation
  }

  private requireConfirmation(request: AwsExecutionRequest, operation: AwsOperationSchema): void {
    const nonce = request.confirmationNonce
    const record = nonce ? this.confirmations.get(nonce) : undefined
    if (!nonce || !record || record.operationId !== operation.id || record.expiresAt <= this.now()) throw new Error('Review the destructive preview and confirm the exact affected resources before running this action.')
    this.confirmations.delete(nonce)
  }

  private async invokeWithRetry(request: AwsExecutionRequest, operation: AwsOperationSchema, input: Record<string, unknown>, signal: AbortSignal, addRetries: (count: number) => void): Promise<{ data: unknown; nextToken?: string }> {
    for (let attempt = 0; ; attempt++) {
      this.throwIfCancelled(signal)
      try {
        this.progress(request, attempt === 0 ? 'running' : 'retrying', attempt, attempt === 0 ? `Running ${operation.label}.` : `Retrying ${operation.label}.`)
        return await this.transport.invoke({ service: request.service, operation, input, target: request.target, signal })
      } catch (error) {
        if (!isTransient(error) || attempt >= this.maxRetries) throw error
        addRetries(1)
        await this.delay(Math.min(30_000, this.retryBaseMs * 2 ** attempt), signal)
      }
    }
  }

  private async waitFor(request: AwsExecutionRequest, operation: AwsOperationSchema, signal: AbortSignal): Promise<void> {
    const waiter = operation.waiter
    if (!waiter || !this.transport.wait) return
    for (let attempt = 1; attempt <= waiter.maxAttempts; attempt++) {
      this.throwIfCancelled(signal)
      const result = await this.transport.wait({ service: request.service, operation, input: request.input, target: request.target, signal })
      if (result === true || isRecord(result) && result.state === 'success') return
      if (isRecord(result) && result.state === 'failure') throw new Error(`AWS waiter ${waiter.name} reported failure.`)
      this.progress(request, 'waiting', attempt, `Waiting for ${waiter.name}, attempt ${attempt}.`)
      await this.delay(waiter.delayMs, signal)
    }
    throw new Error(`AWS waiter ${waiter.name} reached its ${waiter.maxAttempts}-attempt limit.`)
  }

  private pageItems(data: unknown): unknown[] {
    if (Array.isArray(data)) return data
    if (isRecord(data)) {
      for (const key of ['items', 'contents', 'users', 'roles', 'functions', 'metrics', 'events', 'logGroups', 'reservations']) if (Array.isArray(data[key])) return data[key] as unknown[]
      return [data]
    }
    return data === undefined ? [] : [data]
  }

  private progress(request: AwsExecutionRequest, phase: AwsProgressEvent['phase'], completed: number, message: string): void {
    this.onProgress?.({ requestId: request.requestId, phase, completed, message })
  }

  private throwIfCancelled(signal: AbortSignal): void {
    if (signal.aborted) throw new Error('AWS operation cancelled.')
  }

  private async delay(ms: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) { reject(new Error('AWS operation cancelled.')); return }
      const timer = setTimeout(resolve, ms)
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('AWS operation cancelled.')) }, { once: true })
    })
  }
}

export { AWS_MANAGER_CATALOG, findAwsOperation, validateInput }
