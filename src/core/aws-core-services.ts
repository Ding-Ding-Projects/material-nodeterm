import { execFile, type ChildProcess } from 'node:child_process'
import { access, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AtomicJsonArrayStore } from './atomic-json-store'
import type { CorePlatform } from './platform'
import { IPC } from '../shared/ipc'
import {
  AWS_CORE_OPERATIONS_BY_SERVICE,
  isAwsCoreName,
  isAwsCoreProfile,
  isAwsCoreRegion,
  type AwsCoreApi,
  type AwsCoreBinding,
  type AwsCoreOperation,
  type AwsCoreOperationPreview,
  type AwsCoreProgress,
  type AwsCoreProfileChoice,
  type AwsCoreRequest,
  type AwsCoreResult,
  type AwsCoreRisk,
  type AwsCoreRuntimeStatus,
  type AwsCoreServiceId
} from '../shared/aws-core-services'

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const MAX_RESULTS = 100
const COMMAND_TIMEOUT_MS = 90_000
const MAX_INPUT_TEXT = 2048

interface RunningCommand {
  child: ChildProcess
  nodeId: string
}

interface CommandSpec {
  service: AwsCoreServiceId
  operation: AwsCoreOperation
  args: string[]
  risk: AwsCoreRisk
  pagination: AwsCoreOperationPreview['pagination']
}

function required(value: unknown, label: string, max = MAX_INPUT_TEXT): string {
  if (typeof value !== 'string') throw new Error(`${label} is required.`)
  const text = value.trim()
  if (!text || text.length > max || text.includes('\0')) throw new Error(`${label} is invalid.`)
  return text
}

function optional(value: unknown, label: string, max = MAX_INPUT_TEXT): string | null {
  if (value === undefined || value === null || value === '') return null
  return required(value, label, max)
}

function boundedLimit(value: unknown): number {
  if (value === undefined) return MAX_RESULTS
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_RESULTS) {
    throw new Error(`Maximum results must be between 1 and ${MAX_RESULTS}.`)
  }
  return value
}

function endpoint(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  const raw = required(value, 'Endpoint URL', 2048)
  let parsed: URL
  try { parsed = new URL(raw) } catch { throw new Error('Endpoint URL is invalid.') }
  if (parsed.username || parsed.password) throw new Error('Endpoint URLs cannot contain credentials.')
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error('Endpoint URL must use HTTPS, except for an explicit loopback endpoint.')
  }
  return parsed.toString()
}

function input(request: AwsCoreRequest): Record<string, unknown> {
  if (!request.input || typeof request.input !== 'object' || Array.isArray(request.input)) return {}
  return request.input
}

function inputString(request: AwsCoreRequest, key: string, label: string, max = MAX_INPUT_TEXT): string {
  return required(input(request)[key], label, max)
}

function csvIds(request: AwsCoreRequest, key: string, label: string): string {
  const raw = inputString(request, key, label, MAX_INPUT_TEXT)
  const values = raw.split(',').map((value) => value.trim()).filter(Boolean)
  if (values.length === 0 || values.length > 100 || values.some((value) => !isAwsCoreName(value))) throw new Error(`${label} must be a comma-separated list of names.`)
  return values.join(',')
}

