/**
 * Guided AWS resource-manager contracts for the Wave E container, database, networking and cost
 * lane. This module contains portable intent and presentation metadata only. It never imports an
 * AWS SDK, reads credentials, resolves a local profile, or performs a network operation.
 *
 * Live account bindings, resource identifiers, ARNs, pagination cursors and operation jobs belong
 * to the trusted machine-local AWS service introduced by the preceding AWS lanes. Keeping this
 * distinction in the type system is what makes importing project.json side-effect free.
 */

export const AWS_RESOURCE_MANAGER_SCHEMA = 1 as const

export const AWS_RESOURCE_MANAGER_IDS = [
  'ecr',
  'ecs',
  'eks',
  'rds',
  'database',
  'vpc',
  'route53',
  'cost'
] as const

export type AwsResourceManagerId = (typeof AWS_RESOURCE_MANAGER_IDS)[number]
export type AwsOperationRisk = 'read' | 'write' | 'destructive'
export type AwsManagerFieldKind = 'text' | 'number' | 'boolean' | 'choice' | 'date'

export interface AwsManagerFieldOption {
  value: string
  label: string
  description: string
}

export interface AwsManagerField {
  id: string
  label: string
  description: string
  kind: AwsManagerFieldKind
  required: boolean
  defaultValue: string | number | boolean
  options?: readonly AwsManagerFieldOption[]
  minimum?: number
  maximum?: number
  step?: number
  pattern?: string
  placeholder?: string
}

export interface AwsManagerOperation {
  id: string
  label: string
  description: string
  risk: AwsOperationRisk
  resourceKind: string
  fields: readonly AwsManagerField[]
  progressStages: readonly string[]
  recoveryAction: string
}

export interface AwsResourceManagerDefinition {
  id: AwsResourceManagerId
  label: string
  description: string
  services: readonly string[]
  operations: readonly AwsManagerOperation[]
}

/**
 * The only AWS manager state carried by schema 3. It is deliberately a template, not a binding:
 * region preference, manager and operation are safe intent, while a resource id or account scope
 * would grant authority on a different computer and therefore cannot appear here.
 */
export interface AwsResourceManagerIntent {
  schema: typeof AWS_RESOURCE_MANAGER_SCHEMA
  manager: AwsResourceManagerId
  operation: string
  preferredRegion?: string
  safeValues: Record<string, string | number | boolean>
}

/** Machine-local discovered resource shown by the trusted provider adapter. */
export interface AwsManagerResource {
  id: string
  label: string
  kind: string
  region: string
  status: string
  description: string
}

export interface AwsManagerListRequest {
  manager: AwsResourceManagerId
  region?: string
  query?: string
  nextToken?: string
}

export interface AwsManagerListResult {
  resources: AwsManagerResource[]
  nextToken?: string
  partial: boolean
  warning?: string
}

export interface AwsManagerRunRequest {
  manager: AwsResourceManagerId
  operation: string
  /** Selected live resource ids are machine-local and never copied into portable intent. */
  resourceIds: string[]
  values: Record<string, string | number | boolean>
}

export interface AwsManagerOperationProgress {
  jobId: string
  phase: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  stage: string
  completed: number
  total: number
  message: string
  canCancel: boolean
  canRetry: boolean
  succeededResourceIds: string[]
  failedResourceIds: string[]
}

export interface AwsResourceManagerAdapter {
  /** One adapter owns one manager; the core rejects duplicate ownership. */
  manager: AwsResourceManagerId
  availability(): Promise<{ available: boolean; reason?: string; nextAction?: string }>
  list(request: AwsManagerListRequest): Promise<AwsManagerListResult>
  run(request: AwsManagerRunRequest): Promise<AwsManagerOperationProgress>
  progress(jobId: string): Promise<AwsManagerOperationProgress>
  cancel(jobId: string): Promise<AwsManagerOperationProgress>
  retry(jobId: string): Promise<AwsManagerOperationProgress>
}

export interface AwsResourceManagerApi {
  catalog(): Promise<readonly AwsResourceManagerDefinition[]>
  availability(manager: AwsResourceManagerId): Promise<{ available: boolean; reason?: string; nextAction?: string }>
  list(request: AwsManagerListRequest): Promise<AwsManagerListResult>
  run(request: AwsManagerRunRequest): Promise<AwsManagerOperationProgress>
  progress(jobId: string): Promise<AwsManagerOperationProgress>
  cancel(jobId: string): Promise<AwsManagerOperationProgress>
  retry(jobId: string): Promise<AwsManagerOperationProgress>
}

