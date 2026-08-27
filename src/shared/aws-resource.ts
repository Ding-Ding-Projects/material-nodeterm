/**
 * Guided AWS Resource Explorer and Cloud Control contract.
 *
 * The persisted node keeps only portable intent. Profile names, account bindings, role sessions,
 * endpoints, request tokens, resource identifiers, result pages, CLI paths, and credentials stay
 * machine-local or transient.
 */
import type {
  CloudFormationCapability,
  CloudFormationChangeSetType
} from './cloudformation'
import { normalizeCdkPortableBlueprint, type CdkPortableBlueprint } from './cdk'

export type AwsManagerMode = 'resource-explorer' | 'cloud-control' | 'core-services'
  | 'cloudformation' | 'cdk' | 'platform-managers'

/** Core AWS services use the same binding, preview, pagination and progress seam as the
 * Resource Explorer and Cloud Control managers. Keeping one operation contract avoids a second
 * credential or CLI stack. */
export type AwsCoreServiceId = 's3' | 'ec2' | 'iam' | 'sts' | 'lambda' | 'cloudwatch' | 'logs'
export type AwsPlatformServiceId = 'ecr' | 'ecs' | 'eks' | 'rds' | 'database' | 'vpc' | 'route53' | 'cost'

export interface AwsManagerPortableIntent {
  schemaVersion: 1
  mode: AwsManagerMode
  regionIntent: string
  resourceQuery: string
  cloudControlTypeName: string
  coreService?: AwsCoreServiceId
  coreOperation?: AwsCoreOperation
  coreInput?: Record<string, string | number | boolean>
  platformService?: AwsPlatformServiceId
  platformOperation?: AwsPlatformOperation
  platformInput?: Record<string, string | number | boolean>
  cloudFormation?: {
    schemaVersion: 1
    stackName: string
    changeSetType: CloudFormationChangeSetType
    parameterKeys: string[]
    capabilities: CloudFormationCapability[]
  }
  cdk?: CdkPortableBlueprint
}

export interface AwsCliRuntimeStatus {
  available: boolean
  origin: 'bundled' | 'system' | 'unavailable'
  version: string | null
  disabledReason: string | null
}

export interface AwsProfileChoice {
  name: string
  configuredRegion: string | null
}

export interface AwsManagerBinding {
  nodeId: string
  profileName: string
  region: string
  endpointUrl: string | null
  updatedAt: number
}

export type AwsManagerOperation =
  | 'generic'
  | 'resource-list-views'
  | 'cloud-list-types'
  | 'cloud-list-resources'
  | 'cloud-get-resource'
  | 'cloud-create-resource'
  | 'cloud-update-resource'
  | 'cloud-delete-resource'
  | 'cloud-request-status'
  | 'cloudformation-validate-template'
  | 'cloudformation-list-stacks'
  | 'cloudformation-create-change-set'
  | 'cloudformation-describe-change-set'
  | 'cloudformation-execute-change-set'
  | 'cloudformation-delete-change-set'
  | 's3-list-buckets' | 's3-list-objects' | 's3-create-bucket' | 's3-delete-bucket'
  | 'ec2-describe-instances' | 'ec2-describe-security-groups' | 'ec2-start-instances' | 'ec2-stop-instances' | 'ec2-terminate-instances'
  | 'iam-list-users' | 'iam-list-roles' | 'iam-get-user' | 'iam-get-role' | 'iam-create-user' | 'iam-delete-user'
  | 'sts-get-caller-identity'
  | 'lambda-list-functions' | 'lambda-get-function' | 'lambda-delete-function'
  | 'cloudwatch-list-metrics' | 'cloudwatch-get-metric-data'
  | 'logs-describe-log-groups' | 'logs-describe-log-streams' | 'logs-get-log-events' | 'logs-filter-log-events'
  | 'ecr-list-repositories' | 'ecr-describe-images' | 'ecr-create-repository' | 'ecr-delete-repository'
  | 'ecs-list-clusters' | 'ecs-list-services' | 'ecs-update-service' | 'ecs-delete-service'
  | 'eks-list-clusters' | 'eks-describe-cluster' | 'eks-update-nodegroup' | 'eks-delete-cluster'
  | 'rds-describe-db-instances' | 'rds-create-db-instance' | 'rds-create-db-snapshot' | 'rds-delete-db-instance'
  | 'database-list-tables' | 'database-create-table' | 'database-delete-table'
  | 'vpc-describe-vpcs' | 'vpc-create-vpc' | 'vpc-create-subnet' | 'vpc-delete-vpc'
  | 'route53-list-hosted-zones' | 'route53-change-record' | 'route53-delete-hosted-zone'
  | 'cost-get-cost-and-usage' | 'cost-create-budget'