function operationSpec(request: AwsCoreRequest): CommandSpec {
  if (!AWS_CORE_OPERATIONS_BY_SERVICE[request.service]?.includes(request.operation)) throw new Error('AWS service operation is not available in this manager.')
  const limit = String(boundedLimit(request.maxResults))
  const token = optional(request.nextToken, 'Pagination token', 16_384)
  const add = (...args: string[]): string[] => [...args, '--output', 'json']
  switch (request.operation) {
    case 's3-list-buckets': return { service: 's3', operation: request.operation, args: add('s3api', 'list-buckets'), risk: 'read-only', pagination: 'none' }
    case 's3-list-objects': return { service: 's3', operation: request.operation, args: add('s3api', 'list-objects-v2', '--bucket', inputString(request, 'bucket', 'Bucket name'), '--max-keys', limit, ...(token ? ['--continuation-token', token] : [])), risk: 'read-only', pagination: 'next-token' }
    case 's3-create-bucket': return { service: 's3', operation: request.operation, args: add('s3api', 'create-bucket', '--bucket', inputString(request, 'bucket', 'Bucket name', 63)), risk: 'write', pagination: 'none' }
    case 's3-delete-bucket': return { service: 's3', operation: request.operation, args: add('s3api', 'delete-bucket', '--bucket', inputString(request, 'bucket', 'Bucket name', 63)), risk: 'destructive', pagination: 'none' }
    case 'ec2-describe-instances': return { service: 'ec2', operation: request.operation, args: add('ec2', 'describe-instances', '--max-results', limit, ...(token ? ['--next-token', token] : [])), risk: 'read-only', pagination: 'next-token' }
    case 'ec2-describe-security-groups': return { service: 'ec2', operation: request.operation, args: add('ec2', 'describe-security-groups'), risk: 'read-only', pagination: 'none' }
    case 'ec2-start-instances': return { service: 'ec2', operation: request.operation, args: add('ec2', 'start-instances', '--instance-ids', csvIds(request, 'instanceIds', 'Instance IDs')), risk: 'write', pagination: 'none' }
    case 'ec2-stop-instances': return { service: 'ec2', operation: request.operation, args: add('ec2', 'stop-instances', '--instance-ids', csvIds(request, 'instanceIds', 'Instance IDs')), risk: 'write', pagination: 'none' }
    case 'ec2-terminate-instances': return { service: 'ec2', operation: request.operation, args: add('ec2', 'terminate-instances', '--instance-ids', csvIds(request, 'instanceIds', 'Instance IDs')), risk: 'destructive', pagination: 'none' }
    case 'iam-list-users': return { service: 'iam', operation: request.operation, args: add('iam', 'list-users', '--max-items', limit, ...(token ? ['--starting-token', token] : [])), risk: 'read-only', pagination: 'next-token' }
    case 'iam-list-roles': return { service: 'iam', operation: request.operation, args: add('iam', 'list-roles', '--max-items', limit, ...(token ? ['--starting-token', token] : [])), risk: 'read-only', pagination: 'next-token' }
    case 'iam-get-user': return { service: 'iam', operation: request.operation, args: add('iam', 'get-user', '--user-name', inputString(request, 'userName', 'User name')), risk: 'read-only', pagination: 'none' }
    case 'iam-get-role': return { service: 'iam', operation: request.operation, args: add('iam', 'get-role', '--role-name', inputString(request, 'roleName', 'Role name')), risk: 'read-only', pagination: 'none' }
    case 'iam-create-user': return { service: 'iam', operation: request.operation, args: add('iam', 'create-user', '--user-name', inputString(request, 'userName', 'User name')), risk: 'write', pagination: 'none' }
    case 'iam-delete-user': return { service: 'iam', operation: request.operation, args: add('iam', 'delete-user', '--user-name', inputString(request, 'userName', 'User name')), risk: 'destructive', pagination: 'none' }
    case 'sts-get-caller-identity': return { service: 'sts', operation: request.operation, args: add('sts', 'get-caller-identity'), risk: 'read-only', pagination: 'none' }
    case 'lambda-list-functions': return { service: 'lambda', operation: request.operation, args: add('lambda', 'list-functions', '--max-items', limit, ...(token ? ['--starting-token', token] : [])), risk: 'read-only', pagination: 'next-token' }
    case 'lambda-get-function': return { service: 'lambda', operation: request.operation, args: add('lambda', 'get-function', '--function-name', inputString(request, 'functionName', 'Function name')), risk: 'read-only', pagination: 'none' }
    case 'lambda-delete-function': return { service: 'lambda', operation: request.operation, args: add('lambda', 'delete-function', '--function-name', inputString(request, 'functionName', 'Function name')), risk: 'destructive', pagination: 'none' }
    case 'cloudwatch-list-metrics': return { service: 'cloudwatch', operation: request.operation, args: add('cloudwatch', 'list-metrics', ...(optional(input(request).namespace, 'Namespace', 255) ? ['--namespace', optional(input(request).namespace, 'Namespace', 255)!] : [])), risk: 'read-only', pagination: 'none' }
    case 'cloudwatch-get-metric-data': return { service: 'cloudwatch', operation: request.operation, args: add('cloudwatch', 'get-metric-data', '--metric-data-queries', required(input(request).metricDataQueries, 'Metric data queries', 128_000), '--start-time', inputString(request, 'startTime', 'Start time'), '--end-time', inputString(request, 'endTime', 'End time')), risk: 'read-only', pagination: 'none' }
    case 'logs-describe-log-groups': return { service: 'logs', operation: request.operation, args: add('logs', 'describe-log-groups', '--limit', limit, ...(token ? ['--next-token', token] : [])), risk: 'read-only', pagination: 'next-token' }
    case 'logs-describe-log-streams': return { service: 'logs', operation: request.operation, args: add('logs', 'describe-log-streams', '--log-group-name', inputString(request, 'logGroupName', 'Log group name'), '--order-by', 'LastEventTime', '--descending'), risk: 'read-only', pagination: 'none' }
    case 'logs-get-log-events': return { service: 'logs', operation: request.operation, args: add('logs', 'get-log-events', '--log-group-name', inputString(request, 'logGroupName', 'Log group name'), '--log-stream-name', inputString(request, 'logStreamName', 'Log stream name'), '--limit', limit, ...(token ? ['--next-token', token] : [])), risk: 'read-only', pagination: 'next-token' }
    case 'logs-filter-log-events': return { service: 'logs', operation: request.operation, args: add('logs', 'filter-log-events', '--log-group-name', inputString(request, 'logGroupName', 'Log group name'), '--filter-pattern', inputString(request, 'filterPattern', 'Filter pattern'), '--limit', limit, ...(token ? ['--next-token', token] : [])), risk: 'read-only', pagination: 'next-token' }
  }
}

