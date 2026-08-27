/**
 * Typed Cloudflare manager contracts for Access, Zero Trust, Workers, Pages, R2, D1 and Queues.
 *
 * The renderer receives only these bounded models. API credentials, account ids, resource ids,
 * request state and machine paths stay in the trusted core's local binding store. Operations are
 * a fixed allowlist: callers cannot provide an arbitrary endpoint, method, shell command or body.
 */

export const CLOUDFLARE_ZERO_TRUST_SCHEMA_VERSION = 1 as const
export const CLOUDFLARE_MAX_TEXT = 4_096
export const CLOUDFLARE_MAX_RESOURCES = 2_000
export const CLOUDFLARE_MAX_RESULT_BYTES = 8 * 1024 * 1024

export type CloudflareManagerKind = 'access' | 'zero-trust' | 'workers' | 'pages' | 'r2' | 'd1' | 'queues'
export type CloudflareRisk = 'read' | 'write' | 'destructive'
export type CloudflareFieldKind = 'text' | 'enum' | 'boolean' | 'integer' | 'file'

export interface CloudflareFieldModel {
  id: string
  label: string
  description: string
  kind: CloudflareFieldKind
  required: boolean
  sensitive?: boolean
  portable?: boolean
  placeholder?: string
  choices?: readonly { value: string; label: string; description?: string }[]
  minimum?: number
  maximum?: number
}
export interface CloudflareOperationModel {
  id: string
  label: string
  description: string
  risk: CloudflareRisk
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** A fixed route key interpreted only by the core allowlist. */
  route: string
  fields: readonly CloudflareFieldModel[]
  resultKind: 'list' | 'single' | 'empty'
}

export interface CloudflareManagerModel {
  id: CloudflareManagerKind
  label: string
  description: string
  operations: readonly CloudflareOperationModel[]
}

export interface CloudflareCatalog {
  schemaVersion: typeof CLOUDFLARE_ZERO_TRUST_SCHEMA_VERSION
  apiVersion: string
  managers: readonly CloudflareManagerModel[]
}

/** Safe project-file intent. It contains no account identity, credential or local path. */
export interface CloudflarePortableIntent {
  schemaVersion: typeof CLOUDFLARE_ZERO_TRUST_SCHEMA_VERSION
  manager: CloudflareManagerKind | null
  operation: string | null
  accountHint: string | null
  resourceHint: string | null
  values: Record<string, string | number | boolean>
}

/** Machine-local binding. `accountId` and `credentialRef` never enter project.json. */
export interface CloudflareLocalBinding {
  accountId?: string
  credentialRef?: string
}

export interface CloudflareAccountSummary {
  id: string
  label: string
  accountId: string
  credentialStored: boolean
  state: 'connected' | 'unavailable'
  reason: string | null
}

export interface CloudflareAccountInput {
  id?: string
  label: string
  accountId: string
  apiToken: string
}

export interface CloudflareResourceSummary {
  id: string
  label: string
  kind: CloudflareManagerKind
  metadata: Readonly<Record<string, string | number | boolean>>
}

export interface CloudflareExecutionPreview {
  manager: CloudflareManagerKind
  operation: string
  accountId: string
  method: CloudflareOperationModel['method']
  route: string
  risk: CloudflareRisk
  fields: Readonly<Record<string, string | number | boolean>>
  omissions: readonly string[]
  confirmed: boolean
}

export interface CloudflareExecutionRequest {
  intent: CloudflarePortableIntent
  preview: CloudflareExecutionPreview
  localFiles: Readonly<Record<string, string>>
}

export interface CloudflareExecutionProgress {
  phase: 'preparing' | 'running' | 'retrying' | 'complete' | 'failed' | 'cancelled'
  message: string
  completed?: number
  total?: number
  partialResults?: number
}

export interface CloudflareExecutionResult {
  summary: string
  resultCount: number
  outputPreview?: string
}

