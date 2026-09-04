/**
 * Typed AWS manager contracts shared by the Electron shell, Server Edition, and renderer.
 *
 * The renderer never receives credentials or an arbitrary command string. It selects one of the
 * registered service operations below and sends a validated, JSON-shaped form value to the trusted
 * core executor. The executor owns pagination, waiters, output parsing, and streaming status.
 */

export const AWS_SERVICE_KINDS = ['ecr', 'ecs', 'eks', 'rds', 'database', 'vpc', 'route53', 'cost'] as const
export type AwsServiceKind = (typeof AWS_SERVICE_KINDS)[number]

export const AWS_SERVICE_LABELS: Record<AwsServiceKind, string> = {
  ecr: 'Elastic Container Registry',
  ecs: 'Elastic Container Service',
  eks: 'Elastic Kubernetes Service',
  rds: 'Relational Database Service',
  database: 'Database inventory',
  vpc: 'Virtual Private Cloud',
  route53: 'Route 53',
  cost: 'Cost Explorer'
}

export type AwsOperationRisk = 'read' | 'write' | 'destructive'
export type AwsFieldType = 'text' | 'enum' | 'boolean' | 'number' | 'date' | 'time' | 'file' | 'list' | 'map'

export interface AwsFieldSpec {
  key: string
  label: string
  type: AwsFieldType
  required?: boolean
  description: string
  options?: Array<{ value: string; label: string }>
  min?: number
  max?: number
  pattern?: string
  item?: AwsFieldSpec
  value?: AwsFieldSpec
}

export interface AwsOperationSpec {
  id: string
  service: AwsServiceKind
  label: string
  description: string
  risk: AwsOperationRisk
  apiOperation: string
  fields: AwsFieldSpec[]
  paginated?: boolean
  waiter?: { name: string; terminalStates: string[]; timeoutMs: number; intervalMs: number }
  /** The trusted executor builds this operation's argv from the typed values, never user text. */
  output: 'table' | 'json' | 'stream'
}

export interface AwsResourceRecord {
  id: string
  service: AwsServiceKind
  kind: string
  name: string
  status: string
  region: string
  arn?: string
  properties: Record<string, string | number | boolean | null>
  /** The provider may omit fields for a partial permission response. */
  partial?: boolean
  detail?: string
}

export interface AwsPermissionState {
  state: 'granted' | 'partial' | 'denied' | 'unavailable'
  missingActions: string[]
  detail: string
}

export interface AwsInventoryRequest {
  service: AwsServiceKind
  region: string
  profile?: string
  query?: string
  pageSize?: number
  continuationToken?: string
  page?: number
}

export interface AwsInventoryPage {
  service: AwsServiceKind
  items: AwsResourceRecord[]
  nextToken: string | null
  page: number
  complete: boolean
  permission: AwsPermissionState
  fetchedAt: number
}

export interface AwsExecutionContext {
  region: string
  profile?: string
  endpointUrl?: string
}

export interface AwsOperationInput {
  operationId: string
  context: AwsExecutionContext
  values: Record<string, unknown>
}

export interface AwsExecutionPreview {
  operation: AwsOperationSpec
  context: AwsExecutionContext
  argv: string[]
  risk: AwsOperationRisk
  pagination: { enabled: boolean; pageSize: number; maxPages: number }
  waiter: AwsOperationSpec['waiter'] | null
  credentialSource: 'local-profile' | 'environment' | 'unavailable'
  warnings: string[]
}

export interface AwsBulkPreview {
  operation: AwsOperationSpec
  selectedIds: string[]
  affectedCount: number
  skipped: Array<{ id: string; reason: string }>
  requiresConfirmation: boolean
  summary: string
}

export type AwsEvent =
  | { kind: 'started'; operationId: string; at: number; message: string }
  | { kind: 'page'; operationId: string; page: number; received: number; at: number }
  | { kind: 'progress'; operationId: string; completed: number; total: number | null; at: number }
  | { kind: 'waiting'; operationId: string; state: string; at: number }
  | { kind: 'partial'; operationId: string; completed: number; failed: number; at: number; detail: string }
  | { kind: 'completed'; operationId: string; at: number; message: string }
  | { kind: 'failed'; operationId: string; at: number; error: string }