const option = (value: string, label: string, description: string): AwsManagerFieldOption => ({
  value,
  label,
  description
})

const regionField: AwsManagerField = {
  id: 'region',
  label: 'Region',
  description: 'Choose a region discovered by the active AWS identity manager.',
  kind: 'choice',
  required: true,
  defaultValue: 'us-east-1',
  options: [
    option('us-east-1', 'US East (N. Virginia)', 'Common global-service home region.'),
    option('us-east-2', 'US East (Ohio)', 'US East regional workloads.'),
    option('us-west-2', 'US West (Oregon)', 'US West regional workloads.'),
    option('ca-central-1', 'Canada (Central)', 'Canadian regional workloads.'),
    option('eu-west-1', 'Europe (Ireland)', 'European regional workloads.'),
    option('ap-southeast-1', 'Asia Pacific (Singapore)', 'Asia Pacific regional workloads.')
  ]
}

const nameField = (label: string, initial: string): AwsManagerField => ({
  id: 'name',
  label,
  description: 'A suggested portable display name. The live provider validates uniqueness.',
  kind: 'text',
  required: true,
  defaultValue: initial,
  pattern: '^[A-Za-z][A-Za-z0-9_-]{2,62}$',
  placeholder: initial
})

const destructive = (id: string, label: string, resourceKind: string): AwsManagerOperation => ({
  id,
  label,
  description: `Remove the selected ${resourceKind} after reviewing dependencies and recovery options.`,
  risk: 'destructive',
  resourceKind,
  fields: [],
  progressStages: ['Preflight', 'Dependency review', 'Delete request', 'Read-back verification'],
  recoveryAction: 'Review retained dependencies, then retry only failed selections.'
})