export type AwsPlatformOperation = Extract<AwsManagerOperation, `${AwsPlatformServiceId}-${string}`>

export type AwsCoreOperation = Exclude<AwsManagerOperation,
  'generic' |
  'resource-list-views' | 'resource-search' | 'cloud-list-types' | 'cloud-list-resources' |
  'cloud-get-resource' | 'cloud-create-resource' | 'cloud-update-resource' | 'cloud-delete-resource' |
  'cloud-request-status' | 'cloudformation-validate-template' | 'cloudformation-list-stacks' |
  'cloudformation-create-change-set' | 'cloudformation-describe-change-set' |
  'cloudformation-execute-change-set' | 'cloudformation-delete-change-set' | AwsPlatformOperation>

export const AWS_CORE_SERVICES: readonly AwsCoreServiceId[] = ['s3', 'ec2', 'iam', 'sts', 'lambda', 'cloudwatch', 'logs']
export const AWS_PLATFORM_SERVICES: readonly AwsPlatformServiceId[] = ['ecr', 'ecs', 'eks', 'rds', 'database', 'vpc', 'route53', 'cost']
export const AWS_PLATFORM_OPERATIONS: readonly AwsPlatformOperation[] = [
  'ecr-list-repositories', 'ecr-describe-images', 'ecr-create-repository', 'ecr-delete-repository',
  'ecs-list-clusters', 'ecs-list-services', 'ecs-update-service', 'ecs-delete-service',
  'eks-list-clusters', 'eks-describe-cluster', 'eks-update-nodegroup', 'eks-delete-cluster',
  'rds-describe-db-instances', 'rds-create-db-instance', 'rds-create-db-snapshot', 'rds-delete-db-instance',
  'database-list-tables', 'database-create-table', 'database-delete-table',
  'vpc-describe-vpcs', 'vpc-create-vpc', 'vpc-create-subnet', 'vpc-delete-vpc',
  'route53-list-hosted-zones', 'route53-change-record', 'route53-delete-hosted-zone',
  'cost-get-cost-and-usage', 'cost-create-budget'
]
export const AWS_CORE_OPERATIONS: Record<AwsCoreServiceId, readonly AwsCoreOperation[]> = {
  s3: ['s3-list-buckets', 's3-list-objects', 's3-create-bucket', 's3-delete-bucket'],
  ec2: ['ec2-describe-instances', 'ec2-describe-security-groups', 'ec2-start-instances', 'ec2-stop-instances', 'ec2-terminate-instances'],
  iam: ['iam-list-users', 'iam-list-roles', 'iam-get-user', 'iam-get-role', 'iam-create-user', 'iam-delete-user'],
  sts: ['sts-get-caller-identity'],
  lambda: ['lambda-list-functions', 'lambda-get-function', 'lambda-delete-function'],
  cloudwatch: ['cloudwatch-list-metrics', 'cloudwatch-get-metric-data'],
  logs: ['logs-describe-log-groups', 'logs-describe-log-streams', 'logs-get-log-events', 'logs-filter-log-events']
}

export interface AwsManagerRequest {
  operation: AwsManagerOperation
  /** Model-generated operation input. The core reloads and validates the installed model before
   * building argv, so a renderer cannot smuggle an arbitrary command or raw request through this
   * field. */
  generic?: {
    serviceId: string
    commandName: string
    input: unknown
  }
  service?: AwsCoreServiceId | AwsPlatformServiceId
  input?: Record<string, unknown>
  query?: string
  viewArn?: string
  typeName?: string
  identifier?: string
  desiredState?: string
  patchDocument?: string
  requestToken?: string
  nextToken?: string
  maxResults?: number
  /** Renderer-side confirmation is rechecked by the core before a destructive action. */
  confirmed?: boolean
  templatePath?: string
  stackName?: string
  changeSetName?: string
  changeSetType?: CloudFormationChangeSetType
  parameters?: Array<{ key: string; value?: string; usePreviousValue?: boolean }>
  capabilities?: CloudFormationCapability[]
}

export type AwsOperationRisk = 'read-only' | 'write' | 'destructive'

export interface AwsOperationPreview {
  service: string
  operation: string
  profileName: string
  region: string
  endpointUrl: string | null
  argv: string[]
  pagination: 'none' | 'manual-next-token'
  retry: 'manual'
  risk: AwsOperationRisk
  destructive: boolean
}

export interface AwsManagerResult {
  operationId: string
  operation: AwsManagerOperation
  rows: Array<Record<string, unknown>>
  nextToken: string | null
  requestToken: string | null
  summary: string
  completedAt: number
}