export interface AwsApi {
  catalog(): Promise<AwsOperationSpec[]>
  forms(service?: AwsServiceKind): Promise<AwsOperationSpec[]>
  inventory(request: AwsInventoryRequest): Promise<AwsInventoryPage>
  preview(input: AwsOperationInput): Promise<AwsExecutionPreview>
  execute(input: AwsOperationInput): Promise<{ ok: boolean; output: unknown; permission: AwsPermissionState }>
  cancel(operationId: string): Promise<boolean>
  bulkPreview(input: AwsOperationInput, selectedIds: string[]): Promise<AwsBulkPreview>
  bulkExecute(input: AwsOperationInput, selectedIds: string[]): Promise<{ ok: boolean; completed: string[]; failed: Array<{ id: string; error: string }> }>
  status(): Promise<{ available: boolean; cliVersion: string | null; profile: string | null; region: string | null; detail: string | null; checkedAt: number }>
  onEvent(listener: (event: AwsEvent) => void): () => void
}

export function isAwsServiceKind(value: string | undefined): value is AwsServiceKind {
  return typeof value === 'string' && (AWS_SERVICE_KINDS as readonly string[]).includes(value)
}

const requiredText = (key: string, label: string, description: string): AwsFieldSpec => ({ key, label, type: 'text', required: true, description })
const region = requiredText('region', 'Region', 'The AWS region where this operation runs.')

