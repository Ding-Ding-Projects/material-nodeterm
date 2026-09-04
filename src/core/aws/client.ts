import { createHash, createHmac, randomUUID } from 'node:crypto'
import type { AwsRequestContext } from '../../shared/aws'

export interface AwsCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

export interface AwsClientOptions {
  region: string
  profile?: string | null
  accountId?: string | null
  roleArn?: string | null
  credentials?: AwsCredentials | null
  fetchImpl?: typeof fetch
}

export class AwsHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null = null
  ) {
    super(message)
  }
}

export class AwsCredentialsError extends Error {}

function hmac(key: Uint8Array | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  const dateKey = hmac(`AWS4${secret}`, date)
  const regionKey = hmac(dateKey, region)
  const serviceKey = hmac(regionKey, service)
  return hmac(serviceKey, 'aws4_request')
}

function amzDate(date = new Date()): { amz: string; short: string } {
  const iso = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return { amz: iso, short: iso.slice(0, 8) }
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/')
}

function canonicalQuery(url: URL): string {
  return [...url.searchParams.entries()]
    .sort(([a, av], [b, bv]) => a === b ? av.localeCompare(bv) : a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
}

function canonicalHeaders(headers: Record<string, string>): { text: string; signed: string } {
  const entries = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase().trim(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => a.localeCompare(b))
  return {
    text: entries.map(([key, value]) => `${key}:${value}\n`).join(''),
    signed: entries.map(([key]) => key).join(';')
  }
}

function parseQueryResponse(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of text.matchAll(/<([A-Za-z][A-Za-z0-9_]*)>([^<]*)<\/\1>/g)) out[match[1]] = match[2]
  return out
}

function redactParameters(value: unknown, key = ''): unknown {
  if (/(secret|token|password|credential|access.?key|authorization)/i.test(key)) return '[redacted]'
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactParameters(item))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) out[childKey] = redactParameters(childValue, childKey)
    return out
  }
  if (typeof value === 'string') return value.slice(0, 4096)
  return value
}

const AWS_RESPONSE_LIMIT = 4 * 1024 * 1024
const AWS_REQUEST_TIMEOUT = 15_000

async function readBounded(response: Response): Promise<string> {
  if (!response.body) return (await response.text()).slice(0, AWS_RESPONSE_LIMIT)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const part = await reader.read()
    if (part.done) break
    size += part.value.byteLength
    if (size > AWS_RESPONSE_LIMIT) {
      await reader.cancel()
      throw new AwsHttpError('AWS response exceeded the bounded 4 MiB response limit.', response.status)
    }
    chunks.push(part.value)
  }
  const total = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { total.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(total)
}

function requestSignal(): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AWS_REQUEST_TIMEOUT)
  return { signal: controller.signal, cancel: () => clearTimeout(timer) }
}

/**
 * Small SigV4 client using the documented AWS JSON protocol. It deliberately has no process
 * execution path and never exposes Authorization, secret keys, or session tokens to callers.
 */
export class AwsJsonClient {
  readonly region: string
  readonly profile: string | null
  readonly accountId: string | null
  readonly roleArn: string | null
  private readonly credentials: AwsCredentials | null
  private readonly fetchImpl: typeof fetch

