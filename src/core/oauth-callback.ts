import { randomUUID } from 'crypto'
import { parseOAuthAuthorizeUrl } from '../shared/oauth-callback'

/**
 * Remote OAuth callback handling is deliberately a memory-only capability. The authorize URL is
 * hostile terminal output, and the callback contains a provider credential, so neither is ever
 * written to a project, settings file, history entry, or log.
 */
export const OAUTH_CALLBACK_TTL_MS = 5 * 60_000
const MAX_CALLBACK_URL_LENGTH = 16_384

export type OAuthCallbackMode = 'ssh-forward' | 'server-completer'

export interface OAuthCallbackArmInput {
  authorizeUrl: string
  sessionId: string
  projectId?: string
  mode: OAuthCallbackMode
}

export type OAuthCallbackArmResult =
  | {
      ok: true
      ticket: string
      provider: string
      redirectPort: number
      redirectPath: string
      expiresAt: number
      mode: OAuthCallbackMode
    }
  | { ok: false; code: 'invalid-url' | 'unavailable' | 'forward-failed'; message: string }

export type OAuthCallbackCompleteResult =
  | { ok: true; callbackUrl: string; provider: string; sessionId: string }
  | {
      ok: false
      code: 'unknown-ticket' | 'expired' | 'replayed' | 'invalid-callback'
      message: string
      retryable?: boolean
    }

interface PendingCallback {
  ticket: string
  sessionId: string
  projectId?: string
  mode: OAuthCallbackMode
  provider: string
  redirectPort: number
  redirectPath: string
  state: string
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
  consumed: boolean
}

function loopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65_535
}

function normalizePath(pathname: string): string {
  return pathname || '/'
}

function parseCallbackUrl(raw: string): URL | null {
  if (!raw || raw.length > MAX_CALLBACK_URL_LENGTH) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' || !loopbackHost(url.hostname)) return null
  if (url.username || url.password || url.hash || !validPort(Number(url.port))) return null
  return url
}

/**
 * Binds one observed provider state to one session and one loopback port. `complete` consumes the
 * ticket before returning the callback URL, so a replay cannot cause a second fetch or forward.
 */
export class OAuthCallbackRegistry {
  private pending = new Map<string, PendingCallback>()
  private expired = new Set<string>()
  private consumed = new Set<string>()

  arm(input: OAuthCallbackArmInput): OAuthCallbackArmResult {
    const parsed = parseOAuthAuthorizeUrl(input.authorizeUrl)
    if (!parsed || !input.sessionId || input.sessionId.length > 256) {
      return { ok: false, code: 'invalid-url', message: 'The terminal output did not contain a valid loopback OAuth callback.' }
    }
    const ticket = randomUUID()
    const expiresAt = Date.now() + OAUTH_CALLBACK_TTL_MS
    const timer = setTimeout(() => this.expire(ticket), OAUTH_CALLBACK_TTL_MS)
    timer.unref?.()
    this.pending.set(ticket, {
      ticket,
      sessionId: input.sessionId,
      projectId: input.projectId,
      mode: input.mode,
      provider: parsed.provider,
      redirectPort: parsed.redirectPort,
      redirectPath: parsed.redirectPath,
      state: parsed.state,
      expiresAt,
      timer,
      consumed: false
    })
    return {
      ok: true,
      ticket,
      provider: parsed.provider,
      redirectPort: parsed.redirectPort,
      redirectPath: parsed.redirectPath,
      expiresAt,
      mode: input.mode
    }
  }

  private expire(ticket: string): void {
    const entry = this.pending.get(ticket)
    if (!entry) return
    entry.consumed = true
    this.pending.delete(ticket)
    this.expired.add(ticket)
    if (this.expired.size > 512) this.expired.delete(this.expired.values().next().value as string)
  }

  cancel(ticket: string): boolean {
    const entry = this.pending.get(ticket)
    if (!entry) return false
    clearTimeout(entry.timer)
    this.pending.delete(ticket)
    return true
  }

  cancelForSession(sessionId: string): void {
    for (const [ticket, entry] of this.pending) {
      if (entry.sessionId === sessionId) this.cancel(ticket)
    }
  }

  cancelForProject(projectId: string): void {
    for (const [ticket, entry] of this.pending) {
      if (entry.projectId === projectId) this.cancel(ticket)
    }
  }

  complete(ticket: string, callbackRaw: string): OAuthCallbackCompleteResult {
    const entry = this.pending.get(ticket)
    if (!entry) {
      if (this.expired.has(ticket)) return { ok: false, code: 'expired', message: 'This OAuth callback expired. Start the sign-in flow again.' }
      if (this.consumed.has(ticket)) return { ok: false, code: 'replayed', message: 'This OAuth callback was already used.' }
      return { ok: false, code: 'unknown-ticket', message: 'This OAuth callback is no longer available.' }
    }
    if (entry.consumed) return { ok: false, code: 'replayed', message: 'This OAuth callback was already used.' }
    const callback = parseCallbackUrl(callbackRaw)
    if (!callback || Number(callback.port) !== entry.redirectPort || normalizePath(callback.pathname) !== entry.redirectPath) {
      return { ok: false, code: 'invalid-callback', retryable: true, message: 'Use the loopback callback URL reported by this session.' }
    }
    const state = callback.searchParams.get('state')
    if (!state || state !== entry.state) {
      return { ok: false, code: 'invalid-callback', retryable: true, message: 'This callback belongs to a different provider sign-in.' }
    }
    clearTimeout(entry.timer)
    entry.consumed = true
    this.pending.delete(ticket)
    this.consumed.add(ticket)
    if (this.consumed.size > 512) this.consumed.delete(this.consumed.values().next().value as string)
    return { ok: true, callbackUrl: callback.toString(), provider: entry.provider, sessionId: entry.sessionId }
  }

  dispose(): void {
    for (const entry of this.pending.values()) clearTimeout(entry.timer)
    this.pending.clear()
    this.expired.clear()
    this.consumed.clear()
  }
}
