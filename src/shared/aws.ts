/**
 * AWS Resource Explorer and Cloud Control shared contracts.
 *
 * The renderer receives typed, redacted previews only. Credentials, signed headers, and raw
 * authorization material stay inside the core service and are never included in these values.
 */

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

export type AwsPermissionState = 'allowed' | 'denied' | 'unknown'

export interface AwsPage<T> {
  items: T[]
  nextToken: string | null
  page: number
  complete: boolean
  source: 'resource-explorer' | 'tagging-api-fallback' | 'cloud-control'
  permission: AwsPermissionState
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
  permission: AwsPermissionState
  partial: boolean
  detail: string | null
  preview: AwsCrudPreview
}

export interface AwsApi {
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
