import {
  CLOUDFLARE_API_ORIGIN,
  type CloudflareAccessApplication,
  type CloudflareAccountSummary,
  type CloudflareD1Database,
  type CloudflareGraphqlCost,
  type CloudflareGraphqlOperation,
  type CloudflareGraphqlResult,
  type CloudflareManagerKind,
  type CloudflareManagerRecords,
  type CloudflarePageInfo,
  type CloudflarePermissionSnapshot,
  type CloudflareQueue,
  type CloudflareR2Bucket,
  type CloudflareSecretPresence,
  type CloudflareWorkerScript,
  type CloudflarePageProject,
  type CloudflareZeroTrustDevicePolicy,
  type CloudflareZeroTrustGatewayRule
} from '../../shared/cloudflare'

export const CLOUDFLARE_MAX_PAGE_SIZE = 100
export const CLOUDFLARE_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
export const CLOUDFLARE_MAX_ERROR_BYTES = 4 * 1024
export const CLOUDFLARE_MAX_GRAPHQL_COST = 1_000

const GRAPHQL_DOCUMENTS: Record<CloudflareGraphqlOperation, string> = {
  'account-summary': `query AccountSummary($accountTag: String!) { viewer { accounts(filter: { accountTag: $accountTag }) { id name status createdAt } } }`,
  'workers-analytics': `query WorkersAnalytics($accountTag: String!) { viewer { accounts(filter: { accountTag: $accountTag }) { workersInvocationsAdaptive(limit: 100, filter: { datetime_geq: "1970-01-01T00:00:00Z" }) { sum { requests } } } } }`
}

export interface CloudflareTokenProvider {
  /** The secret is consumed only inside this client and is never returned by a manager API. */
  read(): Promise<string | null>
  /** Presence is the only credential fact that may cross a UI boundary. */
  presence(): Promise<CloudflareSecretPresence>
}

export interface CloudflareClientOptions {
  token?: CloudflareTokenProvider
  fetch?: typeof fetch
  maxResponseBytes?: number
  timeoutMs?: number
  now?: () => number
}

export class CloudflareClientError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'missing-secret'
      | 'invalid-request'
      | 'response-too-large'
      | 'malformed-response'
      | 'request-failed'
      | 'rate-limited'
      | 'permission-denied'
      | 'graphql-cost-exceeded',
    readonly status?: number,
    readonly retryAt?: number
  ) {
    super(message)
    this.name = 'CloudflareClientError'
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function boundedString(value: unknown, max = 2_048): string | null {
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null
}

function id(value: unknown, max = 256): string | null {
  const text = boundedString(value, max)
  return text && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text) ? text : null
}

function name(value: unknown, max = 256): string | null {
  const text = boundedString(value, max)?.trim() ?? ''
  return text.length > 0 ? text : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function dateOrNull(value: unknown): string | null {
  const text = boundedString(value, 80)
  return text && !Number.isNaN(Date.parse(text)) ? text : null
}

function safeErrorText(value: unknown): string {
  const text = boundedString(value, CLOUDFLARE_MAX_ERROR_BYTES) ?? 'Cloudflare request failed.'
  return text
    .replace(/bearer\s+[a-z0-9._~+/=-]+/gi, 'bearer [redacted]')
    .replace(/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^,;\s]+/gi, '$1=[redacted]')
}

/** Redact an untrusted provider value before it can reach a notification, history record, or
 * diagnostic. Keys are redacted even when the value was not known to the caller, and known secret
 * values are replaced without reporting their length or shape. */
export function redactCloudflarePayload(value: unknown, secretValues: readonly string[] = [], depth = 0): unknown {
  if (depth > 8) return '[redacted:depth-limit]'
  if (typeof value === 'string') {
    return secretValues.reduce((current, secret) => secret.length > 0 ? current.split(secret).join('[redacted]') : current, value).slice(0, 4_096)
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => redactCloudflarePayload(entry, secretValues, depth + 1))
  const item = record(value)
  if (!item) return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(item).slice(0, 100)) {
    if (/token|secret|password|authorization|api[_-]?key|private[_-]?key|credential/i.test(key)) out[key] = '[redacted]'
    else out[key] = redactCloudflarePayload(entry, secretValues, depth + 1)
  }
  return out
}

function pathSegment(value: string, label: string): string {
  const text = value.trim()
  if (text.length === 0 || text.length > 256 || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new CloudflareClientError(`Invalid ${label}.`, 'invalid-request')
  }
  return encodeURIComponent(text)
}