export const AWS_RESOURCE_MANAGERS: readonly AwsResourceManagerDefinition[] = [
  {
    id: 'ecr',
    label: 'Elastic Container Registry',
    description: 'Repositories, image inventory, lifecycle policy, scanning and safe deletion.',
    services: ['ecr'],
    operations: [
      {
        id: 'create-repository', label: 'Create repository', resourceKind: 'repository', risk: 'write',
        description: 'Create a private image repository with scanning and tag-mutability choices.',
        fields: [regionField, nameField('Repository name', 'app-images'), {
          id: 'tagMutability', label: 'Tag mutability', description: 'Immutable tags prevent a later image from replacing the same tag.',
          kind: 'choice', required: true, defaultValue: 'IMMUTABLE', options: [
            option('IMMUTABLE', 'Immutable', 'A tag can identify only one image digest.'),
            option('MUTABLE', 'Mutable', 'A later push may replace an existing tag.')
          ]
        }, { id: 'scanOnPush', label: 'Scan on push', description: 'Request an image scan after every push.', kind: 'boolean', required: true, defaultValue: true }],
        progressStages: ['Validate name', 'Create repository', 'Apply settings', 'Read back repository'],
        recoveryAction: 'Open the repository result and retry only the setting that was not applied.'
      },
      {
        id: 'scan-images', label: 'Scan selected images', resourceKind: 'image', risk: 'write',
        description: 'Start vulnerability scans for selected image digests and preserve partial results.', fields: [regionField],
        progressStages: ['Resolve digests', 'Queue scans', 'Collect accepted scans', 'Report partial results'],
        recoveryAction: 'Retry failed image digests after checking repository scan support.'
      },
      destructive('delete-repositories', 'Delete selected repositories', 'repositories')
    ]
  },
  {
    id: 'ecs', label: 'Elastic Container Service',
    description: 'Clusters, task definitions, services, desired count, deployment and rollback.', services: ['ecs'],
    operations: [
      {
        id: 'create-service', label: 'Create service', resourceKind: 'service', risk: 'write',
        description: 'Create a service from discovered clusters, task definitions and network choices.',
        fields: [regionField, nameField('Service name', 'web-service'), {
          id: 'desiredCount', label: 'Desired task count', description: 'Number of tasks ECS should keep running.', kind: 'number', required: true,
          defaultValue: 1, minimum: 0, maximum: 1000, step: 1
        }, { id: 'launchType', label: 'Compute choice', description: 'Select the discovered compatible compute mode.', kind: 'choice', required: true,
          defaultValue: 'FARGATE', options: [option('FARGATE', 'Fargate', 'Serverless task capacity.'), option('EC2', 'EC2', 'Cluster instance capacity.')] }],
        progressStages: ['Validate cluster', 'Register deployment', 'Create service', 'Wait for stability'],
        recoveryAction: 'Inspect deployment events, choose a prior task definition, then retry.'
      },
      {
        id: 'scale-service', label: 'Scale service', resourceKind: 'service', risk: 'write', description: 'Set a reviewed desired count for selected services.',
        fields: [{ id: 'desiredCount', label: 'Desired task count', description: 'Reviewed target count for every selected service.', kind: 'number', required: true, defaultValue: 1, minimum: 0, maximum: 1000, step: 1 }],
        progressStages: ['Validate services', 'Apply counts', 'Wait for stability'], recoveryAction: 'Retry only services whose desired count was refused.'
      },
      destructive('delete-services', 'Delete selected services', 'services')
    ]
  },
  {
    id: 'eks', label: 'Elastic Kubernetes Service',
    description: 'Clusters, managed node groups, add-ons, upgrades and deletion.', services: ['eks'],
    operations: [
      {
        id: 'create-cluster', label: 'Create cluster', resourceKind: 'cluster', risk: 'write', description: 'Create a managed cluster from discovered roles, subnets and security groups.',
        fields: [regionField, nameField('Cluster name', 'app-cluster'), { id: 'version', label: 'Kubernetes version', description: 'A version reported as supported in the selected region.', kind: 'choice', required: true, defaultValue: 'latest-supported', options: [option('latest-supported', 'Latest supported', 'Resolve the newest version from the live provider.'), option('previous-supported', 'Previous supported', 'Use the immediately previous supported version.')] }],
        progressStages: ['Validate role and network', 'Create cluster', 'Wait for active state', 'Read back access configuration'], recoveryAction: 'Review the exact failed prerequisite, rebind it, then retry creation.'
      },
      {
        id: 'update-node-group', label: 'Update node group size', resourceKind: 'node group', risk: 'write', description: 'Apply minimum, desired and maximum capacity to selected managed node groups.',
        fields: [{ id: 'minimum', label: 'Minimum nodes', description: 'Lower scaling bound.', kind: 'number', required: true, defaultValue: 1, minimum: 0, maximum: 1000, step: 1 }, { id: 'desired', label: 'Desired nodes', description: 'Current scaling target.', kind: 'number', required: true, defaultValue: 2, minimum: 0, maximum: 1000, step: 1 }, { id: 'maximum', label: 'Maximum nodes', description: 'Upper scaling bound.', kind: 'number', required: true, defaultValue: 4, minimum: 1, maximum: 1000, step: 1 }],
        progressStages: ['Validate bounds', 'Apply scaling update', 'Wait for node group'], recoveryAction: 'Correct the bounds or capacity limit, then retry the failed node group.'
      },
      destructive('delete-clusters', 'Delete selected clusters', 'clusters')
    ]
  },
  {
    id: 'rds', label: 'Relational Database Service', description: 'Instances, Aurora clusters, snapshots, maintenance and deletion.', services: ['rds'],
    operations: [
      {
        id: 'create-database', label: 'Create database', resourceKind: 'database', risk: 'write', description: 'Create an encrypted database from guided engine, size, network and backup choices.',
        fields: [regionField, nameField('Database name', 'app-db'), { id: 'engine', label: 'Engine', description: 'Choose a supported managed database engine.', kind: 'choice', required: true, defaultValue: 'postgres', options: [option('postgres', 'PostgreSQL', 'Managed PostgreSQL.'), option('mysql', 'MySQL', 'Managed MySQL.'), option('aurora-postgresql', 'Aurora PostgreSQL', 'Aurora-compatible PostgreSQL cluster.'), option('aurora-mysql', 'Aurora MySQL', 'Aurora-compatible MySQL cluster.')] }, { id: 'storageGiB', label: 'Allocated storage (GiB)', description: 'Initial encrypted storage allocation.', kind: 'number', required: true, defaultValue: 20, minimum: 20, maximum: 65536, step: 1 }, { id: 'backupDays', label: 'Backup retention (days)', description: 'Automated backup retention.', kind: 'number', required: true, defaultValue: 7, minimum: 0, maximum: 35, step: 1 }],
        progressStages: ['Validate engine and network', 'Create database', 'Wait for availability', 'Read back endpoint metadata'], recoveryAction: 'Review the refused engine, quota or network choice, then retry.'
      },
      {
        id: 'create-snapshot', label: 'Create snapshot', resourceKind: 'database', risk: 'write', description: 'Create a named snapshot of each selected database.', fields: [nameField('Snapshot prefix', 'manual-backup')],
        progressStages: ['Validate databases', 'Create snapshots', 'Wait for availability'], recoveryAction: 'Retry only databases whose snapshot was not accepted.'
      },
      destructive('delete-databases', 'Delete selected databases', 'databases')
    ]
  },
  {
    id: 'database', label: 'AWS database catalog', description: 'Guided DynamoDB, ElastiCache, DocumentDB and Neptune resource workflows.', services: ['dynamodb', 'elasticache', 'docdb', 'neptune'],
    operations: [
      {
        id: 'create-data-store', label: 'Create data store', resourceKind: 'data store', risk: 'write', description: 'Create a discovered database family with safe defaults and explicit capacity choices.',
        fields: [regionField, nameField('Data store name', 'app-data'), { id: 'family', label: 'Database family', description: 'Choose a managed database family.', kind: 'choice', required: true, defaultValue: 'dynamodb', options: [option('dynamodb', 'DynamoDB', 'NoSQL table with on-demand capacity.'), option('elasticache-redis', 'ElastiCache for Redis', 'Managed Redis-compatible cache.'), option('documentdb', 'DocumentDB', 'Document-compatible cluster.'), option('neptune', 'Neptune', 'Managed graph database cluster.')] }, { id: 'encrypted', label: 'Encrypt stored data', description: 'Keep encryption enabled for the created data store.', kind: 'boolean', required: true, defaultValue: true }],
        progressStages: ['Validate family and network', 'Create data store', 'Wait for availability'], recoveryAction: 'Review family availability and network prerequisites, then retry.'
      },
      destructive('delete-data-stores', 'Delete selected data stores', 'data stores')
    ]
  },
  {
    id: 'vpc', label: 'Virtual Private Cloud', description: 'VPCs, subnets, routes, gateways, security groups and reachability.', services: ['ec2'],
    operations: [
      {
        id: 'create-vpc', label: 'Create VPC', resourceKind: 'VPC', risk: 'write', description: 'Create a VPC with a reviewed IPv4 CIDR and DNS settings.',
        fields: [regionField, nameField('VPC name', 'app-vpc'), { id: 'cidr', label: 'IPv4 CIDR', description: 'Private IPv4 address range for this network.', kind: 'text', required: true, defaultValue: '10.0.0.0/16', pattern: '^(10|172|192)\\.' }, { id: 'dnsHostnames', label: 'DNS hostnames', description: 'Enable DNS hostnames for instances in the VPC.', kind: 'boolean', required: true, defaultValue: true }],
        progressStages: ['Validate CIDR', 'Create VPC', 'Apply DNS attributes', 'Read back network'], recoveryAction: 'Correct the overlapping or invalid CIDR, then retry.'
      },
      {
        id: 'create-subnet', label: 'Create subnet', resourceKind: 'subnet', risk: 'write', description: 'Create a subnet inside a selected VPC and availability zone.',
        fields: [nameField('Subnet name', 'app-subnet'), { id: 'cidr', label: 'Subnet IPv4 CIDR', description: 'A CIDR contained by the selected VPC.', kind: 'text', required: true, defaultValue: '10.0.1.0/24', pattern: '^(10|172|192)\\.' }],
        progressStages: ['Validate containment', 'Create subnet', 'Apply tags', 'Read back subnet'], recoveryAction: 'Choose a non-overlapping CIDR inside the VPC, then retry.'
      },
      destructive('delete-vpcs', 'Delete selected VPCs', 'VPCs')
    ]
  },
  {
    id: 'route53', label: 'Route 53', description: 'Hosted zones, records, routing policies, health checks and safe deletion.', services: ['route53'],
    operations: [
      {
        id: 'change-record', label: 'Create or update record', resourceKind: 'DNS record', risk: 'write', description: 'Preview and apply one validated DNS record change.',
        fields: [{ id: 'recordName', label: 'Record name', description: 'A suggested DNS name inside the selected hosted zone.', kind: 'text', required: true, defaultValue: 'app.example.com', pattern: '^[A-Za-z0-9._-]{1,253}$' }, { id: 'recordType', label: 'Record type', description: 'Choose a supported DNS record type.', kind: 'choice', required: true, defaultValue: 'A', options: [option('A', 'A', 'IPv4 address record.'), option('AAAA', 'AAAA', 'IPv6 address record.'), option('CNAME', 'CNAME', 'Canonical-name record.'), option('TXT', 'TXT', 'Text record.'), option('MX', 'MX', 'Mail exchanger record.')] }, { id: 'ttl', label: 'TTL (seconds)', description: 'Caching lifetime for non-alias records.', kind: 'number', required: true, defaultValue: 300, minimum: 0, maximum: 2147483647, step: 1 }],
        progressStages: ['Validate record', 'Preview change batch', 'Apply change', 'Wait for INSYNC'], recoveryAction: 'Review the exact invalid record or policy, then retry the change.'
      },
      destructive('delete-hosted-zones', 'Delete selected hosted zones', 'hosted zones')
    ]
  },
  {
    id: 'cost', label: 'Cost and usage', description: 'Cost Explorer, budgets, forecasts, anomaly monitors and allocation tags.', services: ['ce', 'budgets', 'cost-optimization-hub'],
    operations: [
      {
        id: 'cost-report', label: 'Run cost report', resourceKind: 'cost report', risk: 'read', description: 'Generate a bounded cost and usage view over a selected date range and grouping.',
        fields: [{ id: 'startDate', label: 'Start date', description: 'Inclusive report start date.', kind: 'date', required: true, defaultValue: '2026-01-01' }, { id: 'endDate', label: 'End date', description: 'Exclusive report end date.', kind: 'date', required: true, defaultValue: '2026-02-01' }, { id: 'granularity', label: 'Granularity', description: 'Choose how cost totals are grouped over time.', kind: 'choice', required: true, defaultValue: 'MONTHLY', options: [option('DAILY', 'Daily', 'One total per day.'), option('MONTHLY', 'Monthly', 'One total per month.')] }],
        progressStages: ['Validate date range', 'Request cost pages', 'Aggregate pages', 'Render partial or complete report'], recoveryAction: 'Shorten the date range or retry pages that were unavailable.'
      },
      {
        id: 'create-budget', label: 'Create budget', resourceKind: 'budget', risk: 'write', description: 'Create a monthly cost budget with a reviewed amount and notification threshold.',
        fields: [nameField('Budget name', 'monthly-budget'), { id: 'amount', label: 'Monthly amount', description: 'Positive budget amount in the selected billing currency.', kind: 'number', required: true, defaultValue: 100, minimum: 0.01, maximum: 1000000000, step: 0.01 }, { id: 'thresholdPercent', label: 'Alert threshold (%)', description: 'Percentage of the budget that triggers the alert.', kind: 'number', required: true, defaultValue: 80, minimum: 1, maximum: 100, step: 1 }],
        progressStages: ['Validate budget', 'Create budget', 'Read back notifications'], recoveryAction: 'Correct the amount, threshold or billing scope, then retry.'
      }
    ]
  }
] as const