export const AWS_CORE_OPERATION_LABELS: Record<AwsCoreOperation, string> = {
  's3-list-buckets': 'S3: List buckets', 's3-list-objects': 'S3: List objects', 's3-create-bucket': 'S3: Create bucket', 's3-delete-bucket': 'S3: Delete bucket',
  'ec2-describe-instances': 'EC2: Describe instances', 'ec2-describe-security-groups': 'EC2: Describe security groups', 'ec2-start-instances': 'EC2: Start instances', 'ec2-stop-instances': 'EC2: Stop instances', 'ec2-terminate-instances': 'EC2: Terminate instances',
  'iam-list-users': 'IAM: List users', 'iam-list-roles': 'IAM: List roles', 'iam-get-user': 'IAM: Get user', 'iam-get-role': 'IAM: Get role', 'iam-create-user': 'IAM: Create user', 'iam-delete-user': 'IAM: Delete user',
  'sts-get-caller-identity': 'STS: Get caller identity',
  'lambda-list-functions': 'Lambda: List functions', 'lambda-get-function': 'Lambda: Get function', 'lambda-delete-function': 'Lambda: Delete function',
  'cloudwatch-list-metrics': 'CloudWatch: List metrics', 'cloudwatch-get-metric-data': 'CloudWatch: Get metric data',
  'logs-describe-log-groups': 'Logs: Describe log groups', 'logs-describe-log-streams': 'Logs: Describe log streams', 'logs-get-log-events': 'Logs: Get log events', 'logs-filter-log-events': 'Logs: Filter log events'
}

export const AWS_PLATFORM_OPERATION_LABELS: Record<AwsPlatformOperation, string> = {
  'ecr-list-repositories': 'ECR: List repositories', 'ecr-describe-images': 'ECR: Describe images', 'ecr-create-repository': 'ECR: Create repository', 'ecr-delete-repository': 'ECR: Delete repository',
  'ecs-list-clusters': 'ECS: List clusters', 'ecs-list-services': 'ECS: List services', 'ecs-update-service': 'ECS: Update service', 'ecs-delete-service': 'ECS: Delete service',
  'eks-list-clusters': 'EKS: List clusters', 'eks-describe-cluster': 'EKS: Describe cluster', 'eks-update-nodegroup': 'EKS: Update node group', 'eks-delete-cluster': 'EKS: Delete cluster',
  'rds-describe-db-instances': 'RDS: Describe databases', 'rds-create-db-instance': 'RDS: Create database', 'rds-create-db-snapshot': 'RDS: Create snapshot', 'rds-delete-db-instance': 'RDS: Delete database',
  'database-list-tables': 'Database: List tables', 'database-create-table': 'Database: Create table', 'database-delete-table': 'Database: Delete table',
  'vpc-describe-vpcs': 'VPC: Describe networks', 'vpc-create-vpc': 'VPC: Create network', 'vpc-create-subnet': 'VPC: Create subnet', 'vpc-delete-vpc': 'VPC: Delete network',
  'route53-list-hosted-zones': 'Route 53: List hosted zones', 'route53-change-record': 'Route 53: Change record', 'route53-delete-hosted-zone': 'Route 53: Delete hosted zone',
  'cost-get-cost-and-usage': 'Cost: Get usage report', 'cost-create-budget': 'Cost: Create budget'
}

export interface AwsManagerProgress {
  operationId: string
  nodeId: string
  phase: 'started' | 'completed' | 'cancelled' | 'failed'
  message: string
}

export interface AwsResourceApi {
  runtime(): Promise<AwsCliRuntimeStatus>
  profiles(): Promise<AwsProfileChoice[]>
  binding(nodeId: string): Promise<AwsManagerBinding | null>
  bind(input: {
    nodeId: string
    profileName: string
    region: string
    endpointUrl?: string | null
  }): Promise<AwsManagerBinding>
  unbind(nodeId: string): Promise<boolean>
  preview(nodeId: string, request: AwsManagerRequest): Promise<AwsOperationPreview>
  execute(nodeId: string, operationId: string, request: AwsManagerRequest): Promise<AwsManagerResult>
  cancel(operationId: string): Promise<boolean>
  onProgress(listener: (progress: AwsManagerProgress) => void): () => void
}

export const AWS_MANAGER_DEFAULT_INTENT: AwsManagerPortableIntent = {
  schemaVersion: 1,
  mode: 'resource-explorer',
  regionIntent: 'us-east-1',
  resourceQuery: '*',
  cloudControlTypeName: ''
}

const REGION_RE = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/
const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9_.@+-]{0,127}$/
const TYPE_RE = /^[A-Za-z][A-Za-z0-9]{0,63}(?:::[A-Za-z][A-Za-z0-9]{0,63}){2}$/

export function isAwsRegion(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && REGION_RE.test(value.trim())
}

export function isAwsProfileName(value: unknown): value is string {
  return typeof value === 'string' && PROFILE_RE.test(value.trim())
}