export interface CloudflareApi {
  catalog(): Promise<CloudflareCatalog>
  accounts(): Promise<readonly CloudflareAccountSummary[]>
  configure(input: CloudflareAccountInput): Promise<CloudflareAccountSummary>
  removeAccount(id: string): Promise<{ ok: true } | { ok: false; error: string }>
  binding(nodeId: string): Promise<CloudflareLocalBinding>
  saveBinding(nodeId: string, binding: CloudflareLocalBinding): Promise<void>
  resources(nodeId: string, manager: CloudflareManagerKind): Promise<readonly CloudflareResourceSummary[]>
  execute(nodeId: string, request: CloudflareExecutionRequest, onProgress: (progress: CloudflareExecutionProgress) => void): Promise<CloudflareExecutionResult>
  cancel(nodeId: string): Promise<void>
  onProgress(listener: (value: CloudflareExecutionProgress & { nodeId: string }) => void): () => void
}

export const CLOUDFLARE_MANAGER_CATALOG: readonly CloudflareManagerModel[] = [
  {
    id: 'access', label: 'Cloudflare Access',
    description: 'Review and manage Access applications with explicit policy-safe actions.',
    operations: [
      { id: 'list-applications', label: 'List applications', description: 'Read Access applications for the selected account.', risk: 'read', method: 'GET', route: 'access-applications', fields: [], resultKind: 'list' },
      { id: 'create-application', label: 'Create application', description: 'Create an Access application from typed name and domain values.', risk: 'write', method: 'POST', route: 'access-applications', fields: [textField('name', 'Application name', 'A display name for the Access application.'), textField('domain', 'Application domain', 'A hostname protected by this application.')], resultKind: 'single' },
      { id: 'delete-application', label: 'Delete application', description: 'Delete one listed Access application after review.', risk: 'destructive', method: 'DELETE', route: 'access-application', fields: [textField('applicationId', 'Application', 'Choose an application from the verified account list.')], resultKind: 'empty' }
    ]
  },
  {
    id: 'zero-trust', label: 'Cloudflare Zero Trust',
    description: 'Review and manage Zero Trust policies using typed decisions and verified resources.',
    operations: [
      { id: 'list-policies', label: 'List policies', description: 'Read Zero Trust access policies for the selected account.', risk: 'read', method: 'GET', route: 'zero-trust-policies', fields: [], resultKind: 'list' },
      { id: 'create-policy', label: 'Create policy', description: 'Create a policy with a typed name and decision.', risk: 'write', method: 'POST', route: 'zero-trust-policies', fields: [textField('name', 'Policy name', 'A display name for the policy.'), enumField('decision', 'Decision', 'The decision applied by this policy.', [{ value: 'allow', label: 'Allow' }, { value: 'deny', label: 'Deny' }, { value: 'bypass', label: 'Bypass' }])], resultKind: 'single' },
      { id: 'delete-policy', label: 'Delete policy', description: 'Delete one listed policy after review.', risk: 'destructive', method: 'DELETE', route: 'zero-trust-policy', fields: [textField('policyId', 'Policy', 'Choose a policy from the verified account list.')], resultKind: 'empty' }
    ]
  },
  {
    id: 'workers', label: 'Cloudflare Workers',
    description: 'Inspect and deploy Workers from a selected local file, never an arbitrary command.',
    operations: [
      { id: 'list-scripts', label: 'List scripts', description: 'Read Worker scripts and deployment metadata.', risk: 'read', method: 'GET', route: 'workers-scripts', fields: [], resultKind: 'list' },
      { id: 'deploy-script', label: 'Deploy script', description: 'Upload one selected local script file to a named Worker.', risk: 'write', method: 'PUT', route: 'worker-script', fields: [textField('scriptName', 'Worker name', 'Choose a Worker name from the account or enter a validated new name.'), fileField('scriptFile', 'Script file', 'Choose a local JavaScript or module file. Only the selected bytes are read.')], resultKind: 'single' },
      { id: 'delete-script', label: 'Delete script', description: 'Delete one listed Worker script after review.', risk: 'destructive', method: 'DELETE', route: 'worker-script', fields: [textField('scriptName', 'Worker', 'Choose a Worker from the verified account list.')], resultKind: 'empty' }
    ]
  },
  {
    id: 'pages', label: 'Cloudflare Pages',
    description: 'Review Pages projects and create or remove projects through typed fields.',
    operations: [
      { id: 'list-projects', label: 'List projects', description: 'Read Pages projects for the selected account.', risk: 'read', method: 'GET', route: 'pages-projects', fields: [], resultKind: 'list' },
      { id: 'create-project', label: 'Create project', description: 'Create a Pages project with a name and production branch.', risk: 'write', method: 'POST', route: 'pages-projects', fields: [textField('name', 'Project name', 'A Pages project name.'), textField('productionBranch', 'Production branch', 'The source branch used for production deployments.')], resultKind: 'single' },
      { id: 'delete-project', label: 'Delete project', description: 'Delete one listed Pages project after review.', risk: 'destructive', method: 'DELETE', route: 'pages-project', fields: [textField('projectName', 'Project', 'Choose a project from the verified account list.')], resultKind: 'empty' }
    ]
  },
  {
    id: 'r2', label: 'Cloudflare R2',
    description: 'Review and manage R2 buckets with explicit names and location choices.',
    operations: [
      { id: 'list-buckets', label: 'List buckets', description: 'Read R2 buckets for the selected account.', risk: 'read', method: 'GET', route: 'r2-buckets', fields: [], resultKind: 'list' },
      { id: 'create-bucket', label: 'Create bucket', description: 'Create a bucket with a typed name and jurisdiction.', risk: 'write', method: 'POST', route: 'r2-buckets', fields: [textField('name', 'Bucket name', 'An R2 bucket name.'), enumField('location', 'Location', 'R2 jurisdiction for this bucket.', [{ value: 'wnam', label: 'Western North America' }, { value: 'enam', label: 'Eastern North America' }, { value: 'eeur', label: 'Eastern Europe' }, { value: 'apac', label: 'Asia Pacific' }])], resultKind: 'single' },
      { id: 'delete-bucket', label: 'Delete bucket', description: 'Delete one listed bucket after review.', risk: 'destructive', method: 'DELETE', route: 'r2-bucket', fields: [textField('name', 'Bucket', 'Choose a bucket from the verified account list.')], resultKind: 'empty' }
    ]
  },
  {
    id: 'd1', label: 'Cloudflare D1',
    description: 'Review and manage D1 databases with bounded typed metadata.',
    operations: [
      { id: 'list-databases', label: 'List databases', description: 'Read D1 databases for the selected account.', risk: 'read', method: 'GET', route: 'd1-databases', fields: [], resultKind: 'list' },
      { id: 'create-database', label: 'Create database', description: 'Create a D1 database with a typed name.', risk: 'write', method: 'POST', route: 'd1-databases', fields: [textField('name', 'Database name', 'A D1 database name.')], resultKind: 'single' },
      { id: 'delete-database', label: 'Delete database', description: 'Delete one listed database after review.', risk: 'destructive', method: 'DELETE', route: 'd1-database', fields: [textField('databaseId', 'Database', 'Choose a database from the verified account list.')], resultKind: 'empty' }
    ]
  },
  {
    id: 'queues', label: 'Cloudflare Queues',
    description: 'Review and manage Queues with typed names and explicit purge confirmation.',
    operations: [
      { id: 'list-queues', label: 'List queues', description: 'Read Queues for the selected account.', risk: 'read', method: 'GET', route: 'queues', fields: [], resultKind: 'list' },
      { id: 'create-queue', label: 'Create queue', description: 'Create a queue from a typed name.', risk: 'write', method: 'POST', route: 'queues', fields: [textField('queueName', 'Queue name', 'A Queue name.')], resultKind: 'single' },
      { id: 'delete-queue', label: 'Delete queue', description: 'Delete one listed queue after review.', risk: 'destructive', method: 'DELETE', route: 'queue', fields: [textField('queueName', 'Queue', 'Choose a queue from the verified account list.')], resultKind: 'empty' },
      { id: 'purge-queue', label: 'Purge queue', description: 'Purge queued messages after review. This cannot be undone.', risk: 'destructive', method: 'POST', route: 'queue-purge', fields: [textField('queueName', 'Queue', 'Choose a queue from the verified account list.'), booleanField('confirmPurge', 'Confirm purge', 'The review surface must explicitly confirm that queued messages will be removed.')], resultKind: 'empty' }
    ]
  }
]

