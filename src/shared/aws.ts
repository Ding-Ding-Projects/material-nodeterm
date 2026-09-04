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
