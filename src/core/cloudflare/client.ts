import { CLOUDFLARE_API_BASE, type CloudflareOperation } from '../../shared/cloudflare'

export class CloudflareApiError extends Error {
  constructor(
    message: string,
    readonly operation: CloudflareOperation,
    readonly status: number | null,
    readonly retryAfterSeconds: number | null = null,
    readonly code = status === 429 ? 'rate-limited' : status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'request-failed'
  ) { super(message) }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, cancel: () => clearTimeout(timer) }
}

export class CloudflareClient {
  constructor(private readonly token: string, private readonly fetcher: FetchLike = fetch) {}

  async request<T>(operation: CloudflareOperation, path: string, init: RequestInit = {}): Promise<T> {
    const { signal, cancel } = timeoutSignal(10_000)
    try {
      const response = await this.fetcher(`${CLOUDFLARE_API_BASE}${path}`, {
        ...init,
        signal,
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(init.headers ?? {}) }
      })
      const raw = await response.text()
      if (raw.length > 2 * 1024 * 1024) {
        throw new CloudflareApiError('Cloudflare response exceeded the 2 MiB safety bound.', operation, response.status)
      }
      let body: any = null
      try { body = raw ? JSON.parse(raw) : null } catch { throw new CloudflareApiError('Cloudflare returned invalid JSON.', operation, response.status) }
      if (!response.ok || body?.success === false) {
        const message = Array.isArray(body?.errors) && body.errors.length
          ? body.errors.map((error: any) => String(error?.message ?? error?.code ?? 'unknown error')).join('; ')
          : `Cloudflare returned HTTP ${response.status}.`
        const retry = Number(response.headers.get('retry-after'))
        throw new CloudflareApiError(message.slice(0, 400), operation, response.status, Number.isFinite(retry) ? retry : null,
          response.status === 429 ? 'rate-limited' : response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : 'request-failed')
      }
      return body?.result as T
    } catch (error) {
      if (error instanceof CloudflareApiError) throw error
      throw new CloudflareApiError(error instanceof Error ? error.message : 'Cloudflare is unreachable.', operation, null, null, 'unreachable')
    } finally { cancel() }
  }
}
