/**
 * Shared, credential-free contracts for OAuth flows whose CLI runs away from the browser.
 *
 * Terminal output is untrusted data. The detector therefore returns only a loopback port and
 * callback path observed inside a validated authorize URL. The callback URL is intentionally not
 * carried by the detector result or persisted by any caller.
 */

export const REMOTE_OAUTH_TTL_MS = 10 * 60_000
export const REMOTE_OAUTH_MAX_OUTPUT = 256 * 1024
export const REMOTE_OAUTH_MAX_URL = 16 * 1024

export interface RemoteOAuthDetection {
  authorizationUrl: string
  port: number
  callbackPath: string
}

export interface RemoteOAuthArmInput {
  port: number
  callbackPath: string
}

export type RemoteOAuthArmResult =
  | { ok: true; port: number; callbackPath: string; expiresAt: number }
  | { ok: false; error: string }

export type RemoteOAuthCompleteResult =
  | { status: 'completed'; httpStatus: number }
  | { status: 'rejected' | 'expired'; httpStatus: number | null; error: string }

export interface RemoteOAuthApi {
  /** Arm one callback port observed in terminal output for this authenticated browser client. */
  arm(input: RemoteOAuthArmInput): Promise<RemoteOAuthArmResult>
  /** Fetch the one armed loopback callback on the server, consuming the arm before the request. */
  complete(callbackUrl: string): Promise<RemoteOAuthCompleteResult>
  /** Cancel the current one-shot arm without contacting the callback listener. */
  cancel(): Promise<boolean>
}

const ANSI_ESCAPE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g
const AUTH_URL = /https?:\/\/[^\s"'<>]+/gi

function loopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535
}

function trimUrlTail(value: string): string {
  return value.replace(/[),.;!?]+$/g, '')
}

/**
 * Parse one authorize URL from untrusted terminal output.
 *
 * The redirect URI must be an HTTP loopback URL with a valid port. HTTPS, credentials, malformed
 * URLs, and authorize URLs without a matching callback are rejected. The returned path is bounded
 * and retained so a server callback completer can require the pasted URL to match what was seen.
 */
export function parseRemoteOAuthAuthorizeUrl(value: string): RemoteOAuthDetection | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > REMOTE_OAUTH_MAX_OUTPUT) return null
  const text = value.replace(ANSI_ESCAPE, '')
  for (const match of text.matchAll(AUTH_URL)) {
    const candidate = trimUrlTail(match[0] ?? '')
    if (candidate.length > REMOTE_OAUTH_MAX_URL) continue
    let authorization: URL
    try { authorization = new URL(candidate) } catch { continue }
    if (authorization.protocol !== 'https:' && authorization.protocol !== 'http:') continue
    if (authorization.username || authorization.password) continue
    const redirect = authorization.searchParams.get('redirect_uri')
    if (!redirect) continue
    let callback: URL
    try { callback = new URL(redirect) } catch { continue }
    if (callback.protocol !== 'http:' || !loopbackHost(callback.hostname)) continue
    if (!callback.port) continue
    const port = Number(callback.port)
    if (!validPort(port) || callback.username || callback.password || callback.hash) continue
    if (!callback.pathname || callback.pathname === '/') continue
    return { authorizationUrl: authorization.href, port, callbackPath: callback.pathname }
  }
  return null
}

/** Alias with a descriptive name for call sites that scan one output chunk. */
export const detectRemoteOAuthAuthorizeUrl = parseRemoteOAuthAuthorizeUrl

/** Validate a pasted callback against the exact loopback port and path observed earlier. */
export function parseRemoteOAuthCallbackUrl(
  value: string,
  expected: RemoteOAuthArmInput
): URL | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > REMOTE_OAUTH_MAX_URL) return null
  if (!validPort(expected.port) || typeof expected.callbackPath !== 'string' || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,512}$/.test(expected.callbackPath)) return null
  let callback: URL
  try { callback = new URL(value) } catch { return null }
  if (!callback.port) return null
  const port = Number(callback.port)
  if (callback.protocol !== 'http:' || !loopbackHost(callback.hostname) || port !== expected.port) return null
  if (callback.username || callback.password || callback.hash || callback.pathname !== expected.callbackPath) return null
  return callback
}

export function isRemoteOAuthPort(value: number): boolean {
  return validPort(value)
}