const MANAGER_SET = new Set<string>(AWS_RESOURCE_MANAGER_IDS)

export function isAwsResourceManagerId(value: unknown): value is AwsResourceManagerId {
  return typeof value === 'string' && MANAGER_SET.has(value)
}

export function awsResourceManager(manager: AwsResourceManagerId): AwsResourceManagerDefinition {
  return AWS_RESOURCE_MANAGERS.find((entry) => entry.id === manager) ?? AWS_RESOURCE_MANAGERS[0]
}

export function createAwsResourceManagerIntent(manager: AwsResourceManagerId = 'ecr'): AwsResourceManagerIntent {
  const definition = awsResourceManager(manager)
  const operation = definition.operations[0]
  const safeValues = Object.fromEntries(operation.fields.map((field) => [field.id, field.defaultValue]))
  return {
    schema: AWS_RESOURCE_MANAGER_SCHEMA,
    manager,
    operation: operation.id,
    ...(typeof safeValues.region === 'string' ? { preferredRegion: safeValues.region } : {}),
    safeValues
  }
}

const safeString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 256 || /[\u0000-\u001f\u007f]/.test(trimmed)) return null
  return trimmed
}

/**
 * Validate a portable manager template. Unknown keys are refused by the schema 3 parent object;
 * this validator constrains the values and discards anything that is not declared by the selected
 * operation, preventing a hand-edited project from smuggling an ARN or credential-shaped field.
 */
