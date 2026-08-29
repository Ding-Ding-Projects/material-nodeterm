import type {
  CloudflareAccount,
  CloudflareAnalytics,
  CloudflareDnsRecord,
  CloudflareDnsRecordInput,
  CloudflareErrorInfo,
  CloudflarePage,
  CloudflareRedirectRule,
  CloudflareRedirectRuleInput,
  CloudflareRuleset,
  CloudflareRulesetInput,
  CloudflareSslTlsSetting,
  CloudflareSslTlsUpdateInput,
  CloudflareZone
} from '../../shared/cloudflare'

const API_ROOT = 'https://api.cloudflare.com/client/v4'
const REQUEST_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const PAGE_SIZE = 50
const ID = /^[a-zA-Z0-9_-]{1,128}$/

export type CloudflareTokenReader = () => Promise<string | null>
export type CloudflareFetch = typeof fetch

export class CloudflareClientError extends Error {
  constructor(public readonly info: CloudflareErrorInfo) {
    super(info.message)
    this.name = 'CloudflareClientError'
  }
}

function safeId(value: string, label: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw validation(`${label} is invalid`)
  return value
}

function safeText(value: string, label: string, max = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw validation(`${label} is invalid`)
  return value
}

function validation(message: string): CloudflareClientError {
  return new CloudflareClientError({ code: 'validation', message, retryAfterSeconds: null, requestId: null })
}

function redact(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/[?&](?:api_token|token|key)=[^&\s]+/gi, '?[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[url redacted]')
    .slice(0, 500)
}

function errorForStatus(status: number, requestId: string | null, retryAfterSeconds: number | null): CloudflareClientError {
  const code = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? 'not-found' : status === 429 ? 'rate-limited' : 'unreachable'
  const message = status === 429 ? 'Cloudflare rate limit reached. Retry after the stated delay.' : `Cloudflare request was refused (HTTP ${status}).`
  return new CloudflareClientError({ code, message, retryAfterSeconds, requestId })
}

function requirePage(page: number | undefined): number {
  const n = page ?? 1
  if (!Number.isInteger(n) || n < 1 || n > 10_000) throw validation('Page must be an integer from 1 to 10000.')
  return n
}

function pageOf<T>(payload: any, map: (value: any) => T): CloudflarePage<T> {
  if (!payload || payload.success !== true || !Array.isArray(payload.result)) throw new CloudflareClientError({ code: 'invalid-response', message: 'Cloudflare returned an unexpected list response.', retryAfterSeconds: null, requestId: null })
  const info = payload.result_info ?? {}
  const page = Number.isInteger(info.page) ? info.page : 1
  const perPage = Number.isInteger(info.per_page) ? info.per_page : PAGE_SIZE
  const totalPages = Number.isInteger(info.total_pages) ? info.total_pages : page
  const totalItems = Number.isInteger(info.total_count) ? info.total_count : payload.result.length
  return { items: payload.result.map(map), page, perPage, totalPages, totalItems, complete: page >= totalPages }
}

export class CloudflareClient {
  constructor(
    private readonly readToken: CloudflareTokenReader,
    private readonly fetcher: CloudflareFetch = fetch
  ) {}

