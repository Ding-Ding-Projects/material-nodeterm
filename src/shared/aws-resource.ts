/**
 * Guided AWS Resource Explorer and Cloud Control contract.
 *
 * The persisted node keeps only portable intent. Profile names, account bindings, role sessions,
 * endpoints, request tokens, resource identifiers, result pages, CLI paths, and credentials stay
 * machine-local or transient.
 */

export type AwsManagerMode = 'resource-explorer' | 'cloud-control'

export interface AwsManagerPortableIntent {
  schemaVersion: 1
  mode: AwsManagerMode
  regionIntent: string
  resourceQuery: string
  cloudControlTypeName: string
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
  | 'resource-list-views'
  | 'resource-search'
  | 'cloud-list-types'
  | 'cloud-list-resources'
  | 'cloud-get-resource'
  | 'cloud-create-resource'
  | 'cloud-update-resource'
  | 'cloud-delete-resource'
  | 'cloud-request-status'

export interface AwsManagerRequest {
  operation: AwsManagerOperation
  query?: string
  viewArn?: string
  typeName?: string
  identifier?: string
  desiredState?: string
  patchDocument?: string
  requestToken?: string
  nextToken?: string
  maxResults?: number
}

export type AwsOperationRisk = 'read-only' | 'write' | 'destructive'

export interface AwsOperationPreview {
  service: 'resource-explorer-2' | 'cloudcontrol' | 'cloudformation'
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
  const mode: AwsManagerMode = raw.mode === 'cloud-control' ? 'cloud-control' : 'resource-explorer'
  const regionIntent = isAwsRegion(raw.regionIntent) ? raw.regionIntent.trim() : AWS_MANAGER_DEFAULT_INTENT.regionIntent
  const resourceQuery = typeof raw.resourceQuery === 'string' && raw.resourceQuery.length <= 1024
    ? raw.resourceQuery
    : AWS_MANAGER_DEFAULT_INTENT.resourceQuery
  const cloudControlTypeName = isCloudControlTypeName(raw.cloudControlTypeName)
    ? raw.cloudControlTypeName.trim()
    : ''
  return { schemaVersion: 1, mode, regionIntent, resourceQuery, cloudControlTypeName }
}

