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
  { id: 'cloudflare-r2', manager: 'r2', label: 'Cloudflare R2', keywords: ['bucket', 'object', 'storage'], documentation: 'docs/features/cloudflare-managers.md#r2', availability: 'requires-account', writes: true, destructiveActions: ['delete-bucket'] },
  { id: 'cloudflare-d1', manager: 'd1', label: 'Cloudflare D1', keywords: ['database', 'sqlite'], documentation: 'docs/features/cloudflare-managers.md#d1', availability: 'requires-account', writes: true, destructiveActions: ['delete-database'] },
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

/**
 * Recovered from the "feat(integrations): add Cloudflare manager" lineage (e0ef7faff), which the
 * merge that produced this file dropped in favour of the generic Zero Trust CloudflareApi above.
 * `src/core/cloudflare/manager.ts`, `catalog.ts`, `token-vault.ts`, and
 * `src/renderer/components/cloudflare/CloudflareManagerPanel.tsx` still reference this exact
 * vocabulary, so it is restored verbatim rather than reinvented.
 *
 * A handful of names from that same lineage — CloudflareApi, CloudflarePage, CloudflareAccount,
 * CloudflareZone, CloudflareDnsRecord, CloudflareErrorInfo, CloudflareMutationPreview — are NOT
 * restored here because they collide, under the identical name, with a DIFFERENT shape already
 * kept above (the Zero Trust generic manager) and/or with a third shape from
 * "feat(remote): add Cloudflare tunnel settings" (e9476a5b9, which CloudflareSection.tsx still
 * needs for CloudflareConfigurationPreview/CloudflareDnsAdoptionPreview/CloudflareTunnelInventory).
 * Resolving those collisions requires a maintainer decision about which manager owns the name;
 * see the accompanying report rather than guessing at a merged shape here.
 */

export const CLOUDFLARE_MANAGER_TABS = ['accounts', 'zones', 'dns', 'ssl-tls', 'rulesets', 'redirects', 'cache', 'analytics'] as const

export type CloudflareManagerTab = (typeof CLOUDFLARE_MANAGER_TABS)[number]

export type CloudflareApiErrorCode =
  | 'not-configured'
  | 'invalid-token'
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limited'
  | 'unreachable'
  | 'invalid-response'
  | 'not-found'
  | 'validation'

export type CloudflareTokenStatus = { present: boolean; storage: 'encrypted' | 'restricted-file' | 'unavailable' }

export interface CloudflareTokenPermissions {
  valid: boolean
  status: string | null
  checkedAt: number
  capabilities: string[]
}

export interface CloudflareSslTlsSetting {
  id: string
  value: string
  editable: boolean
  modifiedOn: string | null
}

export interface CloudflareSslTlsUpdateInput {
  settingId: 'tls_1_0' | 'tls_1_1' | 'min_tls_version' | 'opportunistic_encryption' | 'automatic_https_rewrites' | 'always_use_https'
  value: string | boolean
}

export interface CloudflareRuleset {
  id: string
  name: string
  description: string | null
  kind: string
  phase: string
  state: string
  rules: Array<{ id: string; action: string; expression: string; enabled: boolean; description: string | null }>
}

export interface CloudflareRulesetInput {
  name: string
  description?: string
  phase: 'http_request_firewall_custom' | 'http_request_transform' | 'http_request_redirect' | 'http_ratelimit'
  rules: Array<{ action: 'block' | 'js_challenge' | 'managed_challenge' | 'skip' | 'rewrite' | 'redirect'; expression: string; enabled?: boolean; description?: string }>
}

export interface CloudflareRedirectRule {
  id: string
  expression: string
  target: string
  statusCode: 301 | 302
  preserveQueryString: boolean
  enabled: boolean
}

export interface CloudflareRedirectRuleInput {
  expression: string
  target: string
  statusCode: 301 | 302
  preserveQueryString?: boolean
  enabled?: boolean
}

export interface CloudflareCachePurgePreview {
  zoneId: string
  scope: 'everything' | 'urls'
  urls: string[]
  destructive: true
  summary: string
}

export interface CloudflareAnalyticsPoint {
  timestamp: string
  requests: number
  bandwidthBytes: number
  threats: number
  cachedRequests: number
}

export interface CloudflareAnalytics {
  zoneId: string
  since: string
  until: string
  points: CloudflareAnalyticsPoint[]
  truncated: boolean
}

export interface CloudflareDnsRecordInput {
  type: 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'NS' | 'SRV' | 'CAA'
  name: string
  content: string
  ttl?: number
  proxied?: boolean
  priority?: number
  comment?: string
  tags?: string[]
}
