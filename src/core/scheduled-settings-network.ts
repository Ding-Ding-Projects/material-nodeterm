// Bounded HTTPS fetchers for the two external scheduled-settings sources (`'api'` and
// `'home-assistant'`). Main-process-only network access — see docs/scheduled-settings.md's
// "Security boundaries" section for why this must never run in the renderer.
//
// Every fetch here: rejects redirects, rejects credentials embedded in the URL, rejects any
// scheme but https (or http on loopback), bounds the response body size, bounds the request with
// a timeout, and NEVER logs the response body or an auth token. A failure is always reported as a
// short, static-shaped reason string — never the raw body — so a broken/hostile server cannot get
// its own text echoed into a notification or an issue-tracker screenshot.
import {
  parseScheduledSettingsApiResponse,
  validateFetchUrl,
  isValidHomeAssistantEntityId,
  SCHEDULED_SETTINGS_API_MAX_BYTES,
  SCHEDULED_SETTINGS_API_TIMEOUT_MS,
  type SchedulableSettingsPatch
} from '../shared/scheduled-settings'

/** Read a fetch `Response` body up to `maxBytes`, aborting (via `ctrl`) the moment it is
 *  exceeded rather than buffering an unbounded stream first and rejecting only afterward — the
 *  whole point of a byte bound is to stop reading, not merely to stop trusting. */
async function readBounded(res: Response, maxBytes: number, ctrl: AbortController): Promise<string> {
  const body = res.body
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        ctrl.abort()
        throw new Error('response exceeded the size bound')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8')
}

function isRedirect(res: Response): boolean {
  return res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)
}

function timeoutOrNetworkError(e: unknown): string {
  return e instanceof Error && e.name === 'AbortError' ? 'Request timed out.' : 'Network error.'
}

export interface ApiFetchResult {
  ok: boolean
  values?: SchedulableSettingsPatch
  error?: string
}

/** Fetch a `kind:'api'` source. Never follows a redirect (`redirect: 'manual'`); a 3xx or an
 *  opaque redirect is reported as a failure rather than chased. */
export async function fetchApiSettingsSource(
  url: string,
  timeoutMs: number = SCHEDULED_SETTINGS_API_TIMEOUT_MS
): Promise<ApiFetchResult> {
  const safety = validateFetchUrl(url)
  if (!safety.ok) return { ok: false, error: safety.error }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(safety.url, {
      signal: ctrl.signal,
      redirect: 'manual',
      headers: { accept: 'application/json' }
    })
    if (isRedirect(res)) return { ok: false, error: 'The server tried to redirect — redirects are not followed.' }
    if (!res.ok) return { ok: false, error: `Server returned HTTP ${res.status}.` }
    const text = await readBounded(res, SCHEDULED_SETTINGS_API_MAX_BYTES, ctrl)
    const values = parseScheduledSettingsApiResponse(text)
    if (!values) return { ok: false, error: 'The response was not a valid scheduled-settings payload.' }
    return { ok: true, values }
  } catch (e) {
    return { ok: false, error: timeoutOrNetworkError(e) }
  } finally {
    clearTimeout(timer)
  }
}

export interface HaFetchResult {
  ok: boolean
  on?: boolean
  error?: string
}

/** Fetch a Home Assistant boolean entity's current state via its REST API
 *  (`GET <base>/api/states/<entity_id>`, `Authorization: Bearer <token>`). The token is passed in
 *  by the caller (read from the sealed secret store) and is NEVER logged, echoed into an error, or
 *  placed anywhere but this one request's Authorization header. */
export async function fetchHomeAssistantState(
  baseUrl: string,
  entityId: string,
  token: string,
  timeoutMs: number = SCHEDULED_SETTINGS_API_TIMEOUT_MS
): Promise<HaFetchResult> {
  if (!isValidHomeAssistantEntityId(entityId)) {
    return { ok: false, error: 'Entity id must be a binary_sensor.* or input_boolean.* entity.' }
  }
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    return { ok: false, error: 'Not a valid base URL.' }
  }
  let statesUrl: string
  try {
    statesUrl = new URL(`api/states/${entityId}`, base.href.endsWith('/') ? base.href : `${base.href}/`).toString()
  } catch {
    return { ok: false, error: 'Could not build the states URL from the base URL.' }
  }
  const safety = validateFetchUrl(statesUrl)
  if (!safety.ok) return { ok: false, error: safety.error }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(safety.url, {
      signal: ctrl.signal,
      redirect: 'manual',
      headers: { accept: 'application/json', authorization: `Bearer ${token}` }
    })
    if (isRedirect(res)) return { ok: false, error: 'The server tried to redirect — redirects are not followed.' }
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Home Assistant rejected the access token.' }
    if (res.status === 404) return { ok: false, error: 'That entity id was not found.' }
    if (!res.ok) return { ok: false, error: `Home Assistant returned HTTP ${res.status}.` }
    const text = await readBounded(res, SCHEDULED_SETTINGS_API_MAX_BYTES, ctrl)
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return { ok: false, error: 'Home Assistant returned an invalid response.' }
    }
    const state = (body as Record<string, unknown> | null)?.state
    if (state !== 'on' && state !== 'off') {
      return { ok: false, error: 'The entity did not report an on/off state.' }
    }
    return { ok: true, on: state === 'on' }
  } catch (e) {
    return { ok: false, error: timeoutOrNetworkError(e) }
  } finally {
    clearTimeout(timer)
  }
}