  constructor(options: AwsClientOptions) {
    this.region = options.region
    this.profile = options.profile ?? null
    this.accountId = options.accountId ?? null
    this.roleArn = options.roleArn ?? null
    this.credentials = options.credentials ?? null
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  private requireCredentials(): AwsCredentials {
    if (!this.credentials?.accessKeyId || !this.credentials.secretAccessKey) {
      throw new AwsCredentialsError('AWS credentials are not configured for this profile.')
    }
    return this.credentials
  }

  hasCredentials(): boolean {
    return Boolean(this.credentials?.accessKeyId && this.credentials.secretAccessKey)
  }

  context(manager: AwsRequestContext['manager'], service: string, operation: string, endpoint: string, parameters: Record<string, unknown>, pageSize: number, pageToken: string | null): AwsRequestContext {
    return {
      requestId: randomUUID(),
      manager,
      service,
      operation,
      region: this.region,
      profile: this.profile,
      accountId: this.accountId,
      roleArn: this.roleArn,
      endpoint,
      pageSize,
      pageToken,
      generatedAt: Date.now(),
      parameters: redactParameters(parameters) as Record<string, unknown>
    }
  }

  async query<T>(options: {
    service: string
    endpoint: string
    body: string
    operation: string
  }): Promise<T> {
    const credentials = this.requireCredentials()
    const url = new URL(options.endpoint)
    const date = amzDate()
    const headers: Record<string, string> = {
      host: url.host,
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      'x-amz-date': date.amz
    }
    if (credentials.sessionToken) headers['x-amz-security-token'] = credentials.sessionToken
    const canonical = canonicalHeaders(headers)
    const canonicalRequest = ['POST', encodePath(url.pathname || '/'), canonicalQuery(url), canonical.text, canonical.signed, hash(options.body)].join('\n')
    const scope = `${date.short}/${this.region}/${options.service}/aws4_request`
    const stringToSign = `AWS4-HMAC-SHA256\n${date.amz}\n${scope}\n${hash(canonicalRequest)}`
    const signature = createHmac('sha256', signingKey(credentials.secretAccessKey, date.short, this.region, options.service)).update(stringToSign).digest('hex')
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${canonical.signed}, Signature=${signature}`
    let response: Response
    const request = requestSignal()
    try {
      response = await this.fetchImpl(url, { method: 'POST', headers, body: options.body, signal: request.signal })
    } catch (error) {
      throw new AwsHttpError(`AWS ${options.operation} could not reach ${options.endpoint}: ${error instanceof Error ? error.message : String(error)}`, 0)
    } finally {
      request.cancel()
    }
    const text = await readBounded(response)
    if (!response.ok) throw new AwsHttpError(`AWS ${options.operation} returned HTTP ${response.status}: ${text.slice(0, 400)}`, response.status)
    return parseQueryResponse(text) as T
  }

  async json<T>(options: {
    service: string
    target: string
    endpoint: string
    body: Record<string, unknown>
    operation: string
  }): Promise<T> {
    const credentials = this.requireCredentials()
    const body = JSON.stringify(options.body)
    const url = new URL(options.endpoint)
    const date = amzDate()
    const headers: Record<string, string> = {
      host: url.host,
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-date': date.amz,
      'x-amz-target': options.target
    }
    if (credentials.sessionToken) headers['x-amz-security-token'] = credentials.sessionToken
    const canonical = canonicalHeaders(headers)
    const canonicalRequest = [
      'POST',
      encodePath(url.pathname || '/'),
      canonicalQuery(url),
      canonical.text,
      canonical.signed,
      hash(body)
    ].join('\n')
    const scope = `${date.short}/${this.region}/${options.service}/aws4_request`
    const stringToSign = `AWS4-HMAC-SHA256\n${date.amz}\n${scope}\n${hash(canonicalRequest)}`
    const signature = createHmac('sha256', signingKey(credentials.secretAccessKey, date.short, this.region, options.service))
      .update(stringToSign)
      .digest('hex')
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${canonical.signed}, Signature=${signature}`

    let response: Response
    const request = requestSignal()
    try {
      response = await this.fetchImpl(url, { method: 'POST', headers, body, signal: request.signal })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new AwsHttpError(`AWS ${options.operation} could not reach ${options.endpoint}: ${detail}`, 0)
    } finally {
      request.cancel()
    }
    const text = await readBounded(response)
    let payload: Record<string, unknown> = {}
    if (text) {
      try { payload = JSON.parse(text) as Record<string, unknown> } catch { payload = { message: text.slice(0, 400) } }
    }
    if (!response.ok) {
      const code = typeof payload.__type === 'string'
        ? payload.__type.split('#').pop() ?? payload.__type
        : typeof payload.code === 'string' ? payload.code : null
      const message = typeof payload.message === 'string' ? payload.message : `HTTP ${response.status}`
      throw new AwsHttpError(`AWS ${options.operation} returned HTTP ${response.status}: ${message}`, response.status, code)
    }
    return payload as T
  }
}

export function credentialsFromEnvironment(env: NodeJS.ProcessEnv = process.env): AwsCredentials | null {
  const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim()
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim()
  if (!accessKeyId || !secretAccessKey) return null
  return { accessKeyId, secretAccessKey, sessionToken: env.AWS_SESSION_TOKEN?.trim() || undefined }
}

export function isPermissionError(error: unknown): boolean {
  if (!(error instanceof AwsHttpError)) return false
  return error.status === 401 || error.status === 403 || /AccessDenied|Unauthorized|not authorized|permission/i.test(error.message)
}

export function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