/** Hand-authored forms for the lane's common operations. The CLI model index can extend this list. */
export const AWS_OPERATION_CATALOG: AwsOperationSpec[] = [
  { id: 'ecr.listRepositories', service: 'ecr', label: 'List repositories', description: 'Inventory container repositories with pagination.', risk: 'read', apiOperation: 'describe-repositories', fields: [region], paginated: true, output: 'table' },
  { id: 'ecr.deleteRepository', service: 'ecr', label: 'Delete repository', description: 'Delete one ECR repository after a reviewable preview.', risk: 'destructive', apiOperation: 'delete-repository', fields: [region, requiredText('repositoryName', 'Repository name', 'Choose a repository from the inventory.')], output: 'json' },
  { id: 'ecs.listClusters', service: 'ecs', label: 'List clusters', description: 'Inventory ECS clusters with pagination.', risk: 'read', apiOperation: 'list-clusters', fields: [region], paginated: true, output: 'table' },
  { id: 'ecs.listServices', service: 'ecs', label: 'List services', description: 'List services for a selected ECS cluster.', risk: 'read', apiOperation: 'list-services', fields: [region, requiredText('cluster', 'Cluster', 'Choose a cluster from the inventory.')], paginated: true, output: 'table' },
  { id: 'ecs.deleteService', service: 'ecs', label: 'Delete service', description: 'Delete one ECS service after a destructive preview.', risk: 'destructive', apiOperation: 'delete-service', fields: [region, requiredText('cluster', 'Cluster', 'Choose a cluster from the inventory.'), requiredText('service', 'Service', 'Choose a service from the inventory.')], waiter: { name: 'services-stable', terminalStates: ['success', 'failure'], timeoutMs: 600000, intervalMs: 5000 }, output: 'json' },
  { id: 'eks.listClusters', service: 'eks', label: 'List clusters', description: 'Inventory EKS clusters with pagination.', risk: 'read', apiOperation: 'list-clusters', fields: [region], paginated: true, output: 'table' },
  { id: 'eks.describeCluster', service: 'eks', label: 'Describe cluster', description: 'Inspect one selected EKS cluster.', risk: 'read', apiOperation: 'describe-cluster', fields: [region, requiredText('name', 'Cluster', 'Choose a cluster from the inventory.')], output: 'json' },
  { id: 'rds.describeInstances', service: 'rds', label: 'List database instances', description: 'Inventory RDS instances and their statuses.', risk: 'read', apiOperation: 'describe-db-instances', fields: [region], paginated: true, output: 'table' },
  { id: 'rds.deleteInstance', service: 'rds', label: 'Delete database instance', description: 'Delete one database instance after a destructive preview.', risk: 'destructive', apiOperation: 'delete-db-instance', fields: [region, requiredText('identifier', 'DB instance identifier', 'Choose a database instance from the inventory.'), { key: 'skipFinalSnapshot', label: 'Skip final snapshot', type: 'boolean', description: 'If enabled, no final snapshot is created. Review this carefully.' }], waiter: { name: 'db-instance-deleted', terminalStates: ['success', 'failure'], timeoutMs: 1800000, intervalMs: 15000 }, output: 'json' },
  { id: 'database.list', service: 'database', label: 'Inventory databases', description: 'Show database resources across supported providers.', risk: 'read', apiOperation: 'describe-db-instances', fields: [region], paginated: true, output: 'table' },
  { id: 'vpc.describe', service: 'vpc', label: 'Inventory VPC resources', description: 'List VPCs, subnets, route tables, and security groups.', risk: 'read', apiOperation: 'describe-vpcs', fields: [region], paginated: true, output: 'table' },
  { id: 'vpc.delete', service: 'vpc', label: 'Delete VPC', description: 'Delete one VPC after dependency checks and confirmation.', risk: 'destructive', apiOperation: 'delete-vpc', fields: [region, requiredText('vpcId', 'VPC', 'Choose a VPC from the inventory.')], output: 'json' },
  { id: 'route53.listZones', service: 'route53', label: 'List hosted zones', description: 'Inventory Route 53 hosted zones.', risk: 'read', apiOperation: 'list-hosted-zones', fields: [], paginated: true, output: 'table' },
  { id: 'route53.changeRecord', service: 'route53', label: 'Change DNS record', description: 'Apply one reviewed DNS record change from typed fields.', risk: 'write', apiOperation: 'change-resource-record-sets', fields: [requiredText('hostedZoneId', 'Hosted zone', 'Choose a hosted zone from the inventory.'), { key: 'action', label: 'Action', type: 'enum', required: true, description: 'Choose whether to create, update, or delete the record.', options: [{ value: 'CREATE', label: 'Create' }, { value: 'UPSERT', label: 'Upsert' }, { value: 'DELETE', label: 'Delete' }] }, requiredText('recordName', 'Record name', 'The fully-qualified DNS record name.'), { key: 'recordType', label: 'Record type', type: 'enum', required: true, description: 'Choose the DNS record type.', options: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV'].map((value) => ({ value, label: value })) }, { key: 'ttl', label: 'TTL seconds', type: 'number', required: true, min: 0, max: 604800, description: 'Time-to-live in seconds.' }, requiredText('recordValue', 'Record value', 'The value supplied to the selected record type.')], output: 'json' },
  { id: 'cost.getUsage', service: 'cost', label: 'Get cost and usage', description: 'Read cost data for a bounded date range.', risk: 'read', apiOperation: 'get-cost-and-usage', fields: [{ key: 'start', label: 'Start date', type: 'date', required: true, description: 'Inclusive start date in the local timezone.' }, { key: 'end', label: 'End date', type: 'date', required: true, description: 'Exclusive end date in the local timezone.' }, { key: 'granularity', label: 'Granularity', type: 'enum', required: true, description: 'Group the result by time.', options: [{ value: 'DAILY', label: 'Daily' }, { value: 'MONTHLY', label: 'Monthly' }] }], output: 'table' }
]


/* ------------------------------------------------------------------------------------------- *
 * Legacy AWS Resource Explorer / Cloud Control contracts (core/aws/aws-manager.ts, client.ts).
 *
 * A prior automated merge concatenated several independently-rewritten versions of this file's
 * consumers without keeping their matching schema. This block restores the schema verbatim from
 * its origin commit (d32fd0f79, "feat(integrations): add AWS resource managers"), with
 * `AwsPermissionState` and `AwsApi` renamed to avoid colliding with the current, unrelated
 * interfaces of the same name declared above (which back a different, currently-live AWS
 * catalog/forms manager). Nothing outside src/core/aws/aws-manager.ts and client.ts currently
 * imports this block; see the AWS lane report for the full orphaned-code inventory.
 * ------------------------------------------------------------------------------------------- */

export type AwsManagerKind = 'resource-explorer' | 'cloud-control'

export type AwsManagerHealth =
  | 'unknown'
  | 'ready'
  | 'missing-credentials'
  | 'permission-denied'
  | 'partial'
  | 'error'

export interface AwsManagerStatus {
  health: AwsManagerHealth
  region: string
  profile: string | null
  accountId: string | null
  detail: string | null
  checkedAt: number
}

export interface AwsRequestContext {
  requestId: string
  manager: AwsManagerKind
  service: string
  operation: string
  region: string
  profile: string | null
  accountId: string | null
  roleArn: string | null
  endpoint: string
  pageSize: number
  pageToken: string | null
  generatedAt: number
  /** The request body with secrets and auth headers removed. */
  parameters: Record<string, unknown>
}

export type AwsLegacyResourcePermissionState = 'allowed' | 'denied' | 'unknown'

export interface AwsPage<T> {
  items: T[]
  nextToken: string | null
  page: number
  complete: boolean
  source: 'resource-explorer' | 'tagging-api-fallback' | 'cloud-control'
  permission: AwsLegacyResourcePermissionState
  detail: string | null
  context: AwsRequestContext
}

export interface AwsResourceProperty {
  name: string
  value: string
}

export interface AwsResource {
  arn: string
  service: string | null
  resourceType: string | null
  region: string | null
  accountId: string | null
  properties: AwsResourceProperty[]
  tags: Record<string, string>
  discoveredBy: 'resource-explorer' | 'tagging-api-fallback'
}

export interface AwsResourceType {
  typeName: string
  description: string | null
  schema: Record<string, unknown> | null
  handlers: string[]
  provisioningType: string | null
  source: 'cloud-control'
}

export interface AwsCloudControlResource {
  typeName: string
  identifier: string
  properties: Record<string, unknown>
  status: string | null
  statusMessage: string | null
  requestToken: string | null
}

export type AwsCrudAction = 'list' | 'read' | 'create' | 'update' | 'delete'

export interface AwsCrudPreview {
  action: AwsCrudAction
  service: 'cloudcontrol'
  operation: string
  region: string
  typeName: string
  identifier: string | null
  properties: Record<string, unknown>
  destructive: boolean
  generatedAt: number
  context: AwsRequestContext
}

export interface AwsCrudResult {
  resource: AwsCloudControlResource | null
  permission: AwsLegacyResourcePermissionState
  partial: boolean
  detail: string | null
  preview: AwsCrudPreview
}

export interface AwsLegacyResourceManagerApi {
  status(): Promise<AwsManagerStatus>
  context(input: {
    manager: AwsManagerKind
    region?: string
    service?: string
    operation: string
    parameters?: Record<string, unknown>
    pageSize?: number
    pageToken?: string | null
  }): Promise<AwsRequestContext>
  discoverResources(input: { query?: string; region?: string; maxPages?: number }): Promise<AwsPage<AwsResource>>
  listResourceTypes(input?: { region?: string; maxPages?: number }): Promise<AwsPage<AwsResourceType>>
  listResources(input: { typeName: string; region?: string; maxPages?: number }): Promise<AwsPage<AwsCloudControlResource>>
  readResource(input: { typeName: string; identifier: string; region?: string }): Promise<AwsCrudResult>
  preview(input: {
    action: AwsCrudAction
    typeName?: string
    identifier?: string
    properties?: Record<string, unknown>
    region?: string
  }): Promise<AwsCrudPreview>
  createResource(input: { typeName: string; properties: Record<string, unknown>; region?: string }): Promise<AwsCrudResult>
  updateResource(input: {
    typeName: string
    identifier: string
    properties: Record<string, unknown>
    region?: string
  }): Promise<AwsCrudResult>
  deleteResource(input: { typeName: string; identifier: string; region?: string }): Promise<AwsCrudResult>
}

export const AWS_DEFAULT_REGION = 'us-east-1'
export const AWS_DEFAULT_PAGE_SIZE = 50
export const AWS_MAX_PAGE_SIZE = 100
export const AWS_MAX_PAGES = 100

export function clampAwsPageSize(value: number | undefined): number {
  if (!Number.isFinite(value)) return AWS_DEFAULT_PAGE_SIZE
  return Math.max(1, Math.min(AWS_MAX_PAGE_SIZE, Math.floor(value!)))
}

export function isAwsResourceTypeName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9:./_-]{0,255}$/.test(value)
}

export function isAwsResourceIdentifier(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value)
}