function rows(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const array = Object.values(payload).find((value) => Array.isArray(value))
  if (Array.isArray(array)) return array.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value))
  return [payload]
}

function nextToken(payload: Record<string, unknown>): string | null {
  for (const key of ['NextToken', 'nextToken', 'NextContinuationToken']) {
    if (typeof payload[key] === 'string' && payload[key].length <= 16_384) return payload[key] as string
  }
  return null
}

export class AwsCoreServicesManager implements AwsCoreApi {
  private readonly bindings: AtomicJsonArrayStore<AwsCoreBinding>
  private readonly running = new Map<string, RunningCommand>()
  private readonly cancelled = new Set<string>()
  private runtimeCache: { executable: string; status: AwsCoreRuntimeStatus } | null = null

  constructor(private readonly platform: CorePlatform) {
    this.bindings = new AtomicJsonArrayStore(join(platform.userDataDir, 'aws', 'core-service-bindings.json'))
  }

  private async resolveRuntime(): Promise<{ executable: string; status: AwsCoreRuntimeStatus }> {
    if (this.runtimeCache) return this.runtimeCache
    const candidates = [
      this.platform.resourcesPath ? join(this.platform.resourcesPath, 'aws-cli', process.platform === 'win32' ? 'aws.exe' : 'aws') : '',
      join(this.platform.userDataDir, 'aws-cli', process.platform === 'win32' ? 'aws.exe' : 'aws'),
      process.platform === 'win32' ? 'aws.exe' : 'aws'
    ].filter(Boolean)
    for (const executable of candidates) {
      try {
        if (executable.includes('/') || executable.includes('\\')) await access(executable)
        const result = await this.runRaw(executable, ['--version'])
        if (result.code === 0) {
          const version = result.stdout.trim().slice(0, 256)
          this.runtimeCache = { executable, status: { available: true, origin: executable.includes('aws-cli') ? 'bundled' : 'system', version, disabledReason: null } }
          return this.runtimeCache
        }
      } catch { /* next candidate */ }
    }
    this.runtimeCache = { executable: '', status: { available: false, origin: 'unavailable', version: null, disabledReason: 'AWS CLI v2 is unavailable. Install the bundled dependency before running an AWS operation.' } }
    return this.runtimeCache
  }

