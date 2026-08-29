/**
 * Cloudflare manager contracts. This module contains only transport-neutral data and the
 * deliberately finite operation vocabulary. The core client is the only place that knows the
 * Cloudflare URL layout; renderer callers never provide a URL, HTTP method, or request body.
 */

export type CloudflareTokenStatus = { present: boolean; storage: 'encrypted' | 'restricted-file' | 'unavailable' }

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

export interface CloudflareErrorInfo {
  code: CloudflareApiErrorCode
  message: string
  retryAfterSeconds: number | null
  requestId: string | null
}

export interface CloudflareStatus {
  configured: boolean
  authenticated: boolean
  accountCount: number | null
  checkedAt: number
  error: CloudflareErrorInfo | null
}

export interface CloudflareTokenPermissions {
  valid: boolean
  status: string | null
  checkedAt: number
  capabilities: string[]
}

export interface CloudflareAccount {
  id: string
  name: string
  type: string | null
  createdAt: string | null
}

export interface CloudflareZone {
  id: string
  name: string
  status: string
  paused: boolean
  plan: string | null
  nameServers: string[]
}

export interface CloudflareDnsRecord {
  id: string
  type: string
  name: string
  content: string
  ttl: number
  proxied: boolean | null
  priority: number | null
  comment: string | null
  tags: string[]
  modifiedOn: string | null
}

export interface CloudflareSslTlsSetting {
  id: string
  value: string
  editable: boolean
  modifiedOn: string | null
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

export interface CloudflareRedirectRule {
  id: string
  expression: string
  target: string
  statusCode: 301 | 302
  preserveQueryString: boolean
  enabled: boolean
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

export interface CloudflarePage<T> {
  items: T[]
  page: number
  perPage: number
  totalPages: number
  totalItems: number
  complete: boolean
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

export interface CloudflareRulesetInput {
  name: string
  description?: string
  phase: 'http_request_firewall_custom' | 'http_request_transform' | 'http_request_redirect' | 'http_ratelimit'
  rules: Array<{ action: 'block' | 'js_challenge' | 'managed_challenge' | 'skip' | 'rewrite' | 'redirect'; expression: string; enabled?: boolean; description?: string }>
}

export interface CloudflareRedirectRuleInput {
  expression: string
  target: string
  statusCode: 301 | 302
  preserveQueryString?: boolean
  enabled?: boolean
}

export interface CloudflareSslTlsUpdateInput {
  settingId: 'tls_1_0' | 'tls_1_1' | 'min_tls_version' | 'opportunistic_encryption' | 'automatic_https_rewrites' | 'always_use_https'
  value: string | boolean
}

export type CloudflareMutationPreview = {
  operation: string
  resource: string
  destructive: boolean
  summary: string
  affectedIds: string[]
}

export interface CloudflareApi {
  tokenStatus(): Promise<CloudflareTokenStatus>
  saveToken(token: string): Promise<CloudflareTokenStatus>
  clearToken(): Promise<CloudflareTokenStatus>
  status(): Promise<CloudflareStatus>
  permissions(): Promise<CloudflareTokenPermissions>
  accounts(page?: number): Promise<CloudflarePage<CloudflareAccount>>
  zones(page?: number): Promise<CloudflarePage<CloudflareZone>>
  dnsRecords(zoneId: string, page?: number, search?: string): Promise<CloudflarePage<CloudflareDnsRecord>>
  sslTlsSettings(zoneId: string): Promise<CloudflareSslTlsSetting[]>
  rulesets(zoneId: string, page?: number): Promise<CloudflarePage<CloudflareRuleset>>
  redirectRules(zoneId: string, page?: number): Promise<CloudflarePage<CloudflareRedirectRule>>
  analytics(zoneId: string, since: string, until: string): Promise<CloudflareAnalytics>
  createDnsRecord(zoneId: string, input: CloudflareDnsRecordInput): Promise<CloudflareDnsRecord>
  updateDnsRecord(zoneId: string, recordId: string, input: CloudflareDnsRecordInput): Promise<CloudflareDnsRecord>
  previewDeleteDnsRecord(zoneId: string, recordId: string): Promise<CloudflareMutationPreview>
  deleteDnsRecord(zoneId: string, recordId: string, preview: CloudflareMutationPreview): Promise<void>
  updateSslTlsSetting(zoneId: string, input: CloudflareSslTlsUpdateInput): Promise<CloudflareSslTlsSetting>
  createRuleset(zoneId: string, input: CloudflareRulesetInput): Promise<CloudflareRuleset>
  updateRuleset(zoneId: string, rulesetId: string, input: CloudflareRulesetInput): Promise<CloudflareRuleset>
  previewDeleteRuleset(zoneId: string, rulesetId: string): Promise<CloudflareMutationPreview>
  deleteRuleset(zoneId: string, rulesetId: string, preview: CloudflareMutationPreview): Promise<void>
  createRedirectRule(zoneId: string, input: CloudflareRedirectRuleInput): Promise<CloudflareRedirectRule>
  updateRedirectRule(zoneId: string, ruleId: string, input: CloudflareRedirectRuleInput): Promise<CloudflareRedirectRule>
  previewDeleteRedirectRule(zoneId: string, ruleId: string): Promise<CloudflareMutationPreview>
  deleteRedirectRule(zoneId: string, ruleId: string, preview: CloudflareMutationPreview): Promise<void>
  previewPurgeCache(input: { zoneId: string; scope: 'everything' | 'urls'; urls?: string[] }): Promise<CloudflareCachePurgePreview>
  purgeCache(preview: CloudflareCachePurgePreview): Promise<void>
}

export const CLOUDFLARE_MANAGER_TABS = ['accounts', 'zones', 'dns', 'ssl-tls', 'rulesets', 'redirects', 'cache', 'analytics'] as const

export type CloudflareManagerTab = (typeof CLOUDFLARE_MANAGER_TABS)[number]
