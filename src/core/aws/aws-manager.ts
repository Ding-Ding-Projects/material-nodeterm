import {
  AWS_DEFAULT_PAGE_SIZE,
  AWS_DEFAULT_REGION,
  AWS_MAX_PAGES,
  clampAwsPageSize,
  isAwsResourceIdentifier,
  isAwsResourceTypeName,
  type AwsCloudControlResource,
  type AwsCrudAction,
  type AwsCrudPreview,
  type AwsCrudResult,
  type AwsManagerStatus,
  type AwsPage,
  type AwsRequestContext,
  type AwsResource,
  type AwsResourceType
} from '../../shared/aws'
import {
  AwsHttpError,
  AwsJsonClient,
  credentialsFromEnvironment,
  errorDetail,
  isPermissionError,
  type AwsClientOptions,
  type AwsCredentials
} from './client'

export interface AwsManagerOptions extends Omit<AwsClientOptions, 'region'> {
  region?: string
  credentials?: AwsCredentials | null
}

interface ResourceExplorerSearchResponse {
  Resources?: Array<{
    Arn?: string
    OwningAccountId?: string
    Region?: string
    ResourceType?: string
    Properties?: Array<{ Name?: string; Data?: string }>
  }>
  NextToken?: string
}

interface TaggingResponse {
  ResourceTagMappingList?: Array<{ ResourceARN?: string; Tags?: Array<{ Key?: string; Value?: string }> }>
  PaginationToken?: string
}

interface CloudControlTypeResponse {
  ResourceTypeSummaries?: Array<{
    TypeName?: string
    Description?: string
    ProvisioningType?: string
    RequiredProperties?: string[]
    ListHandlerProgress?: Record<string, unknown>
    Handlers?: Record<string, { Permissions?: string[] }>
  }>
  NextToken?: string
}

interface CloudControlListResponse {
  ResourceDescriptions?: Array<{ Identifier?: string; Properties?: string }>
  NextToken?: string
}

interface CloudControlProgress {
  ProgressEvent?: {
    Identifier?: string
    RequestToken?: string
    OperationStatus?: string
    StatusMessage?: string
    ResourceModel?: string
  }
}

function accountFromArn(arn: string): string | null {
  const match = /^arn:[^:]+:[^:]*:[^:]*:([^:]*):/.exec(arn)
  return match?.[1] || null
}

function serviceFromArn(arn: string): string | null {
  const match = /^arn:[^:]+:([^:]*):/.exec(arn)
  return match?.[1] || null
}