  private runRaw(executable: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = execFile(executable, args, { windowsHide: true, maxBuffer: MAX_OUTPUT_BYTES }, (error, stdout, stderr) => {
        resolve({ code: error ? (typeof (error as NodeJS.ErrnoException).code === 'number' ? (error as NodeJS.ErrnoException).code as number : 1) : 0, stdout: String(stdout), stderr: String(stderr) })
      })
    })
  }

  async runtime(): Promise<AwsCoreRuntimeStatus> { return (await this.resolveRuntime()).status }

  async profiles(): Promise<AwsCoreProfileChoice[]> {
    const runtime = await this.resolveRuntime()
    if (!runtime.status.available) return []
    const listed = await this.runRaw(runtime.executable, ['configure', 'list-profiles'])
    const names = [...new Set(listed.stdout.split(/\r?\n/).map((name) => name.trim()).filter(isAwsCoreProfile))].slice(0, 128)
    const profiles: AwsCoreProfileChoice[] = []
    for (const name of names) {
      const region = await this.runRaw(runtime.executable, ['configure', 'get', 'region', '--profile', name])
      profiles.push({ name, configuredRegion: isAwsCoreRegion(region.stdout.trim()) ? region.stdout.trim() : null })
    }
    return profiles
  }

  async binding(nodeId: string): Promise<AwsCoreBinding | null> {
    const item = (await this.bindings.read()).find((binding) => binding.nodeId === nodeId)
    return item && isAwsCoreProfile(item.profileName) && isAwsCoreRegion(item.region) ? item : null
  }

  async bind(inputValue: { nodeId: string; profileName: string; region: string; endpointUrl?: string | null }): Promise<AwsCoreBinding> {
    const nodeId = required(inputValue.nodeId, 'Node id', 256)
    const profileName = required(inputValue.profileName, 'Profile name', 128)
    const region = required(inputValue.region, 'Region', 64)
    if (!isAwsCoreProfile(profileName) || !isAwsCoreRegion(region)) throw new Error('Choose a valid AWS profile and region.')
    const binding: AwsCoreBinding = { nodeId, profileName, region, endpointUrl: endpoint(inputValue.endpointUrl), updatedAt: Date.now() }
    const existing = await this.bindings.read()
    await this.bindings.write([...existing.filter((item) => item.nodeId !== nodeId), binding])
    return binding
  }

  async unbind(nodeId: string): Promise<boolean> {
    const existing = await this.bindings.read()
    const next = existing.filter((item) => item.nodeId !== required(nodeId, 'Node id', 256))
    if (next.length === existing.length) return false
    await this.bindings.write(next)
    return true
  }

  private async specFor(nodeId: string, request: AwsCoreRequest): Promise<{ binding: AwsCoreBinding; runtime: { executable: string; status: AwsCoreRuntimeStatus }; spec: CommandSpec }> {
    const binding = await this.binding(nodeId)
    if (!binding) throw new Error('Configure this AWS manager with a local profile and region before running it.')
    const runtime = await this.resolveRuntime()
    if (!runtime.status.available) throw new Error(runtime.status.disabledReason ?? 'AWS CLI is unavailable.')
    return { binding, runtime, spec: operationSpec(request) }
  }

  async preview(nodeId: string, request: AwsCoreRequest): Promise<AwsCoreOperationPreview> {
    const { binding, spec } = await this.specFor(nodeId, request)
    const argv = ['--profile', binding.profileName, '--region', binding.region, ...spec.args]
    if (binding.endpointUrl) argv.push('--endpoint-url', binding.endpointUrl)
    return { service: spec.service, operation: spec.operation, profileName: binding.profileName, region: binding.region, endpointUrl: binding.endpointUrl, argv: argv.map((part) => part.includes('token') ? '<redacted>' : part), pagination: spec.pagination, risk: spec.risk, destructive: spec.risk === 'destructive' }
  }

  async execute(nodeId: string, request: AwsCoreRequest): Promise<AwsCoreResult> {
    const { binding, runtime, spec } = await this.specFor(nodeId, request)
    const operationId = randomUUID()
    const args = ['--profile', binding.profileName, '--region', binding.region, ...spec.args]
    if (binding.endpointUrl) args.push('--endpoint-url', binding.endpointUrl)
    this.platform.broadcast(IPC.awsCoreProgress, { operationId, nodeId, phase: 'started', message: 'AWS operation started.' } satisfies AwsCoreProgress)
    const child = execFile(runtime.executable, args, { windowsHide: true, maxBuffer: MAX_OUTPUT_BYTES })
    this.running.set(operationId, { child, nodeId })
    let stdout = ''
    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += String(chunk).slice(0, MAX_OUTPUT_BYTES - stdout.length)
    })
    return new Promise((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout>
      const finishError = (error: Error, phase: AwsCoreProgress['phase'] = 'failed'): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.running.delete(operationId)
        this.platform.broadcast(IPC.awsCoreProgress, { operationId, nodeId, phase, message: error.message } satisfies AwsCoreProgress)
        reject(error)
      }
      timer = setTimeout(() => { child.kill(); finishError(new Error('AWS operation timed out.')) }, COMMAND_TIMEOUT_MS)
      child.once('error', (error) => finishError(error instanceof Error ? error : new Error(String(error))))
      child.once('exit', (code, signal) => {
        if (settled) return
        if (this.cancelled.delete(operationId)) {
          clearTimeout(timer); settled = true; this.running.delete(operationId)
          reject(new Error('AWS operation cancelled.'))
          return
        }
        if (code !== 0) { finishError(new Error(signal ? `AWS operation stopped (${signal}).` : 'AWS operation was refused by the local CLI.')); return }
        clearTimeout(timer); settled = true; this.running.delete(operationId)
        let payload: Record<string, unknown>
        try { payload = JSON.parse(stdout) as Record<string, unknown> } catch { payload = {} }
        const result: AwsCoreResult = { operationId, service: spec.service, operation: spec.operation, rows: rows(payload), nextToken: nextToken(payload), summary: `${spec.service} operation completed.`, completedAt: Date.now() }
        this.platform.broadcast(IPC.awsCoreProgress, { operationId, nodeId, phase: 'completed', message: result.summary } satisfies AwsCoreProgress)
        resolve(result)
      })
    })
  }

  async cancel(operationId: string): Promise<boolean> {
    const running = this.running.get(operationId)
    if (!running) return false
    running.child.kill()
    this.cancelled.add(operationId)
    this.running.delete(operationId)
    this.platform.broadcast(IPC.awsCoreProgress, { operationId, nodeId: running.nodeId, phase: 'cancelled', message: 'AWS operation cancelled.' } satisfies AwsCoreProgress)
    return true
  }

  onProgress(_listener: (progress: AwsCoreProgress) => void): () => void { return () => undefined }
}

export async function ensureAwsCoreDataDir(platform: CorePlatform): Promise<void> {
  await mkdir(join(platform.userDataDir, 'aws'), { recursive: true })
}
