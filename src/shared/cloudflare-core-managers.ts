/**
 * Typed Cloudflare account, zone, DNS, SSL/TLS, ruleset, redirect, cache, and analytics managers.
 *
 * A canvas node stores only safe intent. API tokens, selected accounts, zone bindings, response
 * data, request cancellation, and provider sessions remain in the local host service.
 */

import type { TunnelFacet, TunnelLiveState } from './tunnel-state'

export const CLOUDFLARE_MANAGER_KINDS = [
  'account',
  'zone',
  'dns',
  'ssl-tls',
  'ruleset',
  'redirect',
  'cache',
  'analytics'
] as const

export type CloudflareManagerKind = (typeof CLOUDFLARE_MANAGER_KINDS)[number]

export type CloudflareOperation =
  | 'account-list' | 'account-get'
  | 'zone-list' | 'zone-get'
  | 'dns-list-records' | 'dns-create-record' | 'dns-update-record' | 'dns-delete-record'
  | 'ssl-list-settings' | 'ssl-get-setting' | 'ssl-update-setting'
  | 'ruleset-list' | 'ruleset-get' | 'ruleset-create' | 'ruleset-update' | 'ruleset-delete'
  | 'redirect-list' | 'redirect-create' | 'redirect-update' | 'redirect-delete'
  | 'cache-get-settings' | 'cache-update-settings' | 'cache-purge'
  | 'analytics-dashboard' | 'analytics-events'

export type CloudflareRisk = 'read-only' | 'write' | 'destructive'
export type CloudflareSafeValue = string | number | boolean | null

export interface CloudflarePortableIntent {
  schemaVersion: 1
  manager: CloudflareManagerKind
  operation: CloudflareOperation
  /** Safe account or zone naming intent only. IDs are intentionally not required to travel. */
  accountIdIntent?: string
  zoneNameIntent?: string
  /** Typed operation fields only. No token, endpoint, local path, response, or process state. */
  input: Record<string, CloudflareSafeValue>
}

export interface CloudflareCredentialSummary {
  id: string
  label: string
  accountId: string | null
  createdAt: number
  updatedAt: number
}

export interface CloudflareBinding {
  nodeId: string
  credentialId: string
  accountId: string | null
  zoneId: string | null
  zoneName: string | null
  updatedAt: number
}

export interface CloudflareRuntimeStatus {
  available: boolean
  origin: 'built-in' | 'unavailable'
  version: string | null
  disabledReason: string | null
}

export interface CloudflareOperationRequest {
  manager: CloudflareManagerKind
  operation: CloudflareOperation
  /** Machine-local credential selection for unbound account/zone discovery. Never portable. */
  credentialId?: string
  input?: Record<string, unknown>
  page?: number
  perPage?: number
}

export interface CloudflareOperationPreview {
  manager: CloudflareManagerKind
  operation: CloudflareOperation
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query: Record<string, string>
  /** Typed body with secrets removed. Null for bodyless operations. */
  body: Record<string, unknown> | null
  risk: CloudflareRisk
  destructive: boolean
  pagination: 'none' | 'page'
}

export interface CloudflareOperationResult {
  operationId: string
  manager: CloudflareManagerKind
  operation: CloudflareOperation
  rows: Array<Record<string, unknown>>
  nextPage: number | null
  total: number | null
  summary: string
  completedAt: number
}

export interface CloudflareProgress {
  operationId: string
  nodeId: string
  phase: 'started' | 'completed' | 'cancelled' | 'failed'
  message: string
}

export interface CloudflareCoreManagersApi {
  runtime(): Promise<CloudflareRuntimeStatus>
  credentials(): Promise<CloudflareCredentialSummary[]>
  saveCredential(input: { label: string; token: string; accountId?: string | null }): Promise<CloudflareCredentialSummary>
  removeCredential(credentialId: string): Promise<boolean>
  binding(nodeId: string): Promise<CloudflareBinding | null>
  bind(input: { nodeId: string; credentialId: string; accountId?: string | null; zoneId?: string | null; zoneName?: string | null }): Promise<CloudflareBinding>
  unbind(nodeId: string): Promise<boolean>
  preview(nodeId: string, request: CloudflareOperationRequest): Promise<CloudflareOperationPreview>
  execute(nodeId: string, request: CloudflareOperationRequest): Promise<CloudflareOperationResult>
  cancel(operationId: string): Promise<boolean>
  onProgress(listener: (progress: CloudflareProgress) => void): () => void
  /** Local-only six-facet tunnel observation. Unknown is preserved when this stack lacks a probe. */
  tunnelState(nodeId: string): Promise<TunnelLiveState>
  /** Start one bounded facet observation, replacing only an older generation for this node. */
  probeTunnelFacet(nodeId: string, facet: TunnelFacet): Promise<TunnelLiveState>
  /** Cancel the active facet observation for one node without changing its last trustworthy state. */
  cancelTunnelProbe(nodeId: string): Promise<boolean>
  /** Emits a complete state after each accepted facet transition. */
  onTunnelState(listener: (state: TunnelLiveState & { nodeId: string }) => void): () => void
}

