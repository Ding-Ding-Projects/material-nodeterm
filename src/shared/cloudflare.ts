/**
 * Shared Cloudflare manager contracts.
 *
 * These types are deliberately narrower than Cloudflare's wire payloads. They describe the
 * records that may cross the core to renderer boundary, never bearer values, request URLs, SQL,
 * shell text, or an arbitrary GraphQL document. A missing read and an empty result remain distinct
 * through every manager state.
 */

export const CLOUDFLARE_API_ORIGIN = 'https://api.cloudflare.com'
export const CLOUDFLARE_MANAGER_VERSION = 1 as const

export const CLOUDFLARE_MANAGER_KINDS = [
  'access',
  'zero-trust',
  'workers',
  'pages',
  'r2',
  'd1',
  'queues'
] as const

export type CloudflareManagerKind = (typeof CLOUDFLARE_MANAGER_KINDS)[number]

export type CloudflareSecretPresence = 'present' | 'absent' | 'unknown'
export type CloudflareReadState = 'idle' | 'loading' | 'ready' | 'partial' | 'error'
export type CloudflarePermissionState = 'known' | 'unknown' | 'denied'

export interface CloudflarePermissionSnapshot {
  state: CloudflarePermissionState
  /** Permission names only. Tokens and token metadata never cross this boundary. */
  permissions: string[]
  checkedAt: number | null
  reason: string | null
}

export interface CloudflarePageInfo {
  page: number
  perPage: number
  totalPages: number | null
  total: number | null
  hasMore: boolean
}

export interface CloudflarePartialFailure {
  page: number
  message: string
  retryable: boolean
}

export interface CloudflarePage<T> {
  items: T[]
  pageInfo: CloudflarePageInfo
  state: Exclude<CloudflareReadState, 'idle' | 'loading'>
  failures: CloudflarePartialFailure[]
  fetchedAt: number
}

export interface CloudflareAccessApplication {
  id: string
  name: string
  type: string
  domain: string | null
  createdAt: string | null
  updatedAt: string | null
  enabled: boolean | null
}