/* ------------------------------------------------------------------------------------------- *
 * Legacy AWS identity/profile-manager contracts (core/aws/aws-profile-manager.ts).
 *
 * Restored verbatim from its origin commit (1204916b9, "feat(program-33): add AWS identity
 * manager"), lost by the same merge described above. `AwsApi` renamed to
 * `AwsLegacyIdentityManagerApi` to avoid colliding with the two other same-named interfaces in
 * this file. Nothing outside src/core/aws/aws-profile-manager.ts currently imports this block.
 * ------------------------------------------------------------------------------------------- */

export type AwsProfileSource = 'config' | 'credentials' | 'managed'

export interface AwsCredentialProcessInfo {
  configured: boolean
  executableName: string | null
  trusted: boolean
  reason: string | null
}

export interface AwsProfile {
  name: string
  source: AwsProfileSource
  region: string | null
  output: 'json' | 'yaml' | 'text' | 'table' | null
  sso: {
    configured: boolean
    startUrl: string | null
    region: string | null
    sessionName: string | null
    authMode: 'pkce' | 'device-code' | null
  }
  role: {
    configured: boolean
    roleArn: string | null
    sourceProfile: string | null
    externalIdConfigured: boolean
    mfaSerialConfigured: boolean
  }
  staticCredentialsConfigured: boolean
  credentialProcess: AwsCredentialProcessInfo
  endpointOverride: string | null
  cache: {
    kind: 'machine-local'
    expiresAt: string | null
    valid: boolean
  }
}

