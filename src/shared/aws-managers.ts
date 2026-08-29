/**
 * Shared contracts for the guided AWS managers.
 *
 * These types are deliberately provider-shaped rather than shell-shaped. A project can persist
 * the operation intent and its safe defaults, but never an executable command, profile secret,
 * session token, local credential file, or host path. The trusted core turns a selected schema into
 * a typed request for the installed AWS CLI/API transport.
 */

export const AWS_MANAGER_SERVICES = [
  's3',
  'ec2',
  'iam',
  'sts',
  'lambda',
  'cloudwatch',
  'logs'
] as const

export type AwsManagerService = (typeof AWS_MANAGER_SERVICES)[number]

export type AwsFieldKind =
  | 'string'
  | 'enum'
  | 'boolean'
  | 'integer'
  | 'number'
  | 'date-time'
  | 'file'
  | 'json'
  | 'list'
  | 'map'
  | 'object'

export interface AwsEnumOption {
  value: string
  label: string
  description?: string
  disabledReason?: string
}

export interface AwsFieldSchema {
  key: string
  label: string
  kind: AwsFieldKind
  required?: boolean
  description: string
  sensitive?: boolean
  min?: number
  max?: number
  maxLength?: number
  pattern?: string
  options?: readonly AwsEnumOption[]
  item?: AwsFieldSchema
  fields?: readonly AwsFieldSchema[]
  /** A safe, non-secret value used by the guided form. */
  defaultValue?: unknown
  /** Names the native picker the UI must use for this field. */
  picker?: 'file' | 'folder' | 'region' | 'profile' | 'resource'
}

export interface AwsPaginationSchema {
  inputToken: string
  outputToken: string
  pageSizeKey?: string
  maxPages: number
}

export interface AwsWaiterSchema {
  name: string
  acceptors: readonly {
    state: 'success' | 'failure' | 'retry'
    matcher: 'path' | 'pathAll' | 'pathAny' | 'status'
    argument?: string
    expected?: unknown
  }[]
  delayMs: number
  maxAttempts: number
}

export interface AwsStreamSchema {
  /** The response member that yields records, when the operation is streamable. */
  eventMember: string
  /** Maximum records retained in memory for one operation. */
  maxRecords: number
  /** Maximum bytes retained in one record. */
  maxRecordBytes: number
}

export interface AwsOperationSchema {
  id: string
  service: AwsManagerService
  label: string
  description: string
  input: readonly AwsFieldSchema[]
  output: readonly AwsFieldSchema[]
  pagination?: AwsPaginationSchema
  waiter?: AwsWaiterSchema
  stream?: AwsStreamSchema
  requiredPermissions: readonly string[]
  destructive: boolean
  supportsBulk: boolean
  /** A safe operation has no secret or machine path in its portable representation. */
  portableIntent: {
    allowedFields: readonly string[]
    omittedFields: readonly string[]
  }
}

export interface AwsManagerDescriptor {
  service: AwsManagerService
  label: string
  description: string
  operations: readonly AwsOperationSchema[]
  searchTerms: readonly string[]
}

export interface AwsPortableManagerIntent {
  schemaVersion: 1
  service: AwsManagerService
  operationId: string
  safeInput: Record<string, unknown>
  omitted: readonly string[]
}

export interface AwsExecutionTarget {
  region: string
  profileId?: string
  roleArn?: string
  endpointUrl?: string
}

export interface AwsExecutionRequest {
  requestId: string
  operationId: string
  service: AwsManagerService
  input: Record<string, unknown>
  target: AwsExecutionTarget
  /** A caller-provided cancellation signal is required for long operations. */
  signal?: AbortSignal
  /** Destructive calls must carry the exact nonce returned by preview(). */
  confirmationNonce?: string
}

export interface AwsProgressEvent {
  requestId: string
  phase: 'validating' | 'authorizing' | 'running' | 'page' | 'record' | 'waiting' | 'retrying' | 'done' | 'cancelled'
  completed: number
  total?: number
  message: string
}

export interface AwsPage<T = unknown> {
  items: readonly T[]
  nextToken?: string
  pageNumber: number
}

export interface AwsExecutionResult<T = unknown> {
  requestId: string
  service: AwsManagerService
  operationId: string
  pages: readonly AwsPage<T>[]
  partial: boolean
  cancelled: boolean
  retries: number
}

export interface AwsPermissionResult {
  allowed: boolean
  missing: readonly string[]
  reason?: string
}

export interface AwsDestructivePreview {
  requestId: string
  operationId: string
  service: AwsManagerService
  affected: readonly string[]
  input: Record<string, unknown>
  permissions: readonly string[]
  confirmationNonce: string
  expiresAt: number
}

export interface AwsBulkItemResult<T = unknown> {
  itemId: string
  result?: AwsExecutionResult<T>
  error?: string
  status: 'completed' | 'failed' | 'cancelled' | 'skipped'
}

export interface AwsBulkExecutionResult<T = unknown> {
  requestId: string
  items: readonly AwsBulkItemResult<T>[]
  completed: number
  failed: number
  cancelled: number
  partial: boolean
}

export interface AwsManagerApi {
  catalog(): Promise<readonly AwsManagerDescriptor[]>
  execute<T = unknown>(request: AwsExecutionRequest): Promise<AwsExecutionResult<T>>
  stream<T = unknown>(request: AwsExecutionRequest): AsyncIterable<AwsProgressEvent | T>
  previewDestructive(request: AwsExecutionRequest): Promise<AwsDestructivePreview>
  bulk<T = unknown>(requests: readonly AwsExecutionRequest[], signal?: AbortSignal): Promise<AwsBulkExecutionResult<T>>
  permission(service: AwsManagerService, permissions: readonly string[], target: AwsExecutionTarget): Promise<AwsPermissionResult>
}