export interface CloudflareAccessPolicy {
  id: string
  name: string
  decision: 'allow' | 'deny' | 'bypass' | 'non_identity' | 'service_auth' | 'unknown'
  precedence: number | null
  applicationId: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface CloudflareZeroTrustDevicePolicy {
  id: string
  name: string
  precedence: number | null
  enabled: boolean | null
  platform: string | null
  updatedAt: string | null
}

export interface CloudflareZeroTrustGatewayRule {
  id: string
  name: string
  action: string
  precedence: number | null
  enabled: boolean | null
  updatedAt: string | null
}

export interface CloudflareWorkerScript {
  id: string
  name: string
  etag: string | null
  createdAt: string | null
  modifiedAt: string | null
  usageModel: string | null
}

export interface CloudflarePageProject {
  id: string
  name: string
  subdomain: string | null
  productionBranch: string | null
  deploymentCount: number | null
  createdAt: string | null
  latestDeploymentId: string | null
}

export interface CloudflareR2Bucket {
  name: string
  location: string | null
  storageClass: string | null
  creationDate: string | null
}

export interface CloudflareD1Database {
  id: string
  name: string
  version: string | null
  readReplication: boolean | null
  createdAt: string | null
}

export interface CloudflareQueue {
  queueId: string
  queueName: string
  createdAt: string | null
  producers: number | null
  consumers: number | null
}

export interface CloudflareManagerRecords {
  access: CloudflareAccessApplication | CloudflareAccessPolicy
  'zero-trust': CloudflareZeroTrustDevicePolicy | CloudflareZeroTrustGatewayRule
  workers: CloudflareWorkerScript
  pages: CloudflarePageProject
  r2: CloudflareR2Bucket
  d1: CloudflareD1Database
  queues: CloudflareQueue
}

export interface CloudflareManagerSnapshot<K extends CloudflareManagerKind = CloudflareManagerKind> {
  version: typeof CLOUDFLARE_MANAGER_VERSION
  manager: K
  accountId: string
  state: CloudflareReadState
  page: CloudflarePageInfo
  items: CloudflareManagerRecords[K][]
  failures: CloudflarePartialFailure[]
  permissions: CloudflarePermissionSnapshot
  secret: CloudflareSecretPresence
  fetchedAt: number | null
  error: string | null
}

export interface CloudflareAccountSummary {
  id: string
  name: string
  status: string | null
  createdAt: string | null
}

export interface CloudflareGraphqlCost {
  requestedQueryCost: number | null
  actualQueryCost: number | null
  maximumAvailable: number | null
  remaining: number | null
  resetAt: string | null
}

export type CloudflareGraphqlOperation = 'account-summary' | 'workers-analytics'

export interface CloudflareGraphqlResult<T> {
  operation: CloudflareGraphqlOperation
  data: T | null
  cost: CloudflareGraphqlCost
  state: 'ready' | 'partial' | 'error'
  error: string | null
}

export type CloudflareResourceTarget =
  | { manager: 'access'; accountId: string; applicationId: string }
  | { manager: 'zero-trust'; accountId: string; ruleId: string }
  | { manager: 'workers'; accountId: string; scriptName: string }
  | { manager: 'pages'; accountId: string; projectName: string }
  | { manager: 'r2'; accountId: string; bucketName: string }
  | { manager: 'd1'; accountId: string; databaseId: string }
  | { manager: 'queues'; accountId: string; queueName: string }

export type CloudflareMutation =
  | {
      manager: 'access'
      action: 'create-application'
      accountId: string
      input: { name: string; domain: string; type: 'self_hosted' | 'saas' | 'ssh' }
    }
  | {
      manager: 'access'
      action: 'delete-application'
      target: Extract<CloudflareResourceTarget, { manager: 'access' }>
    }
  | {
      manager: 'zero-trust'
      action: 'create-gateway-rule'
      accountId: string
      input: { name: string; action: 'allow' | 'block' | 'isolate'; expression: string }
    }
  | {
      manager: 'zero-trust'
      action: 'delete-gateway-rule'
      target: Extract<CloudflareResourceTarget, { manager: 'zero-trust' }>
    }
  | {
      manager: 'workers'
      action: 'deploy-script'
      accountId: string
      input: { scriptName: string; source: string; compatibilityDate?: string }
    }
  | {
      manager: 'workers'
      action: 'delete-script'
      target: Extract<CloudflareResourceTarget, { manager: 'workers' }>
    }
  | {
      manager: 'pages'
      action: 'create-project'
      accountId: string
      input: { name: string; productionBranch: string }
    }
  | {
      manager: 'pages'
      action: 'delete-project'
      target: Extract<CloudflareResourceTarget, { manager: 'pages' }>
    }
  | {
      manager: 'r2'
      action: 'create-bucket'
      accountId: string
      input: { name: string; locationHint?: string }
    }
  | {
      manager: 'r2'
      action: 'delete-bucket'
      target: Extract<CloudflareResourceTarget, { manager: 'r2' }>
    }
  | {
      manager: 'd1'
      action: 'create-database'
      accountId: string
      input: { name: string; primaryLocationHint?: string }
    }
  | {
      manager: 'd1'
      action: 'delete-database'
      target: Extract<CloudflareResourceTarget, { manager: 'd1' }>
    }
  | {
      manager: 'queues'
      action: 'create-queue'
      accountId: string
      input: { queueName: string }
    }
  | {
      manager: 'queues'
      action: 'delete-queue'
      target: Extract<CloudflareResourceTarget, { manager: 'queues' }>
    }

export type CloudflareDestructiveMutation = Extract<CloudflareMutation, {
  action: `delete-${string}`
}>

export interface CloudflareMutationPreview {
  id: string
  manager: CloudflareManagerKind
  action: CloudflareMutation['action']
  target: CloudflareResourceTarget
  impact: string[]
  createdAt: number
  expiresAt: number
  requiresSuperConfirmation: true
}

export type CloudflareMutationResult =
  | { ok: true; manager: CloudflareManagerKind; action: CloudflareMutation['action']; id: string | null }
  | { ok: false; manager: CloudflareManagerKind; action: CloudflareMutation['action']; error: string; retryable: boolean }

export interface CloudflareMutationConfirmation {
  previewId: string
  confirm: true
}

export interface CloudflareNodeCatalogEntry {
  id: `cloudflare-${CloudflareManagerKind}`
  manager: CloudflareManagerKind
  label: string
  keywords: string[]
  documentation: string
  availability: 'available' | 'requires-account'
  writes: boolean
  destructiveActions: string[]
}

export const CLOUDFLARE_MANAGER_CATALOG: readonly CloudflareNodeCatalogEntry[] = [
  { id: 'cloudflare-access', manager: 'access', label: 'Cloudflare Access', keywords: ['identity', 'application', 'policy'], documentation: 'docs/features/cloudflare-managers.md#access', availability: 'requires-account', writes: true, destructiveActions: ['delete-application'] },
  { id: 'cloudflare-zero-trust', manager: 'zero-trust', label: 'Cloudflare Zero Trust', keywords: ['gateway', 'device', 'rule'], documentation: 'docs/features/cloudflare-managers.md#zero-trust', availability: 'requires-account', writes: true, destructiveActions: ['delete-gateway-rule'] },
  { id: 'cloudflare-workers', manager: 'workers', label: 'Cloudflare Workers', keywords: ['script', 'deploy', 'worker'], documentation: 'docs/features/cloudflare-managers.md#workers', availability: 'requires-account', writes: true, destructiveActions: ['delete-script'] },
  { id: 'cloudflare-pages', manager: 'pages', label: 'Cloudflare Pages', keywords: ['project', 'deployment', 'site'], documentation: 'docs/features/cloudflare-managers.md#pages', availability: 'requires-account', writes: true, destructiveActions: ['delete-project'] },
  { id: 'cloudflare-r2', manager: 'Cloudflare R2', keywords: ['bucket', 'object', 'storage'], documentation: 'docs/features/cloudflare-managers.md#r2', availability: 'requires-account', writes: true, destructiveActions: ['delete-bucket'] },
  { id: 'cloudflare-d1', manager: 'Cloudflare D1', label: 'Cloudflare D1', keywords: ['database', 'sqlite'], documentation: 'docs/features/cloudflare-managers.md#d1', availability: 'requires-account', writes: true, destructiveActions: ['delete-database'] },
  { id: 'cloudflare-queues', manager: 'queues', label: 'Cloudflare Queues', keywords: ['queue', 'consumer', 'producer'], documentation: 'docs/features/cloudflare-managers.md#queues', availability: 'requires-account', writes: true, destructiveActions: ['delete-queue'] }
]

export interface CloudflareApi {
  secretPresence(): Promise<CloudflareSecretPresence>
  permissions(accountId: string): Promise<CloudflarePermissionSnapshot>
  list<K extends CloudflareManagerKind>(manager: K, accountId: string, page?: number, perPage?: number): Promise<CloudflareManagerSnapshot<K>>
  listAll<K extends CloudflareManagerKind>(manager: K, accountId: string, perPage?: number): Promise<CloudflareManagerSnapshot<K>>
  graphql<T>(operation: CloudflareGraphqlOperation, accountId: string): Promise<CloudflareGraphqlResult<T>>
  preview(mutation: CloudflareDestructiveMutation): Promise<CloudflareMutationPreview>
  mutate(mutation: CloudflareMutation, confirmation?: CloudflareMutationConfirmation): Promise<CloudflareMutationResult>
}