function textField(id: string, label: string, description: string): CloudflareFieldModel {
  return { id, label, description, kind: 'text', required: true, portable: true, placeholder: label }
}
function fileField(id: string, label: string, description: string): CloudflareFieldModel {
  return { id, label, description, kind: 'file', required: true, portable: false }
}
function enumField(id: string, label: string, description: string, choices: readonly { value: string; label: string }[]): CloudflareFieldModel {
  return { id, label, description, kind: 'enum', required: true, portable: true, choices }
}
function booleanField(id: string, label: string, description: string): CloudflareFieldModel {
  return { id, label, description, kind: 'boolean', required: true, portable: true }
}

export const CLOUDFLARE_CATALOG: CloudflareCatalog = {
  schemaVersion: CLOUDFLARE_ZERO_TRUST_SCHEMA_VERSION,
  apiVersion: 'v4',
  managers: CLOUDFLARE_MANAGER_CATALOG
}

export function emptyCloudflarePortableIntent(): CloudflarePortableIntent {
  return { schemaVersion: CLOUDFLARE_ZERO_TRUST_SCHEMA_VERSION, manager: null, operation: null, accountHint: null, resourceHint: null, values: {} }
}

export function managerById(manager: CloudflareManagerKind | null): CloudflareManagerModel | null {
  return manager ? CLOUDFLARE_MANAGER_CATALOG.find((entry) => entry.id === manager) ?? null : null
}