function mutationPath(path: string, action: 'create' | 'put' | 'remove'): string {
  const allowed = [
    /^\/accounts\/[^/]+\/access\/apps(?:\/[^/]+)?$/,
    /^\/accounts\/[^/]+\/gateway\/rules(?:\/[^/]+)?$/,
    /^\/accounts\/[^/]+\/workers\/scripts\/[^/]+$/,
    /^\/accounts\/[^/]+\/pages\/projects(?:\/[^/]+)?$/,
    /^\/accounts\/[^/]+\/r2\/buckets(?:\/[^/]+)?$/,
    /^\/accounts\/[^/]+\/d1\/database(?:\/[^/]+)?$/,
    /^\/accounts\/[^/]+\/queues(?:\/[^/]+)?$/
  ]
  if (!allowed.some((pattern) => pattern.test(path))) throw new CloudflareClientError(`Unregistered Cloudflare ${action} path.`, 'invalid-request')
  return path
}

function positiveInteger(value: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= max
}

async function boundedBody(response: Response, maximum: number): Promise<Uint8Array> {
  const advertised = Number(response.headers.get('content-length'))
  if (Number.isFinite(advertised) && advertised > maximum) {
    throw new CloudflareClientError('Cloudflare response exceeded the bounded response limit.', 'response-too-large', response.status)
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    total += next.value.byteLength
    if (total > maximum) {
      await reader.cancel()
      throw new CloudflareClientError('Cloudflare response exceeded the bounded response limit.', 'response-too-large', response.status)
    }
    chunks.push(next.value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

interface CloudflareEnvelope<T> {
  success: boolean
  result: T
  resultInfo?: Record<string, unknown>
  errors: Array<{ code: number | null; message: string }>
}

function envelope<T>(value: unknown, status: number): CloudflareEnvelope<T> {
  const item = record(value)
  if (!item || typeof item.success !== 'boolean' || !Array.isArray(item.errors)) {
    throw new CloudflareClientError('Cloudflare returned an unexpected response shape.', 'malformed-response', status)
  }
  const errors = item.errors.slice(0, 20).map((entry) => {
    const error = record(entry)
    return {
      code: error && typeof error.code === 'number' ? error.code : null,
      message: safeErrorText(error?.message)
    }
  })
  return {
    success: item.success,
    result: item.result as T,
    resultInfo: record(item.result_info) ?? undefined,
    errors
  }
}

function pageInfo(info: Record<string, unknown> | undefined, page: number, perPage: number): CloudflarePageInfo {
  const totalPages = numberOrNull(info?.total_pages)
  const total = numberOrNull(info?.total)
  const current = numberOrNull(info?.page) ?? page
  return {
    page: current,
    perPage: numberOrNull(info?.per_page) ?? perPage,
    totalPages,
    total,
    hasMore: totalPages === null ? false : current < totalPages
  }
}

function items(value: unknown, collectionKey?: string): unknown[] {
  const candidate = Array.isArray(value) ? value : collectionKey ? record(value)?.[collectionKey] : null
  if (!Array.isArray(candidate) || candidate.length > CLOUDFLARE_MAX_PAGE_SIZE) {
    throw new CloudflareClientError('Cloudflare returned an invalid page.', 'malformed-response')
  }
  return candidate
}

function accessApplication(value: unknown): CloudflareAccessApplication {
  const item = record(value)
  const applicationId = id(item?.id)
  const applicationName = name(item?.name)
  if (!applicationId || !applicationName) throw new CloudflareClientError('Cloudflare returned an invalid Access application.', 'malformed-response')
  return {
    id: applicationId,
    name: applicationName,
    type: boundedString(item?.type, 64) ?? 'unknown',
    domain: boundedString(item?.domain, 512),
    createdAt: dateOrNull(item?.created_at ?? item?.createdAt),
    updatedAt: dateOrNull(item?.updated_at ?? item?.updatedAt),
    enabled: typeof item?.enabled === 'boolean' ? item.enabled : null
  }
}

function zeroTrustDevice(value: unknown): CloudflareZeroTrustDevicePolicy {
  const item = record(value)
  const policyId = id(item?.id)
  const policyName = name(item?.name)
  if (!policyId || !policyName) throw new CloudflareClientError('Cloudflare returned an invalid Zero Trust device policy.', 'malformed-response')
  return {
    id: policyId,
    name: policyName,
    precedence: numberOrNull(item?.precedence),
    enabled: typeof item?.enabled === 'boolean' ? item.enabled : null,
    platform: boundedString(item?.platform, 64),
    updatedAt: dateOrNull(item?.updated_at ?? item?.updatedAt)
  }
}

function zeroTrustGateway(value: unknown): CloudflareZeroTrustGatewayRule {
  const item = record(value)
  const ruleId = id(item?.id)
  const ruleName = name(item?.name)
  if (!ruleId || !ruleName) throw new CloudflareClientError('Cloudflare returned an invalid Zero Trust gateway rule.', 'malformed-response')
  return {
    id: ruleId,
    name: ruleName,
    action: boundedString(item?.action, 64) ?? 'unknown',
    precedence: numberOrNull(item?.precedence),
    enabled: typeof item?.enabled === 'boolean' ? item.enabled : null,
    updatedAt: dateOrNull(item?.updated_at ?? item?.updatedAt)
  }
}

function worker(value: unknown): CloudflareWorkerScript {
  const item = record(value)
  const scriptId = id(item?.id ?? item?.name)
  const scriptName = name(item?.name ?? item?.id)
  if (!scriptId || !scriptName) throw new CloudflareClientError('Cloudflare returned an invalid Worker script.', 'malformed-response')
  return {
    id: scriptId,
    name: scriptName,
    etag: boundedString(item?.etag, 256),
    createdAt: dateOrNull(item?.created_on ?? item?.createdAt),
    modifiedAt: dateOrNull(item?.modified_on ?? item?.modifiedAt),
    usageModel: boundedString(item?.usage_model ?? item?.usageModel, 64)
  }
}

function pagesProject(value: unknown): CloudflarePageProject {
  const item = record(value)
  const projectId = id(item?.id ?? item?.name)
  const projectName = name(item?.name ?? item?.id)
  if (!projectId || !projectName) throw new CloudflareClientError('Cloudflare returned an invalid Pages project.', 'malformed-response')
  return {
    id: projectId,
    name: projectName,
    subdomain: boundedString(item?.subdomain, 512),
    productionBranch: boundedString(item?.production_branch ?? item?.productionBranch, 256),
    deploymentCount: numberOrNull(item?.deployment_count ?? item?.deploymentCount),
    createdAt: dateOrNull(item?.created_on ?? item?.createdAt),
    latestDeploymentId: id(item?.latest_deployment?.id ?? item?.latestDeploymentId)
  }
}

function r2Bucket(value: unknown): CloudflareR2Bucket {
  const item = record(value)
  const bucketName = name(item?.name)
  if (!bucketName) throw new CloudflareClientError('Cloudflare returned an invalid R2 bucket.', 'malformed-response')
  return {
    name: bucketName,
    location: boundedString(item?.location, 128),
    storageClass: boundedString(item?.storage_class ?? item?.storageClass, 128),
    creationDate: dateOrNull(item?.creation_date ?? item?.creationDate)
  }
}

function d1Database(value: unknown): CloudflareD1Database {
  const item = record(value)
  const databaseId = id(item?.uuid ?? item?.id)
  const databaseName = name(item?.name)
  if (!databaseId || !databaseName) throw new CloudflareClientError('Cloudflare returned an invalid D1 database.', 'malformed-response')
  return {
    id: databaseId,
    name: databaseName,
    version: boundedString(item?.version, 64),
    readReplication: typeof item?.read_replication === 'boolean' ? item.read_replication : null,
    createdAt: dateOrNull(item?.created_at ?? item?.createdAt)
  }
}

function queue(value: unknown): CloudflareQueue {
  const item = record(value)
  const queueId = id(item?.queue_id ?? item?.queueId ?? item?.id)
  const queueName = name(item?.queue_name ?? item?.queueName ?? item?.name)
  if (!queueId || !queueName) throw new CloudflareClientError('Cloudflare returned an invalid Queue.', 'malformed-response')
  return {
    queueId,
    queueName,
    createdAt: dateOrNull(item?.created_at ?? item?.createdAt),
    producers: numberOrNull(item?.producers),
    consumers: numberOrNull(item?.consumers)
  }
}

type PageDecoder<K extends CloudflareManagerKind> = (value: unknown) => CloudflareManagerRecords[K][]

const ENDPOINTS: Record<CloudflareManagerKind, (accountId: string, page: number, perPage: number) => string> = {
  access: (a, p, s) => `/accounts/${pathSegment(a, 'account id')}/access/apps?page=${p}&per_page=${s}`,
  'zero-trust': (a, p, s) => `/accounts/${pathSegment(a, 'account id')}/devices/policies?page=${p}&per_page=${s}`,
  workers: (a, p, s) => `/accounts/${pathSegment(a, 'account id')}/workers/scripts?page=${p}&per_page=${s}`,
  pages: (a, p, s) => `/accounts/${pathSegment(a, 'account id')}/pages/projects?page=${p}&per_page=${s}`,
  r2: (a, p, s) => `/accounts/${pathSegment(a, 'account id')}/r2/buckets?page=${p}&per_page=${s}`,
  d1: (a, p, s) => `/accounts/${pathSegment(a, 'account id')}/d1/database?page=${p}&per_page=${s}`,
  queues: (a, p, s) => `/accounts/${pathSegment(a, 'account id')}/queues?page=${p}&per_page=${s}`
}

const DECODERS: Record<CloudflareManagerKind, PageDecoder<any>> = {
  access: (value) => items(value).map(accessApplication),
  'zero-trust': (value) => items(value).map(zeroTrustDevice),
  workers: (value) => items(value).map(worker),
  pages: (value) => items(value).map(pagesProject),
  r2: (value) => items(value, 'buckets').map(r2Bucket),
  d1: (value) => items(value, 'result').map(d1Database),
  queues: (value) => items(value, 'queues').map(queue)
}

function graphqlCost(value: unknown): CloudflareGraphqlCost {
  const item = record(value)
  return {
    requestedQueryCost: numberOrNull(item?.requestedQueryCost),
    actualQueryCost: numberOrNull(item?.actualQueryCost),
    maximumAvailable: numberOrNull(item?.maximumAvailable),
    remaining: numberOrNull(item?.throttleStatus && record(item.throttleStatus)?.currentlyAvailable),
    resetAt: dateOrNull(item?.resetAt ?? (item?.throttleStatus && record(item.throttleStatus)?.resetAt))
  }
}

export class CloudflareClient {
  private readonly fetcher: typeof fetch
  private readonly maximum: number
  private readonly timeoutMs: number
  private readonly now: () => number

  constructor(private readonly options: CloudflareClientOptions = {}) {
    this.fetcher = options.fetch ?? fetch
    this.maximum = options.maxResponseBytes ?? CLOUDFLARE_MAX_RESPONSE_BYTES
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.now = options.now ?? Date.now
  }

  async secretPresence(): Promise<CloudflareSecretPresence> {
    return this.options.token ? this.options.token.presence() : 'absent'
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.options.token?.read()
    if (!token) throw new CloudflareClientError('A Cloudflare credential has not been configured.', 'missing-secret')
    if (token.length > 4_096 || /[\u0000\r\n]/.test(token)) {
      throw new CloudflareClientError('The configured Cloudflare credential is invalid.', 'missing-secret')
    }
    return { authorization: `Bearer ${token}`, accept: 'application/json' }
  }

  private async request(path: string, init: RequestInit = {}): Promise<{ status: number; value: unknown }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetcher(`${CLOUDFLARE_API_ORIGIN}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { ...(await this.authHeaders()), ...(init.headers ?? {}) }
      })
      const bytes = await boundedBody(response, this.maximum)
      let parsed: unknown
      try { parsed = bytes.length === 0 ? {} : JSON.parse(new TextDecoder().decode(bytes)) } catch {
        throw new CloudflareClientError('Cloudflare returned invalid JSON.', 'malformed-response', response.status)
      }
      return { status: response.status, value: parsed }
    } catch (error) {
      if (error instanceof CloudflareClientError) throw error
      throw new CloudflareClientError('Cloudflare could not be reached before the request deadline.', 'request-failed')
    } finally {
      clearTimeout(timer)
    }
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<CloudflareEnvelope<T>> {
    const response = await this.request(path, init)
    const result = envelope<T>(response.value, response.status)
    if (!response.value || !result.success || ![200, 201, 202, 204].includes(response.status)) {
      const message = result.errors[0]?.message ?? `Cloudflare returned HTTP ${response.status}.`
      const code = response.status === 429 ? 'rate-limited' : response.status === 403 ? 'permission-denied' : 'request-failed'
      throw new CloudflareClientError(message, code, response.status)
    }
    return result
  }

  async list<K extends CloudflareManagerKind>(
    manager: K,
    accountId: string,
    page = 1,
    perPage = CLOUDFLARE_MAX_PAGE_SIZE
  ): Promise<{ items: CloudflareManagerRecords[K][]; pageInfo: CloudflarePageInfo; fetchedAt: number }> {
    if (!positiveInteger(page, 100_000) || !positiveInteger(perPage, CLOUDFLARE_MAX_PAGE_SIZE)) {
      throw new CloudflareClientError('The Cloudflare page request is outside the supported bounds.', 'invalid-request')
    }
    const result = await this.json<unknown>(ENDPOINTS[manager](accountId, page, perPage))
    return {
      items: DECODERS[manager](result.result),
      pageInfo: pageInfo(result.resultInfo, page, perPage),
      fetchedAt: this.now()
    }
  }

  async graphql<T>(operation: CloudflareGraphqlOperation, accountId: string): Promise<CloudflareGraphqlResult<T>> {
    const document = GRAPHQL_DOCUMENTS[operation]
    if (!document) throw new CloudflareClientError('The GraphQL operation is not registered.', 'invalid-request')
    pathSegment(accountId, 'account id')
    const response = await this.request('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: document, variables: { accountTag: accountId } })
    })
    const body = record(response.value)
    if (!body) throw new CloudflareClientError('Cloudflare returned an unexpected GraphQL response shape.', 'malformed-response', response.status)
    const cost = graphqlCost(record(body?.extensions)?.cost)
    const requested = cost.requestedQueryCost
    if (requested !== null && requested > CLOUDFLARE_MAX_GRAPHQL_COST) {
      throw new CloudflareClientError('The registered GraphQL operation exceeded the bounded query-cost limit.', 'graphql-cost-exceeded')
    }
    const errors = Array.isArray(body?.errors) ? body.errors : []
    return {
      operation,
      data: (body?.data as T | undefined) ?? null,
      cost,
      state: errors.length > 0 ? (body?.data ? 'partial' : 'error') : 'ready',
      error: errors.length > 0 ? safeErrorText(record(errors[0])?.message) : null
    }
  }

  async accountSummary(accountId: string): Promise<CloudflareAccountSummary | null> {
    const result = await this.graphql<{ viewer?: { accounts?: unknown[] } }>('account-summary', accountId)
    const item = record(result.data)?.viewer && record(record(result.data)?.viewer)?.accounts
    const first = Array.isArray(item) ? record(item[0]) : null
    if (!first) return null
    const accountIdValue = id(first.id)
    const accountName = name(first.name)
    if (!accountIdValue || !accountName) throw new CloudflareClientError('Cloudflare returned an invalid account summary.', 'malformed-response')
    return { id: accountIdValue, name: accountName, status: boundedString(first.status, 64), createdAt: dateOrNull(first.createdAt) }
  }

  async create(path: string, body: Record<string, unknown>): Promise<{ id: string | null }> {
    const result = await this.json<unknown>(mutationPath(path, 'create'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    const item = record(result.result)
    return { id: id(item?.id ?? item?.uuid ?? item?.name) }
  }

  async put(path: string, body: Record<string, unknown>): Promise<{ id: string | null }> {
    const result = await this.json<unknown>(mutationPath(path, 'put'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    const item = record(result.result)
    return { id: id(item?.id ?? item?.uuid ?? item?.name) }
  }

  /** Workers accepts the script as the request body. Keeping this operation separate prevents a
   * generic JSON writer from accidentally turning a typed source deployment into an arbitrary body
   * editor. */
  async putWorkerScript(accountId: string, scriptName: string, source: string, compatibilityDate?: string): Promise<{ id: string | null }> {
    const account = pathSegment(accountId, 'account id')
    const script = pathSegment(scriptName, 'script name')
    const result = await this.json<unknown>(mutationPath(`/accounts/${account}/workers/scripts/${script}`, 'put'), {
      method: 'PUT',
      headers: {
        'content-type': 'application/javascript',
        ...(compatibilityDate ? { 'cf-compatibility-date': compatibilityDate } : {})
      },
      body: source
    })
    const item = record(result.result)
    return { id: id(item?.id ?? item?.name) }
  }

  async remove(path: string): Promise<void> {
    await this.json<unknown>(mutationPath(path, 'remove'), { method: 'DELETE' })
  }
}