export function validateAwsResourceManagerIntent(input: unknown): AwsResourceManagerIntent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('AWS manager intent must be an object.')
  const value = input as Record<string, unknown>
  const allowed = new Set(['schema', 'manager', 'operation', 'preferredRegion', 'safeValues'])
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`AWS manager intent contains unsupported field ${key}.`)
  if (value.schema !== AWS_RESOURCE_MANAGER_SCHEMA) throw new Error('AWS manager intent schema is unsupported.')
  if (!isAwsResourceManagerId(value.manager)) throw new Error('AWS manager intent has an unknown manager.')
  const definition = awsResourceManager(value.manager)
  const operationId = safeString(value.operation)
  const operation = operationId ? definition.operations.find((entry) => entry.id === operationId) : undefined
  if (!operation) throw new Error('AWS manager intent has an unknown operation.')
  if (!value.safeValues || typeof value.safeValues !== 'object' || Array.isArray(value.safeValues)) throw new Error('AWS manager safe values must be an object.')
  const rawValues = value.safeValues as Record<string, unknown>
  const fields = new Map(operation.fields.map((field) => [field.id, field]))
  const safeValues: Record<string, string | number | boolean> = {}
  for (const [key, raw] of Object.entries(rawValues)) {
    const field = fields.get(key)
    if (!field) throw new Error(`AWS manager safe values contain unsupported field ${key}.`)
    if (field.kind === 'number') {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`${field.label} must be a number.`)
      if (field.minimum !== undefined && raw < field.minimum) throw new Error(`${field.label} is below its minimum.`)
      if (field.maximum !== undefined && raw > field.maximum) throw new Error(`${field.label} is above its maximum.`)
      safeValues[key] = raw
    } else if (field.kind === 'boolean') {
      if (typeof raw !== 'boolean') throw new Error(`${field.label} must be on or off.`)
      safeValues[key] = raw
    } else {
      const text = safeString(raw)
      if (!text) throw new Error(`${field.label} must be a bounded visible value.`)
      if (field.pattern && !new RegExp(field.pattern).test(text)) throw new Error(`${field.label} does not match the required format.`)
      if (field.options && !field.options.some((item) => item.value === text)) throw new Error(`${field.label} is not a supported choice.`)
      safeValues[key] = text
    }
  }
  for (const field of operation.fields) {
    if (field.required && safeValues[field.id] === undefined) safeValues[field.id] = field.defaultValue
  }
  const preferredRegion = value.preferredRegion === undefined ? undefined : safeString(value.preferredRegion)
  if (value.preferredRegion !== undefined && !preferredRegion) throw new Error('AWS preferred region is invalid.')
  return {
    schema: AWS_RESOURCE_MANAGER_SCHEMA,
    manager: value.manager,
    operation: operation.id,
    ...(preferredRegion ? { preferredRegion } : {}),
    safeValues
  }
}

export function validateAwsManagerRunRequest(request: AwsManagerRunRequest): AwsManagerRunRequest {
  const intent = validateAwsResourceManagerIntent({
    schema: AWS_RESOURCE_MANAGER_SCHEMA,
    manager: request.manager,
    operation: request.operation,
    safeValues: request.values
  })
  if (!Array.isArray(request.resourceIds) || request.resourceIds.length > 500) throw new Error('Select no more than 500 AWS resources at once.')
  const resourceIds = request.resourceIds.map((id) => {
    const safe = safeString(id)
    if (!safe || safe.length > 512) throw new Error('AWS resource selection is invalid.')
    return safe
  })
  return { manager: intent.manager, operation: intent.operation, values: intent.safeValues, resourceIds }
}