export function operationById(manager: CloudflareManagerKind | null, operation: string | null): CloudflareOperationModel | null {
  if (!manager || !operation) return null
  return managerById(manager)?.operations.find((entry) => entry.id === operation) ?? null
}

export function validateCloudflareValue(field: CloudflareFieldModel, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return field.required ? `${field.label} is required.` : null
  if (field.kind === 'file') return typeof value === 'string' ? null : `${field.label} must be chosen with the file picker.`
  if (field.kind === 'boolean') return typeof value === 'boolean' ? null : `${field.label} must be on or off.`
  if (field.kind === 'integer') return typeof value === 'number' && Number.isSafeInteger(value) ? null : `${field.label} must be a whole number.`
  if (typeof value !== 'string' || value.length > CLOUDFLARE_MAX_TEXT || /[\u0000-\u001f\u007f]/u.test(value)) return `${field.label} is invalid or too long.`
  if (field.kind === 'enum' && !field.choices?.some((choice) => choice.value === value)) return `Choose a listed value for ${field.label}.`
  return null
}

export function normalizeCloudflareIntent(input: unknown): CloudflarePortableIntent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const value = input as Record<string, unknown>
  const manager = CLOUDFLARE_MANAGER_CATALOG.some((entry) => entry.id === value.manager) ? value.manager as CloudflareManagerKind : null
  const operation = typeof value.operation === 'string' && operationById(manager, value.operation) ? value.operation : null
  const hint = (candidate: unknown): string | null => typeof candidate === 'string' && candidate.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(candidate) ? candidate : null
  const values: Record<string, string | number | boolean> = {}
  if (value.values && typeof value.values === 'object' && !Array.isArray(value.values)) {
    for (const [key, candidate] of Object.entries(value.values)) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(key)) continue
      if (typeof candidate === 'string' && candidate.length <= CLOUDFLARE_MAX_TEXT && !/[\u0000-\u001f\u007f]/u.test(candidate)) values[key] = candidate
      else if (typeof candidate === 'boolean') values[key] = candidate
      else if (typeof candidate === 'number' && Number.isSafeInteger(candidate)) values[key] = candidate
    }
  }
  return { schemaVersion: CLOUDFLARE_ZERO_TRUST_SCHEMA_VERSION, manager, operation, accountHint: hint(value.accountHint), resourceHint: hint(value.resourceHint), values }
}
