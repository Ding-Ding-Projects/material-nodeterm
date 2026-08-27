/**
 * Guided AWS core-service manager contract.
 *
 * Only portable intent belongs on a canvas node. AWS profiles, account bindings, role sessions,
 * endpoint bindings, command output, request tokens, and credentials remain in the local host
 * overlay. The operation catalogue is deliberately explicit so the renderer never has to accept
 * a shell command or an untyped argument vector from a user.
 */

export const AWS_CORE_SERVICES = [
  's3',
  'ec2',
  'iam',
  'sts',
  'lambda',
  'cloudwatch',
  'logs'
] as const

export type AwsCoreServiceId = (typeof AWS_CORE_SERVICES)[number]

export type AwsCoreOperation =
  | 's3-list-buckets' | 's3-list-objects' | 's3-create-bucket' | 's3-delete-bucket'
  | 'ec2-describe-instances' | 'ec2-describe-security-groups' | 'ec2-start-instances' | 'ec2-stop-instances' | 'ec2-terminate-instances'
  | 'iam-list-users' | 'iam-list-roles' | 'iam-get-user' | 'iam-get-role' | 'iam-create-user' | 'iam-delete-user'
  | 'sts-get-caller-identity'
  | 'lambda-list-functions' | 'lambda-get-function' | 'lambda-delete-function'
  | 'cloudwatch-list-metrics' | 'cloudwatch-get-metric-data'
  | 'logs-describe-log-groups' | 'logs-describe-log-streams' | 'logs-get-log-events' | 'logs-filter-log-events'

export type AwsCoreRisk = 'read-only' | 'write' | 'destructive'

export interface AwsCorePortableIntent {
  schemaVersion: 1
  service: AwsCoreServiceId
  operation: AwsCoreOperation
  regionIntent: string
  /** Safe operation fields only. It never contains a profile, endpoint, path, token, or secret. */
  input: Record<string, string | number | boolean>
}

export interface AwsCoreBinding {
  nodeId: string
  profileName: string
  region: string
  endpointUrl: string | null
  updatedAt: number
}

export interface AwsCoreRuntimeStatus {
  available: boolean
  origin: 'bundled' | 'system' | 'unavailable'
  version: string | null
  disabledReason: string | null
}

export interface AwsCoreProfileChoice {
  name: string
  configuredRegion: string | null
}

export interface AwsCoreOperationPreview {
  service: AwsCoreServiceId
  operation: AwsCoreOperation
  profileName: string
  region: string
  endpointUrl: string | null
  argv: string[]
  pagination: 'none' | 'next-token'
  risk: AwsCoreRisk
  destructive: boolean
}

export interface AwsCoreRequest {
  service: AwsCoreServiceId
  operation: AwsCoreOperation
  input?: Record<string, unknown>
  nextToken?: string
  maxResults?: number
}

export interface AwsCoreResult {
  operationId: string
  service: AwsCoreServiceId
  operation: AwsCoreOperation
  rows: Array<Record<string, unknown>>
  nextToken: string | null
  summary: string
  completedAt: number
}

export interface AwsCoreProgress {
  operationId: string
  nodeId: string
  phase: 'started' | 'completed' | 'cancelled' | 'failed'
  message: string
}

export interface AwsCoreApi {
  runtime(): Promise<AwsCoreRuntimeStatus>
  profiles(): Promise<AwsCoreProfileChoice[]>
  binding(nodeId: string): Promise<AwsCoreBinding | null>
  bind(input: { nodeId: string; profileName: string; region: string; endpointUrl?: string | null }): Promise<AwsCoreBinding>
  unbind(nodeId: string): Promise<boolean>
  preview(nodeId: string, request: AwsCoreRequest): Promise<AwsCoreOperationPreview>
  execute(nodeId: string, request: AwsCoreRequest): Promise<AwsCoreResult>
  cancel(operationId: string): Promise<boolean>
  onProgress(listener: (progress: AwsCoreProgress) => void): () => void
}

export const AWS_CORE_DEFAULT_INTENT: AwsCorePortableIntent = {
  schemaVersion: 1,
  service: 's3',
  operation: 's3-list-buckets',
  regionIntent: 'us-east-1',
  input: {}
}

const REGION_RE = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/
const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9_.@+-]{0,127}$/
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/

