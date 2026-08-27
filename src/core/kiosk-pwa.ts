import {
  canTransitionKioskPwa,
  permissionAllowed,
  portableKioskPwaIntent,
  type KioskPwaLifecycle,
  type KioskPwaLocalProfile,
  type KioskPwaPermission,
  type KioskPwaSession,
  type PortableKioskPwaIntent
} from '@shared/kiosk-pwa'

export interface KioskPwaSessionHost {
  /** Host integration creates a window or equivalent surface and returns its opaque handle. */
  start(session: KioskPwaSession): Promise<{ ok: true } | { ok: false; reason: string }>
  stop(session: KioskPwaSession): Promise<{ ok: true } | { ok: false; reason: string }>
}

export interface KioskPwaSessionManagerOptions {
  host: KioskPwaSessionHost
  now?: () => number
  createId?: () => string
}

export type KioskPwaStartResult =
  | { ok: true; session: KioskPwaSession }
  | { ok: false; reason: 'invalid-intent' | 'already-running' | 'unavailable'; message: string }

/**
 * Owns kiosk/PWA lifecycle state without ever owning browser credentials or machine paths.
 * The host adapter is the only place that can create or destroy a native window. Every request
 * carries the owning node id, so an unowned stop or permission request is refused.
 */
export class KioskPwaSessionManager {
  private readonly sessions = new Map<string, KioskPwaSession>()
  private readonly host: KioskPwaSessionHost
  private readonly now: () => number
  private readonly createId: () => string

  constructor(options: KioskPwaSessionManagerOptions) {
    this.host = options.host
    this.now = options.now ?? (() => Date.now())
    this.createId = options.createId ?? (() => `kiosk-pwa-${this.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
  }

  get(sessionId: string, ownerNodeId: string): KioskPwaSession | undefined {
    const session = this.sessions.get(sessionId)
    return session?.ownerNodeId === ownerNodeId ? session : undefined
  }

  list(ownerNodeId?: string): KioskPwaSession[] {
    return [...this.sessions.values()].filter((session) => ownerNodeId === undefined || session.ownerNodeId === ownerNodeId)
  }

  start(ownerNodeId: string, intentInput: unknown, profile?: KioskPwaLocalProfile): Promise<KioskPwaStartResult> {
    const intent = portableKioskPwaIntent(intentInput)
    if (!intent) return Promise.resolve({ ok: false, reason: 'invalid-intent', message: 'The kiosk or PWA setup is incomplete.' })
    const existing = this.list(ownerNodeId).find((session) => session.intent.displayName === intent.displayName)
    if (existing && (existing.lifecycle === 'starting' || existing.lifecycle === 'running')) {
      return Promise.resolve({ ok: false, reason: 'already-running', message: 'This kiosk or PWA session is already running.' })
    }
    const localProfile = profile ?? {
      profileId: `${ownerNodeId}-${this.createId()}`,
      displayName: `${intent.displayName} profile`,
      createdAt: this.now(),
      grantedPermissions: []
    }
    const session: KioskPwaSession = {
      sessionId: this.createId(),
      ownerNodeId,
      intent,
      profile: localProfile,
      lifecycle: 'starting'
    }
    this.sessions.set(session.sessionId, session)
    return this.host.start(session).then((result) => {
      if (!result.ok) {
        const unavailable: KioskPwaSession = { ...session, lifecycle: 'unavailable', unavailableReason: result.reason }
        this.sessions.set(session.sessionId, unavailable)
        return { ok: false, reason: 'unavailable', message: result.reason }
      }
      const running: KioskPwaSession = { ...session, lifecycle: 'running', profile: { ...localProfile, lastUsedAt: this.now() } }
      this.sessions.set(session.sessionId, running)
      return { ok: true, session: running }
    })
  }

  async stop(sessionId: string, ownerNodeId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const session = this.get(sessionId, ownerNodeId)
    if (!session) return { ok: false, message: 'This kiosk or PWA session is not owned by the selected node.' }
    if (session.lifecycle !== 'running' && session.lifecycle !== 'starting') {
      return { ok: false, message: 'This kiosk or PWA session is not running.' }
    }
    if (!canTransitionKioskPwa(session.lifecycle, 'stopping')) {
      return { ok: false, message: 'This kiosk or PWA session cannot stop from its current state.' }
    }
    this.sessions.set(sessionId, { ...session, lifecycle: 'stopping' })
    const result = await this.host.stop({ ...session, lifecycle: 'stopping' })
    if (!result.ok) {
      this.sessions.set(sessionId, { ...session, lifecycle: 'error', error: result.reason })
      return { ok: false, message: result.reason }
    }
    this.sessions.set(sessionId, { ...session, lifecycle: 'stopped' })
    return { ok: true }
  }

  /** Exit is intentionally an alias for the explicit stop route, never a process kill by id. */
  exit(sessionId: string, ownerNodeId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    return this.stop(sessionId, ownerNodeId)
  }

  /** Re-entering after an unavailable host keeps the same portable intent and local profile. */
  recover(sessionId: string, ownerNodeId: string): Promise<KioskPwaStartResult> {
    const session = this.get(sessionId, ownerNodeId)
    if (!session) return Promise.resolve({ ok: false, reason: 'invalid-intent', message: 'The kiosk or PWA session could not be found.' })
    if (session.lifecycle === 'running' || session.lifecycle === 'starting') {
      return Promise.resolve({ ok: false, reason: 'already-running', message: 'This kiosk or PWA session is already running.' })
    }
    this.sessions.delete(sessionId)
    return this.start(ownerNodeId, session.intent, session.profile)
  }

  permission(sessionId: string, ownerNodeId: string, permission: KioskPwaPermission): 'granted' | 'denied' | 'unavailable' {
    const session = this.get(sessionId, ownerNodeId)
    if (!session || session.lifecycle !== 'running') return 'unavailable'
    if (!permissionAllowed(session.intent, permission)) return 'denied'
    return session.profile.grantedPermissions.includes(permission) ? 'granted' : 'denied'
  }

  /** No runtime state, profile data, or handles are returned by this projection. */
  portable(sessionId: string, ownerNodeId: string): PortableKioskPwaIntent | undefined {
    const session = this.get(sessionId, ownerNodeId)
    return session ? portableKioskPwaIntent(session.intent) : undefined
  }

  setLifecycleForUnavailable(sessionId: string, ownerNodeId: string, reason: string): boolean {
    const session = this.get(sessionId, ownerNodeId)
    if (!session || !reason || !canTransitionKioskPwa(session.lifecycle, 'unavailable')) return false
    this.sessions.set(sessionId, { ...session, lifecycle: 'unavailable', unavailableReason: reason })
    return true
  }

  lifecycle(sessionId: string, ownerNodeId: string): KioskPwaLifecycle | 'unknown' {
    return this.get(sessionId, ownerNodeId)?.lifecycle ?? 'unknown'
  }
}