  private async request<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: Record<string, unknown>): Promise<T> {
    const token = await this.readToken()
    if (!token) throw new CloudflareClientError({ code: 'not-configured', message: 'Add a Cloudflare API token before connecting.', retryAfterSeconds: null, requestId: null })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await this.fetcher(`${API_ROOT}${path}`, {
        method,
        signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
      const requestId = response.headers.get('cf-ray') ?? response.headers.get('x-request-id')
      const retryHeader = Number(response.headers.get('retry-after'))
      const retryAfterSeconds = Number.isFinite(retryHeader) && retryHeader >= 0 ? Math.min(retryHeader, 3600) : null
      const raw = await response.text()
      if (raw.length > MAX_RESPONSE_BYTES) throw new CloudflareClientError({ code: 'invalid-response', message: 'Cloudflare response exceeded the supported size limit.', retryAfterSeconds: null, requestId })
      if (response.ok && raw.trim() === '') return null as T
      let payload: any
      try { payload = JSON.parse(raw) } catch { throw new CloudflareClientError({ code: 'invalid-response', message: 'Cloudflare returned invalid JSON.', retryAfterSeconds, requestId }) }
      if (!response.ok) throw errorForStatus(response.status, requestId, retryAfterSeconds)
      if (!payload?.success) {
        const first = Array.isArray(payload?.errors) ? payload.errors[0] : null
        throw new CloudflareClientError({ code: response.status === 429 ? 'rate-limited' : 'unreachable', message: redact(typeof first?.message === 'string' ? first.message : 'Cloudflare rejected the request.'), retryAfterSeconds, requestId })
      }
      return payload.result as T
    } catch (error) {
      if (error instanceof CloudflareClientError) throw error
      throw new CloudflareClientError({ code: 'unreachable', message: error instanceof Error && error.name === 'AbortError' ? 'Cloudflare request timed out.' : redact(error instanceof Error ? error.message : 'Cloudflare could not be reached.'), retryAfterSeconds: null, requestId: null })
    } finally { clearTimeout(timer) }
  }

  async accounts(pageInput?: number): Promise<CloudflarePage<CloudflareAccount>> {
    const page = requirePage(pageInput)
    return pageOf(await this.request<any>(`/accounts?page=${page}&per_page=${PAGE_SIZE}`, 'GET'), (x) => ({ id: safeId(x.id, 'Account id'), name: typeof x.name === 'string' ? x.name : 'Unnamed account', type: typeof x.type === 'string' ? x.type : null, createdAt: typeof x.created_on === 'string' ? x.created_on : null }))
  }

  async verifyToken(): Promise<{ id: string; status: string }> {
    const result = await this.request<{ id?: string; status?: string }>('/user/tokens/verify', 'GET')
    if (typeof result?.status !== 'string') throw new CloudflareClientError({ code: 'invalid-response', message: 'Cloudflare returned an unexpected token verification response.', retryAfterSeconds: null, requestId: null })
    return { id: typeof result.id === 'string' ? result.id : '', status: result.status }
  }

  async zones(pageInput?: number): Promise<CloudflarePage<CloudflareZone>> {
    const page = requirePage(pageInput)
    return pageOf(await this.request<any>(`/zones?page=${page}&per_page=${PAGE_SIZE}`, 'GET'), (x) => ({ id: safeId(x.id, 'Zone id'), name: typeof x.name === 'string' ? x.name : 'Unnamed zone', status: typeof x.status === 'string' ? x.status : 'unknown', paused: x.paused === true, plan: typeof x.plan?.name === 'string' ? x.plan.name : null, nameServers: Array.isArray(x.name_servers) ? x.name_servers.filter((v: unknown): v is string => typeof v === 'string').slice(0, 20) : [] }))
  }

  async dnsRecords(zoneId: string, pageInput?: number, search?: string): Promise<CloudflarePage<CloudflareDnsRecord>> {
    const zone = safeId(zoneId, 'Zone id'); const page = requirePage(pageInput)
    const query = typeof search === 'string' && search.trim() ? `&name=${encodeURIComponent(search.trim().slice(0, 255))}` : ''
    return pageOf(await this.request<any>(`/zones/${zone}/dns_records?page=${page}&per_page=${PAGE_SIZE}${query}`, 'GET'), (x) => ({ id: safeId(x.id, 'Record id'), type: typeof x.type === 'string' ? x.type : 'UNKNOWN', name: typeof x.name === 'string' ? x.name : '', content: typeof x.content === 'string' ? x.content : '', ttl: Number.isFinite(x.ttl) ? x.ttl : 1, proxied: typeof x.proxied === 'boolean' ? x.proxied : null, priority: Number.isFinite(x.priority) ? x.priority : null, comment: typeof x.comment === 'string' ? x.comment : null, tags: Array.isArray(x.tags) ? x.tags.filter((v: unknown): v is string => typeof v === 'string').slice(0, 100) : [], modifiedOn: typeof x.modified_on === 'string' ? x.modified_on : null }))
  }

  async sslTlsSettings(zoneId: string): Promise<CloudflareSslTlsSetting[]> {
    const zone = safeId(zoneId, 'Zone id')
    const result = await this.request<any[]>(`/zones/${zone}/settings`, 'GET')
    if (!Array.isArray(result)) throw validation('Cloudflare returned an unexpected SSL/TLS response.')
    return result.filter((x) => typeof x?.id === 'string' && typeof x?.value === 'string').map((x) => ({ id: x.id, value: x.value, editable: x.editable === true, modifiedOn: typeof x.modified_on === 'string' ? x.modified_on : null }))
  }

  async rulesets(zoneId: string, pageInput?: number): Promise<CloudflarePage<CloudflareRuleset>> {
    const zone = safeId(zoneId, 'Zone id'); const page = requirePage(pageInput)
    return pageOf(await this.request<any>(`/zones/${zone}/rulesets?page=${page}&per_page=${PAGE_SIZE}`, 'GET'), (x) => ({ id: safeId(x.id, 'Ruleset id'), name: typeof x.name === 'string' ? x.name : '', description: typeof x.description === 'string' ? x.description : null, kind: typeof x.kind === 'string' ? x.kind : 'unknown', phase: typeof x.phase === 'string' ? x.phase : 'unknown', state: typeof x.state === 'string' ? x.state : 'unknown', rules: Array.isArray(x.rules) ? x.rules.slice(0, 1000).map((r: any) => ({ id: typeof r.id === 'string' ? r.id : '', action: typeof r.action === 'string' ? r.action : 'unknown', expression: typeof r.expression === 'string' ? r.expression : '', enabled: r.enabled !== false, description: typeof r.description === 'string' ? r.description : null })) : [] }))
  }

  async redirectRules(zoneId: string, pageInput?: number): Promise<CloudflarePage<CloudflareRedirectRule>> {
    const zone = safeId(zoneId, 'Zone id'); const page = requirePage(pageInput)
    return pageOf(await this.request<any>(`/zones/${zone}/rulesets?phase=http_request_redirect&page=${page}&per_page=${PAGE_SIZE}`, 'GET'), (x) => ({ id: safeId(x.id, 'Redirect ruleset id'), expression: typeof x.expression === 'string' ? x.expression : '', target: typeof x.action_parameters?.from_value?.target_url?.value === 'string' ? x.action_parameters.from_value.target_url.value : '', statusCode: x.action_parameters?.from_value?.status_code === 302 ? 302 : 301, preserveQueryString: x.action_parameters?.from_value?.preserve_query_string !== false, enabled: x.enabled !== false }))
  }

  async analytics(zoneId: string, since: string, until: string): Promise<CloudflareAnalytics> {
    const zone = safeId(zoneId, 'Zone id'); const from = safeText(since, 'Start date', 32); const to = safeText(until, 'End date', 32)
    const result = await this.request<any>(`/zones/${zone}/analytics/dashboard?since=${encodeURIComponent(from)}&until=${encodeURIComponent(to)}&continuous=true`, 'GET')
    const values = Array.isArray(result?.series?.result) ? result.series.result : Array.isArray(result?.data) ? result.data : []
    return { zoneId: zone, since: from, until: to, truncated: values.length >= 10_000, points: values.slice(0, 10_000).map((x: any) => ({ timestamp: typeof x.timestamp === 'string' ? x.timestamp : typeof x.date === 'string' ? x.date : '', requests: Number.isFinite(x.requests) ? x.requests : 0, bandwidthBytes: Number.isFinite(x.bandwidthBytes) ? x.bandwidthBytes : Number.isFinite(x.bytes) ? x.bytes : 0, threats: Number.isFinite(x.threats) ? x.threats : 0, cachedRequests: Number.isFinite(x.cachedRequests) ? x.cachedRequests : Number.isFinite(x.cached) ? x.cached : 0 })) }
  }

  async createDnsRecord(zoneId: string, input: CloudflareDnsRecordInput): Promise<CloudflareDnsRecord> {
    const zone = safeId(zoneId, 'Zone id'); return this.mapRecord(await this.request<any>(`/zones/${zone}/dns_records`, 'POST', this.recordBody(input)))
  }
  async updateDnsRecord(zoneId: string, recordId: string, input: CloudflareDnsRecordInput): Promise<CloudflareDnsRecord> {
    const zone = safeId(zoneId, 'Zone id'); const id = safeId(recordId, 'Record id'); return this.mapRecord(await this.request<any>(`/zones/${zone}/dns_records/${id}`, 'PUT', this.recordBody(input)))
  }
  async deleteDnsRecord(zoneId: string, recordId: string): Promise<void> { await this.request<null>(`/zones/${safeId(zoneId, 'Zone id')}/dns_records/${safeId(recordId, 'Record id')}`, 'DELETE') }

  async updateSslTlsSetting(zoneId: string, input: CloudflareSslTlsUpdateInput): Promise<CloudflareSslTlsSetting> {
    const zone = safeId(zoneId, 'Zone id'); const allowed = new Set(['tls_1_0', 'tls_1_1', 'min_tls_version', 'opportunistic_encryption', 'automatic_https_rewrites', 'always_use_https'])
    if (!allowed.has(input.settingId)) throw validation('SSL/TLS setting is not supported.')
    return this.request<CloudflareSslTlsSetting>(`/zones/${zone}/settings/${input.settingId}`, 'PUT', { value: input.value })
  }

  async createRuleset(zoneId: string, input: CloudflareRulesetInput): Promise<CloudflareRuleset> { const zone = safeId(zoneId, 'Zone id'); return this.request<CloudflareRuleset>(`/zones/${zone}/rulesets`, 'POST', { name: safeText(input.name, 'Ruleset name', 255), description: input.description?.slice(0, 1000), phase: input.phase, rules: input.rules.slice(0, 1000) }) }
  async updateRuleset(zoneId: string, rulesetId: string, input: CloudflareRulesetInput): Promise<CloudflareRuleset> { const zone = safeId(zoneId, 'Zone id'); const id = safeId(rulesetId, 'Ruleset id'); return this.request<CloudflareRuleset>(`/zones/${zone}/rulesets/${id}`, 'PUT', { name: safeText(input.name, 'Ruleset name', 255), description: input.description?.slice(0, 1000), phase: input.phase, rules: input.rules.slice(0, 1000) }) }
  async deleteRuleset(zoneId: string, rulesetId: string): Promise<void> { await this.request<null>(`/zones/${safeId(zoneId, 'Zone id')}/rulesets/${safeId(rulesetId, 'Ruleset id')}`, 'DELETE') }

  async createRedirectRule(zoneId: string, input: CloudflareRedirectRuleInput): Promise<CloudflareRedirectRule> { const zone = safeId(zoneId, 'Zone id'); return this.request<CloudflareRedirectRule>(`/zones/${zone}/rulesets`, 'POST', this.redirectBody(input)) }
  async updateRedirectRule(zoneId: string, ruleId: string, input: CloudflareRedirectRuleInput): Promise<CloudflareRedirectRule> { const zone = safeId(zoneId, 'Zone id'); const id = safeId(ruleId, 'Redirect rule id'); return this.request<CloudflareRedirectRule>(`/zones/${zone}/rulesets/${id}`, 'PUT', this.redirectBody(input)) }
  async deleteRedirectRule(zoneId: string, ruleId: string): Promise<void> { await this.deleteRuleset(zoneId, ruleId) }
  async purgeCache(zoneId: string, scope: 'everything' | 'urls', urls: string[] = []): Promise<void> { const zone = safeId(zoneId, 'Zone id'); if (scope === 'urls' && (urls.length < 1 || urls.length > 100)) throw validation('Choose between 1 and 100 URLs to purge.'); await this.request<null>(`/zones/${zone}/purge_cache`, 'POST', scope === 'everything' ? { purge_everything: true } : { files: urls.map((url) => safeText(url, 'Cache URL', 2048)) }) }

  private recordBody(input: CloudflareDnsRecordInput): Record<string, unknown> { if (!['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA'].includes(input.type)) throw validation('DNS record type is not supported.'); return { type: input.type, name: safeText(input.name, 'DNS name', 255), content: safeText(input.content, 'DNS content', 4096), ttl: input.ttl ?? 1, ...(typeof input.proxied === 'boolean' ? { proxied: input.proxied } : {}), ...(typeof input.priority === 'number' ? { priority: input.priority } : {}), ...(input.comment ? { comment: input.comment.slice(0, 500) } : {}), ...(input.tags ? { tags: input.tags.slice(0, 100).map((x) => x.slice(0, 100)) } : {}) } }
  private redirectBody(input: CloudflareRedirectRuleInput): Record<string, unknown> { return { name: 'Redirect rules', phase: 'http_request_redirect', rules: [{ expression: safeText(input.expression, 'Redirect expression'), action: 'redirect', action_parameters: { from_value: { status_code: input.statusCode, target_url: { value: safeText(input.target, 'Redirect target') }, preserve_query_string: input.preserveQueryString !== false } }, enabled: input.enabled !== false }] } }
  private mapRecord(x: any): CloudflareDnsRecord { return { id: safeId(x.id, 'Record id'), type: x.type, name: x.name, content: x.content, ttl: x.ttl, proxied: typeof x.proxied === 'boolean' ? x.proxied : null, priority: Number.isFinite(x.priority) ? x.priority : null, comment: typeof x.comment === 'string' ? x.comment : null, tags: Array.isArray(x.tags) ? x.tags : [], modifiedOn: typeof x.modified_on === 'string' ? x.modified_on : null } }
}