export function isAwsCoreRegion(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length <= 64 && REGION_RE.test(value.trim())
}

export function isAwsCoreProfile(value: unknown): value is string {
  return typeof value === 'string' && PROFILE_RE.test(value.trim())
}

export function isAwsCoreName(value: unknown): value is string {
  return typeof value === 'string' && NAME_RE.test(value.trim())
}

export function normalizeAwsCoreIntent(value: unknown): AwsCorePortableIntent {
  if (!value || typeof value !== 'object') return { ...AWS_CORE_DEFAULT_INTENT, input: {} }
  const raw = value as Record<string, unknown>
  const service = AWS_CORE_SERVICES.includes(raw.service as AwsCoreServiceId) ? raw.service as AwsCoreServiceId : 's3'
  const operations = AWS_CORE_OPERATIONS_BY_SERVICE[service]
  const operation = operations.includes(raw.operation as AwsCoreOperation) ? raw.operation as AwsCoreOperation : operations[0]
  const input: Record<string, string | number | boolean> = {}
  if (raw.input && typeof raw.input === 'object' && !Array.isArray(raw.input)) {
    for (const [key, value] of Object.entries(raw.input as Record<string, unknown>).slice(0, 32)) {
      if ((typeof value === 'string' && value.length <= 2048) || typeof value === 'number' || typeof value === 'boolean') input[key] = value as string | number | boolean
    }
  }
  return {
    schemaVersion: 1,
    service,
    operation,
    regionIntent: isAwsCoreRegion(raw.regionIntent) ? raw.regionIntent.trim() : AWS_CORE_DEFAULT_INTENT.regionIntent,
    input
  }
}

export const AWS_CORE_OPERATIONS_BY_SERVICE: Record<AwsCoreServiceId, readonly AwsCoreOperation[]> = {
  s3: ['s3-list-buckets', 's3-list-objects', 's3-create-bucket', 's3-delete-bucket'],
  ec2: ['ec2-describe-instances', 'ec2-describe-security-groups', 'ec2-start-instances', 'ec2-stop-instances', 'ec2-terminate-instances'],
  iam: ['iam-list-users', 'iam-list-roles', 'iam-get-user', 'iam-get-role', 'iam-create-user', 'iam-delete-user'],
  sts: ['sts-get-caller-identity'],
  lambda: ['lambda-list-functions', 'lambda-get-function', 'lambda-delete-function'],
  cloudwatch: ['cloudwatch-list-metrics', 'cloudwatch-get-metric-data'],
  logs: ['logs-describe-log-groups', 'logs-describe-log-streams', 'logs-get-log-events', 'logs-filter-log-events']
}

export const AWS_CORE_OPERATION_LABELS: Record<AwsCoreOperation, string> = {
  's3-list-buckets': 'List buckets', 's3-list-objects': 'List objects', 's3-create-bucket': 'Create bucket', 's3-delete-bucket': 'Delete bucket',
  'ec2-describe-instances': 'Describe instances', 'ec2-describe-security-groups': 'Describe security groups', 'ec2-start-instances': 'Start instances', 'ec2-stop-instances': 'Stop instances', 'ec2-terminate-instances': 'Terminate instances',
  'iam-list-users': 'List users', 'iam-list-roles': 'List roles', 'iam-get-user': 'Get user', 'iam-get-role': 'Get role', 'iam-create-user': 'Create user', 'iam-delete-user': 'Delete user',
  'sts-get-caller-identity': 'Get caller identity',
  'lambda-list-functions': 'List functions', 'lambda-get-function': 'Get function', 'lambda-delete-function': 'Delete function',
  'cloudwatch-list-metrics': 'List metrics', 'cloudwatch-get-metric-data': 'Get metric data',
  'logs-describe-log-groups': 'Describe log groups', 'logs-describe-log-streams': 'Describe log streams', 'logs-get-log-events': 'Get log events', 'logs-filter-log-events': 'Filter log events'
}

export const AWS_CORE_SERVICE_LABELS: Record<AwsCoreServiceId, string> = {
  s3: 'S3', ec2: 'EC2', iam: 'IAM', sts: 'STS', lambda: 'Lambda', cloudwatch: 'CloudWatch', logs: 'CloudWatch Logs'
}