export interface AwsProfileDraft {
  name: string
  region?: string | null
  output?: AwsProfile['output']
  ssoStartUrl?: string | null
  ssoRegion?: string | null
  ssoSessionName?: string | null
  ssoAuthMode?: 'pkce' | 'device-code' | null
  roleArn?: string | null
  sourceProfile?: string | null
  mfaSerial?: string | null
  endpointOverride?: string | null
}

export interface AwsSsoLoginResult {
  profileName: string
  phase: 'ready' | 'unavailable' | 'failed'
  authMode: 'pkce' | 'device-code'
  expiresAt: string | null
  detail: string | null
}

export interface AwsAssumeRoleInput {
  profileName: string
  roleArn: string
  sessionName: string
  durationSeconds?: number
  mfaSerial?: string | null
  /** Supplied once and written only to a trusted child process stdin. Never persisted or echoed. */
  mfaCode?: string | null
}

export interface AwsAssumeRoleResult {
  profileName: string
  roleArn: string
  assumedRoleArn: string | null
  expiresAt: string | null
  phase: 'ready' | 'failed'
  detail: string | null
}

export interface AwsCallerIdentity {
  profileName: string
  account: string | null
  arn: string | null
  userId: string | null
  checkedAt: number
  expiresAt: string | null
  phase: 'ready' | 'unavailable' | 'failed'
  detail: string | null
}

export interface AwsPermissionResult {
  profileName: string
  action: string
  decision: 'allowed' | 'explicitDeny' | 'implicitDeny' | 'unknown'
  checkedAt: number
  detail: string | null
}

export interface AwsRegionEndpoint {
  region: string
  partition: string
  endpoint: string
  configured: boolean
  available: boolean | null
}