export function isCloudControlTypeName(value: unknown): value is string {
  return typeof value === 'string' && TYPE_RE.test(value.trim())
}

export function normalizeAwsPortableIntent(value: unknown): AwsManagerPortableIntent {
  if (!value || typeof value !== 'object') return { ...AWS_MANAGER_DEFAULT_INTENT }
  const raw = value as Record<string, unknown>
  const mode: AwsManagerMode = raw.mode === 'cloud-control'
    ? 'cloud-control'
    : raw.mode === 'core-services'
      ? 'core-services'
      : raw.mode === 'cloudformation'
      ? 'cloudformation'
      : raw.mode === 'cdk'
        ? 'cdk'
        : raw.mode === 'platform-managers'
          ? 'platform-managers'
          : 'resource-explorer'
  const regionIntent = isAwsRegion(raw.regionIntent) ? raw.regionIntent.trim() : AWS_MANAGER_DEFAULT_INTENT.regionIntent
  const resourceQuery = typeof raw.resourceQuery === 'string' && raw.resourceQuery.length <= 1024
    ? raw.resourceQuery
    : AWS_MANAGER_DEFAULT_INTENT.resourceQuery
  const cloudControlTypeName = isCloudControlTypeName(raw.cloudControlTypeName)
    ? raw.cloudControlTypeName.trim()
    : ''
  const coreService = AWS_CORE_SERVICES.includes(raw.coreService as AwsCoreServiceId) ? raw.coreService as AwsCoreServiceId : 's3'
  const coreOperation = AWS_CORE_OPERATIONS[coreService].includes(raw.coreOperation as AwsCoreOperation) ? raw.coreOperation as AwsCoreOperation : AWS_CORE_OPERATIONS[coreService][0]
  const platformService = AWS_PLATFORM_SERVICES.includes(raw.platformService as AwsPlatformServiceId) ? raw.platformService as AwsPlatformServiceId : 'ecr'
  const platformOperation = AWS_PLATFORM_OPERATIONS.filter((item) => item.startsWith(`${platformService}-`)).includes(raw.platformOperation as AwsPlatformOperation)
    ? raw.platformOperation as AwsPlatformOperation
    : AWS_PLATFORM_OPERATIONS.find((item) => item.startsWith(`${platformService}-`))
  const platformInput: Record<string, string | number | boolean> = {}
  if (raw.platformInput && typeof raw.platformInput === 'object' && !Array.isArray(raw.platformInput)) {
    for (const [key, value] of Object.entries(raw.platformInput as Record<string, unknown>).slice(0, 32)) {
      if ((typeof value === 'string' && value.length <= 2048) || typeof value === 'number' || typeof value === 'boolean') platformInput[key] = value as string | number | boolean
    }
  }
  const coreInput: Record<string, string | number | boolean> = {}
  if (raw.coreInput && typeof raw.coreInput === 'object' && !Array.isArray(raw.coreInput)) {
    for (const [key, value] of Object.entries(raw.coreInput as Record<string, unknown>).slice(0, 32)) {
      if ((typeof value === 'string' && value.length <= 2048) || typeof value === 'number' || typeof value === 'boolean') coreInput[key] = value as string | number | boolean
    }
  }
  const rawCloudFormation = raw.cloudFormation && typeof raw.cloudFormation === 'object' && !Array.isArray(raw.cloudFormation)
    ? raw.cloudFormation as Record<string, unknown>
    : null
  const cloudFormation = rawCloudFormation && typeof rawCloudFormation.stackName === 'string' && rawCloudFormation.stackName.length <= 128
    ? {
        stackName: rawCloudFormation.stackName,
        changeSetType: rawCloudFormation.changeSetType === 'UPDATE' ? 'UPDATE' as const : 'CREATE' as const,
        parameterKeys: Array.isArray(rawCloudFormation.parameterKeys)
          ? rawCloudFormation.parameterKeys.filter((item): item is string => typeof item === 'string' && item.length <= 255).slice(0, 200)
          : [],
        capabilities: Array.isArray(rawCloudFormation.capabilities)
          ? rawCloudFormation.capabilities.filter((item): item is CloudFormationCapability => item === 'CAPABILITY_IAM' || item === 'CAPABILITY_NAMED_IAM' || item === 'CAPABILITY_AUTO_EXPAND')
          : []
      }
    : undefined
  const cdk = normalizeCdkPortableBlueprint(raw.cdk)
  return { schemaVersion: 1, mode, regionIntent, resourceQuery, cloudControlTypeName, coreService, coreOperation, coreInput, platformService, ...(platformOperation ? { platformOperation } : {}), platformInput, ...(cloudFormation ? { cloudFormation } : {}), ...(cdk ? { cdk } : {}) }
}