/** Short alias used by host integrations that name this surface Cloudflare Core. */
export type CloudflareCoreApi = CloudflareCoreManagersApi

export const CLOUDFLARE_DEFAULT_INTENT: CloudflarePortableIntent = {
  schemaVersion: 1,
  manager: 'account',
  operation: 'account-list',
  input: {}
}

export const CLOUDFLARE_OPERATIONS_BY_MANAGER: Record<CloudflareManagerKind, readonly CloudflareOperation[]> = {
  account: ['account-list', 'account-get'],
  zone: ['zone-list', 'zone-get'],
  dns: ['dns-list-records', 'dns-create-record', 'dns-update-record', 'dns-delete-record'],
  'ssl-tls': ['ssl-list-settings', 'ssl-get-setting', 'ssl-update-setting'],
  ruleset: ['ruleset-list', 'ruleset-get', 'ruleset-create', 'ruleset-update', 'ruleset-delete'],
  redirect: ['redirect-list', 'redirect-create', 'redirect-update', 'redirect-delete'],
  cache: ['cache-get-settings', 'cache-update-settings', 'cache-purge'],
  analytics: ['analytics-dashboard', 'analytics-events']
}

export const CLOUDFLARE_OPERATION_LABELS: Record<CloudflareOperation, string> = {
  'account-list': 'List accounts', 'account-get': 'Get account',
  'zone-list': 'List zones', 'zone-get': 'Get zone',
  'dns-list-records': 'List DNS records', 'dns-create-record': 'Create DNS record',
  'dns-update-record': 'Update DNS record', 'dns-delete-record': 'Delete DNS record',
  'ssl-list-settings': 'List SSL/TLS settings', 'ssl-get-setting': 'Get SSL/TLS setting',
  'ssl-update-setting': 'Update SSL/TLS setting',
  'ruleset-list': 'List rulesets', 'ruleset-get': 'Get ruleset',
  'ruleset-create': 'Create ruleset', 'ruleset-update': 'Update ruleset', 'ruleset-delete': 'Delete ruleset',
  'redirect-list': 'List redirect rules', 'redirect-create': 'Create redirect rule',
  'redirect-update': 'Update redirect rule', 'redirect-delete': 'Delete redirect rule',
  'cache-get-settings': 'Get cache settings', 'cache-update-settings': 'Update cache settings',
  'cache-purge': 'Purge cache',
  'analytics-dashboard': 'Read analytics dashboard', 'analytics-events': 'Read analytics events'
}

/** Hand-written search inventory. Every field has its own adjacent anchored regex builder in UI. */
export const CLOUDFLARE_SEARCH_SURFACES = [
  'account-list', 'zone-list', 'dns-record-list', 'ssl-setting-list',
  'ruleset-list', 'redirect-list', 'cache-setting-list', 'analytics-result-list'
] as const

const MANAGER_BY_OPERATION: Record<CloudflareOperation, CloudflareManagerKind> = Object.fromEntries(
  Object.entries(CLOUDFLARE_OPERATIONS_BY_MANAGER).flatMap(([manager, operations]) => operations.map((operation) => [operation, manager]))
) as Record<CloudflareOperation, CloudflareManagerKind>

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const ZONE_NAME = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}\.?$/

export function isCloudflareId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value.trim())
}

export function isCloudflareZoneName(value: unknown): value is string {
  return typeof value === 'string' && ZONE_NAME.test(value.trim())
}

export function normalizeCloudflareIntent(value: unknown): CloudflarePortableIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...CLOUDFLARE_DEFAULT_INTENT, input: {} }
  const raw = value as Record<string, unknown>
  const manager = CLOUDFLARE_MANAGER_KINDS.includes(raw.manager as CloudflareManagerKind) ? raw.manager as CloudflareManagerKind : 'account'
  const options = CLOUDFLARE_OPERATIONS_BY_MANAGER[manager]
  const operation = options.includes(raw.operation as CloudflareOperation) ? raw.operation as CloudflareOperation : options[0]
  const input: Record<string, CloudflareSafeValue> = {}
  if (raw.input && typeof raw.input === 'object' && !Array.isArray(raw.input)) {
    for (const [key, item] of Object.entries(raw.input as Record<string, unknown>).slice(0, 32)) {
      if (key.length > 128 || key === '__proto__' || key === 'constructor' || key === 'prototype') continue
      if (/token|secret|password|credential|authorization|private.?key/i.test(key)) continue
      if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)) || (typeof item === 'string' && item.length <= 4096)) input[key] = item as CloudflareSafeValue
    }
  }
  return {
    schemaVersion: 1,
    manager,
    operation,
    ...(isCloudflareId(raw.accountIdIntent) ? { accountIdIntent: raw.accountIdIntent.trim() } : {}),
    ...(isCloudflareZoneName(raw.zoneNameIntent) ? { zoneNameIntent: raw.zoneNameIntent.trim().toLowerCase() } : {}),
    input
  }
}

export function cloudflareManagerForOperation(operation: CloudflareOperation): CloudflareManagerKind {
  return MANAGER_BY_OPERATION[operation]
}