function parseProperties(value: string | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function cloudEndpoint(region: string): string {
  return `https://cloudcontrolapi.${region}.amazonaws.com/`
}

function explorerEndpoint(region: string): string {
  return `https://resource-explorer-2.${region}.amazonaws.com/`
}

function taggingEndpoint(region: string): string {
  return `https://tagging.${region}.amazonaws.com/`
}

function clampMaxPages(value: number | undefined): number {
  if (!Number.isFinite(value)) return AWS_MAX_PAGES
  return Math.max(1, Math.min(AWS_MAX_PAGES, Math.floor(value!)))
}

function crudOperation(action: AwsCrudAction): string {
  return action === 'list' ? 'ListResources' : action === 'read' ? 'GetResource' : action === 'create' ? 'CreateResource' : action === 'update' ? 'UpdateResource' : 'DeleteResource'
}

/**
 * Typed managers for AWS Resource Explorer 2 and Cloud Control API. All provider calls go through
 * signed HTTPS requests from this core module. There is intentionally no CLI or shell fallback.
 */
export class AwsManager {
  private readonly client: AwsJsonClient

  constructor(options: AwsManagerOptions = {}) {
    const region = options.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? AWS_DEFAULT_REGION
    this.client = new AwsJsonClient({
      ...options,
      region,
      credentials: options.credentials === undefined ? credentialsFromEnvironment() : options.credentials
    })
  }

  async status(): Promise<AwsManagerStatus> {
    const checkedAt = Date.now()
    if (!this.hasCredentials()) {
      return { health: 'missing-credentials', region: this.client.region, profile: this.client.profile, accountId: this.client.accountId, detail: 'AWS credentials are not configured.', checkedAt }
    }
    try {
      const result = await this.client.query<{ Account?: string }>({
        service: 'sts',
        endpoint: `https://sts.${this.client.region}.amazonaws.com/`,
        operation: 'GetCallerIdentity',
        body: 'Action=GetCallerIdentity&Version=2011-06-15'
      })
      return { health: 'ready', region: this.client.region, profile: this.client.profile, accountId: result.Account ?? this.client.accountId, detail: null, checkedAt }
    } catch (error) {
      return {
        health: isPermissionError(error) ? 'permission-denied' : 'error',
        region: this.client.region,
        profile: this.client.profile,
        accountId: this.client.accountId,
        detail: errorDetail(error),
        checkedAt
      }
    }
  }

  context(input: {
    manager: 'resource-explorer' | 'cloud-control'
    region?: string
    service?: string
    operation: string
    parameters?: Record<string, unknown>
    pageSize?: number
    pageToken?: string | null
  }): AwsRequestContext {
    const service = input.service ?? (input.manager === 'resource-explorer' ? 'resource-explorer-2' : 'cloudcontrol')
    const region = input.region ?? this.client.region
    const endpoint = input.manager === 'resource-explorer' ? explorerEndpoint(region) : cloudEndpoint(region)
    return { ...this.client.context(input.manager, service, input.operation, endpoint, input.parameters ?? {}, clampAwsPageSize(input.pageSize), input.pageToken ?? null), region }
  }

  async discoverResources(input: { query?: string; region?: string; maxPages?: number }): Promise<AwsPage<AwsResource>> {
    const region = input.region ?? this.client.region
    const query = input.query?.trim() ?? ''
    const maxPages = clampMaxPages(input.maxPages)
    const context = this.context({ manager: 'resource-explorer', region, operation: 'Search', parameters: { QueryString: query } })
    const resources: AwsResource[] = []
    let token: string | null = null
    let page = 0
    if (!this.hasCredentials()) return this.page(resources, null, 0, false, 'resource-explorer', 'unknown', 'AWS credentials are not configured.', context)
    try {
      for (; page < maxPages; page++) {
        const body: Record<string, unknown> = { QueryString: query, MaxResults: AWS_DEFAULT_PAGE_SIZE }
        if (token) body.NextToken = token
        const result = await this.client.json<ResourceExplorerSearchResponse>({
          service: 'resource-explorer-2',
          target: 'AWS242ResourceExplorerService.Search',
          endpoint: explorerEndpoint(region),
          operation: 'Search',
          body
        })
        for (const item of result.Resources ?? []) {
          const arn = item.Arn?.trim()
          if (!arn) continue
          resources.push({
            arn,
            service: serviceFromArn(arn),
            resourceType: item.ResourceType ?? null,
            region: item.Region ?? region,
            accountId: item.OwningAccountId ?? accountFromArn(arn),
            properties: (item.Properties ?? []).filter((property) => typeof property.Name === 'string').map((property) => ({ name: property.Name!, value: property.Data ?? '' })),
            tags: {},
            discoveredBy: 'resource-explorer'
          })
        }
        token = result.NextToken?.trim() || null
        if (!token) return this.page(resources, null, page + 1, true, 'resource-explorer', 'allowed', null, context)
      }
      return this.page(resources, token, page, false, 'resource-explorer', 'allowed', 'Resource Explorer page limit reached before the service returned completion.', context)
    } catch (error) {
      if (isPermissionError(error) || (error instanceof AwsHttpError && error.status === 0)) {
        return this.discoverByTags(query, region, maxPages, context, errorDetail(error))
      }
      return this.page(resources, token, page, false, 'resource-explorer', isPermissionError(error) ? 'denied' : 'unknown', errorDetail(error), context)
    }
  }

  private async discoverByTags(query: string, region: string, maxPages: number, originalContext: AwsRequestContext, reason: string): Promise<AwsPage<AwsResource>> {
    const resources: AwsResource[] = []
    let token: string | null = null
    let page = 0
    const context = {
      ...this.context({ manager: 'resource-explorer', region, service: 'resourcegroupstaggingapi', operation: 'GetResources', parameters: { ResourcesPerPage: 100, Query: query }, pageToken: null }),
      endpoint: taggingEndpoint(region)
    }
    try {
      for (; page < maxPages; page++) {
        const body: Record<string, unknown> = { ResourcesPerPage: 100 }
        if (token) body.PaginationToken = token
        const result = await this.client.json<TaggingResponse>({ service: 'resourcegroupstaggingapi', target: 'ResourceGroups_20170126.GetResources', endpoint: taggingEndpoint(region), operation: 'GetResources', body })
        for (const item of result.ResourceTagMappingList ?? []) {
          const arn = item.ResourceARN?.trim()
          if (!arn || (query && !arn.toLowerCase().includes(query.toLowerCase()))) continue
          const tags: Record<string, string> = {}
          for (const tag of item.Tags ?? []) if (tag.Key) tags[tag.Key] = tag.Value ?? ''
          resources.push({ arn, service: serviceFromArn(arn), resourceType: null, region, accountId: accountFromArn(arn), properties: [], tags, discoveredBy: 'tagging-api-fallback' })
        }
        token = result.PaginationToken?.trim() || null
        if (!token) return this.page(resources, null, page + 1, true, 'tagging-api-fallback', 'allowed', `Resource Explorer was unavailable: ${reason}. Results came from the labeled Tagging API fallback.`, context)
      }
      return this.page(resources, token, page, false, 'tagging-api-fallback', 'allowed', `Resource Explorer was unavailable: ${reason}. Tagging API fallback reached its page limit.`, context)
    } catch (error) {
      return this.page(resources, token, page, false, 'tagging-api-fallback', isPermissionError(error) ? 'denied' : 'unknown', `Resource Explorer was unavailable: ${reason}. Tagging API fallback also returned: ${errorDetail(error)}`, { ...originalContext, operation: 'GetResources', service: 'resourcegroupstaggingapi', endpoint: taggingEndpoint(region) })
    }
  }

  async listResourceTypes(input: { region?: string; maxPages?: number } = {}): Promise<AwsPage<AwsResourceType>> {
    const maxPages = clampMaxPages(input.maxPages)
    const context = this.context({ manager: 'cloud-control', region: input.region, operation: 'ListResourceTypes', parameters: {} })
    const items: AwsResourceType[] = []
    let token: string | null = null
    let page = 0
    if (!this.hasCredentials()) return this.page(items, null, 0, false, 'cloud-control', 'unknown', 'AWS credentials are not configured.', context)
    try {
      for (; page < maxPages; page++) {
        const body: Record<string, unknown> = { MaxResults: AWS_DEFAULT_PAGE_SIZE }
        if (token) body.NextToken = token
        const result = await this.client.json<CloudControlTypeResponse>({ service: 'cloudcontrol', target: 'CloudApiService.ListResourceTypes', endpoint: cloudEndpoint(input.region ?? this.client.region), operation: 'ListResourceTypes', body })
        for (const type of result.ResourceTypeSummaries ?? []) if (type.TypeName && isAwsResourceTypeName(type.TypeName)) items.push({ typeName: type.TypeName, description: type.Description ?? null, schema: null, handlers: Object.keys(type.Handlers ?? {}), provisioningType: type.ProvisioningType ?? null, source: 'cloud-control' })
        token = result.NextToken?.trim() || null
        if (!token) return this.page(items, null, page + 1, true, 'cloud-control', 'allowed', null, context)
      }
      return this.page(items, token, page, false, 'cloud-control', 'allowed', 'Cloud Control resource type page limit reached before completion.', context)
    } catch (error) {
      return this.page(items, token, page, false, 'cloud-control', isPermissionError(error) ? 'denied' : 'unknown', errorDetail(error), context)
    }
  }

  async listResources(input: { typeName: string; region?: string; maxPages?: number }): Promise<AwsPage<AwsCloudControlResource>> {
    if (!isAwsResourceTypeName(input.typeName)) throw new Error('Cloud Control resource type name is invalid.')
    const maxPages = clampMaxPages(input.maxPages)
    const endpoint = cloudEndpoint(input.region ?? this.client.region)
    const context = this.context({ manager: 'cloud-control', region: input.region, operation: 'ListResources', parameters: { TypeName: input.typeName } })
    const items: AwsCloudControlResource[] = []
    let token: string | null = null
    let page = 0
    if (!this.hasCredentials()) return this.page(items, null, 0, false, 'cloud-control', 'unknown', 'AWS credentials are not configured.', context)
    try {
      for (; page < maxPages; page++) {
        const body: Record<string, unknown> = { TypeName: input.typeName, MaxResults: AWS_DEFAULT_PAGE_SIZE }
        if (token) body.NextToken = token
        const result = await this.client.json<CloudControlListResponse>({ service: 'cloudcontrol', target: 'CloudApiService.ListResources', endpoint, operation: 'ListResources', body })
        for (const resource of result.ResourceDescriptions ?? []) if (resource.Identifier && isAwsResourceIdentifier(resource.Identifier)) items.push({ typeName: input.typeName, identifier: resource.Identifier, properties: parseProperties(resource.Properties), status: null, statusMessage: null, requestToken: null })
        token = result.NextToken?.trim() || null
        if (!token) return this.page(items, null, page + 1, true, 'cloud-control', 'allowed', null, context)
      }
      return this.page(items, token, page, false, 'cloud-control', 'allowed', 'Cloud Control resource page limit reached before completion.', context)
    } catch (error) {
      return this.page(items, token, page, false, 'cloud-control', isPermissionError(error) ? 'denied' : 'unknown', errorDetail(error), context)
    }
  }

  async preview(input: { action: AwsCrudAction; typeName?: string; identifier?: string; properties?: Record<string, unknown>; region?: string }): Promise<AwsCrudPreview> {
    const typeName = input.typeName ?? ''
    if (input.action !== 'list' && !isAwsResourceTypeName(typeName)) throw new Error('A Cloud Control resource type is required.')
    if ((input.action === 'read' || input.action === 'update' || input.action === 'delete') && !isAwsResourceIdentifier(input.identifier ?? '')) throw new Error('A Cloud Control resource identifier is required.')
    const operation = crudOperation(input.action)
    return {
      action: input.action,
      service: 'cloudcontrol',
      operation,
      region: input.region ?? this.client.region,
      typeName,
      identifier: input.identifier ?? null,
      properties: input.properties ?? {},
      destructive: input.action === 'delete',
      generatedAt: Date.now(),
      context: this.context({ manager: 'cloud-control', operation, parameters: { TypeName: typeName, Identifier: input.identifier ?? null, Properties: input.properties ?? {} }, pageSize: AWS_DEFAULT_PAGE_SIZE })
    }
  }

  async readResource(input: { typeName: string; identifier: string; region?: string }): Promise<AwsCrudResult> {
    const preview = await this.preview({ action: 'read', ...input })
    try {
      const result = await this.client.json<CloudControlProgress>({ service: 'cloudcontrol', target: 'CloudApiService.GetResource', endpoint: cloudEndpoint(input.region ?? this.client.region), operation: 'GetResource', body: { TypeName: input.typeName, Identifier: input.identifier } })
      return this.crudResult(result, preview, false, 'allowed')
    } catch (error) {
      return { resource: null, permission: isPermissionError(error) ? 'denied' : 'unknown', partial: false, detail: errorDetail(error), preview }
    }
  }

  async createResource(input: { typeName: string; properties: Record<string, unknown>; region?: string }): Promise<AwsCrudResult> { return this.mutate('create', input, null) }
  async updateResource(input: { typeName: string; identifier: string; properties: Record<string, unknown>; region?: string }): Promise<AwsCrudResult> { return this.mutate('update', input, input.identifier) }
  async deleteResource(input: { typeName: string; identifier: string; region?: string }): Promise<AwsCrudResult> { return this.mutate('delete', input, input.identifier) }

  private async mutate(action: 'create' | 'update' | 'delete', input: { typeName: string; identifier?: string; properties?: Record<string, unknown>; region?: string }, identifier: string | null): Promise<AwsCrudResult> {
    const preview = await this.preview({ action, typeName: input.typeName, identifier: input.identifier, properties: input.properties, region: input.region })
    try {
      const body: Record<string, unknown> = { TypeName: input.typeName }
      if (action !== 'create') body.Identifier = input.identifier
      if (action !== 'delete') body.DesiredState = JSON.stringify(input.properties ?? {})
      const result = await this.client.json<CloudControlProgress>({ service: 'cloudcontrol', target: `CloudApiService.${crudOperation(action)}`, endpoint: cloudEndpoint(input.region ?? this.client.region), operation: crudOperation(action), body })
      return this.crudResult(result, preview, false, 'allowed')
    } catch (error) {
      return { resource: null, permission: isPermissionError(error) ? 'denied' : 'unknown', partial: false, detail: errorDetail(error), preview }
    }
  }

  private crudResult(result: CloudControlProgress, preview: AwsCrudPreview, partial: boolean, permission: 'allowed' | 'denied' | 'unknown'): AwsCrudResult {
    const event = result.ProgressEvent
    const resource: AwsCloudControlResource | null = event ? { typeName: preview.typeName, identifier: event.Identifier ?? preview.identifier ?? '', properties: parseProperties(event.ResourceModel), status: event.OperationStatus ?? null, statusMessage: event.StatusMessage ?? null, requestToken: event.RequestToken ?? null } : null
    return { resource, permission, partial, detail: event?.StatusMessage ?? null, preview }
  }

  private page<T>(items: T[], nextToken: string | null, page: number, complete: boolean, source: AwsPage<T>['source'], permission: AwsPage<T>['permission'], detail: string | null, context: AwsRequestContext): AwsPage<T> {
    return { items, nextToken, page, complete, source, permission, detail, context: { ...context, pageToken: nextToken } }
  }

  private hasCredentials(): boolean {
    return this.client.hasCredentials()
  }
}

export { AwsHttpError }