export interface AwsLegacyIdentityManagerApi {
  profiles(): Promise<AwsProfile[]>
  saveProfile(draft: AwsProfileDraft): Promise<AwsProfile[]>
  removeProfile(name: string): Promise<void>
  refresh(): Promise<AwsProfile[]>
  ssoLogin(profileName: string, authMode?: 'pkce' | 'device-code'): Promise<AwsSsoLoginResult>
  assumeRole(input: AwsAssumeRoleInput): Promise<AwsAssumeRoleResult>
  callerIdentity(profileName: string): Promise<AwsCallerIdentity>
  permissions(profileName: string, actions: string[]): Promise<AwsPermissionResult[]>
  regions(profileName?: string): Promise<AwsRegionEndpoint[]>
  setEndpoint(region: string, endpoint: string | null): Promise<AwsRegionEndpoint[]>
  clearMachineCache(): Promise<void>
  trustCredentialProcess(profileName: string): Promise<AwsProfile | null>
}


/* ------------------------------------------------------------------------------------------- *
 * Legacy AWS CLI v2 manager contracts (core/aws/service.ts, dependency-manager-adapter.ts,
 * manifest.ts).
 *
 * Restored verbatim from its origin commit (7339306ab, "feat(program-30): add AWS CLI manager"),
 * lost by the same merge described above. `AwsApi` renamed to `AwsLegacyCliManagerApi` to avoid
 * colliding with the other same-named interfaces in this file (nothing currently imports it by
 * that name). Nothing outside src/core/aws/service.ts, dependency-manager-adapter.ts and
 * manifest.ts currently imports this block.
 * ------------------------------------------------------------------------------------------- */

export const AWS_CLI_WINDOWS_X64_MANIFEST = {
  version: '2.36.31',
  platform: 'win32-x64',
  url: 'https://awscli.amazonaws.com/AWSCLIV2-User-2.36.31.msi?src=script-exe',
  sha256: '300d490cebe7d89913acc0f7ca1c585032fd2a7f698e809d7ce9905614013acd',
  bundledRelativePath: 'aws/AWSCLIV2-User-2.36.31.msi'
} as const

export type AwsCliState =
  | 'unsupported-platform'
  | 'not-installed'
  | 'ready'
  | 'stale'
  | 'installing'
  | 'failed'
  | 'offline'

export type AwsCliSource = 'bundled' | 'verified-fetch' | 'user-install' | null

export interface AwsCliStatus {
  state: AwsCliState
  expectedVersion: string
  installedVersion: string | null
  executablePath: string | null
  installerSource: AwsCliSource
  installerSha256: string | null
  progress: number | null
  detail: string | null
  checkedAt: number
}

export interface AwsModelSummary {
  id: string
  name: string
  provider: string | null
  inputModalities: string[]
  outputModalities: string[]
  responseStreamingSupported: boolean | null
  customizationsSupported: string[]
  inferenceTypesSupported: string[]
  source: 'aws-cli' | 'offline-cache'
}

export interface AwsModelInventory {
  models: AwsModelSummary[]
  source: 'aws-cli' | 'offline-cache' | 'unavailable'
  fetchedAt: number | null
  stale: boolean
  detail: string | null
}

/** Renderer-facing surface for the bundled AWS CLI v2 manager (core/aws/service.ts). Distinct
 *  from `AwsApi` above, which is the live AWS operation/inventory lane. Machine-local: a relay
 *  tab refuses every member rather than installing the CLI on the viewing machine. */
export interface AwsCliApi {
  status(): Promise<AwsCliStatus>
  ensure(): Promise<AwsCliStatus>
  repair(): Promise<AwsCliStatus>
  cancel(): Promise<void>
  models(): Promise<AwsModelInventory>
  refreshModels(): Promise<AwsModelInventory>
  onStatus(listener: (status: AwsCliStatus) => void): () => void
}

export interface AwsLegacyCliManagerApi {
  status(): Promise<AwsCliStatus>
  ensure(): Promise<AwsCliStatus>
  repair(): Promise<AwsCliStatus>
  cancel(): Promise<void>
  models(): Promise<AwsModelInventory>
  refreshModels(): Promise<AwsModelInventory>
}
