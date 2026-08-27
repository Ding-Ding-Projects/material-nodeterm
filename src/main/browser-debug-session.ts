/** Host-owned lifecycle for isolated debugging browser sessions.
 *
 * The renderer supplies only validated intent. This manager resolves local bindings, creates a
 * dedicated browser partition, configures the selected proxy and certificate policy, and releases
 * the session when its owner goes away. It deliberately has no ordinary-browser fallback.
 */
import {
  appendDebugBrowserDiagnostic,
  debugBrowserPartition,
  redactDebugBrowserStatus,
  resolveDebugBrowserSession,
  type DebugBrowserIntent,
  type DebugBrowserLocalBinding,
  type DebugBrowserProfile,
  type DebugBrowserProxyIntent,
  type DebugBrowserStatus
} from '../shared/browser-debug-sessions'

export interface DebugBrowserHostSession {
  /** Apply proxy settings inside the dedicated session. The secret is resolved host-side. */
  setProxy(proxy: DebugBrowserProxyIntent, credentialRef?: string): Promise<void>
  /** Apply certificate policy inside the dedicated session. */
  setCertificateMode(mode: DebugBrowserIntent['certificateMode'], certificatePath?: string): Promise<void>
  /** Start the page at the validated target URL. */
  navigate(url: string): Promise<void>
  /** Close this session and its debugging endpoint. */
  close(): Promise<void>
}

export interface DebugBrowserHost {
  create(partition: string, isolation: DebugBrowserIntent['isolation']): Promise<DebugBrowserHostSession>
}

export interface DebugBrowserLocalBindingStore {
  get(profileId: string): Promise<DebugBrowserLocalBinding | null>
}

interface OwnedSession {
  ownerId: string
  intent: DebugBrowserIntent
  local: DebugBrowserLocalBinding
  host: DebugBrowserHostSession
  status: DebugBrowserStatus
}

const MAX_SESSIONS = 32

function emptyStatus(id: string): DebugBrowserStatus {
  return {
    id,
    phase: 'unbound',
    intent: null,
    localBinding: { credentialConfigured: false, certificateConfigured: false, browserConfigured: false },
    diagnostics: [],
    progress: 0
  }
}

function statusFor(id: string, intent: DebugBrowserIntent, local: DebugBrowserLocalBinding, phase: DebugBrowserStatus['phase'], diagnostics: DebugBrowserStatus['diagnostics'], progress: number, reason?: string, recoveryAction?: DebugBrowserStatus['recoveryAction']): DebugBrowserStatus {
  return redactDebugBrowserStatus({
    id,
    phase,
    intent,
    localBinding: {
      credentialConfigured: !!local.proxyCredentialRef,
      certificateConfigured: intent.certificateMode !== 'custom' || !!local.certificatePath,
      browserConfigured: !!local.browserExecutable
    },
    diagnostics,
    progress,
    ...(reason ? { reason } : {}),
    ...(recoveryAction ? { recoveryAction } : {})
  })
}

/** Owns live debugging sessions. Every public status is redacted before it leaves this class. */
export class BrowserDebugSessionManager {
  private readonly sessions = new Map<string, OwnedSession>()
  private readonly statuses = new Map<string, DebugBrowserStatus>()

  constructor(private readonly host: DebugBrowserHost, private readonly localBindings: DebugBrowserLocalBindingStore) {}

  status(id: string): DebugBrowserStatus {
    return this.statuses.get(id) ?? emptyStatus(id)
  }

  list(): DebugBrowserStatus[] {
    return [...this.statuses.values()].map((status) => redactDebugBrowserStatus(status))
  }

  async start(id: string, ownerId: string, intent: DebugBrowserIntent, projectId = ownerId): Promise<DebugBrowserStatus> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) || !ownerId) {
      const status = { ...emptyStatus(id), phase: 'error' as const, reason: 'The debugging session identity is invalid.', recoveryAction: 'configure' as const }
      this.statuses.set(id, status)
      return status
    }
    if (this.sessions.size >= MAX_SESSIONS && !this.sessions.has(id)) {
      const status = { ...emptyStatus(id), phase: 'recovery' as const, reason: 'The debugging-session limit is reached. Stop an existing session before starting another.', recoveryAction: 'stop' as const }
      this.statuses.set(id, status)
      return status
    }
    const previous = await this.stop(id)
    if (previous.phase === 'recovery') return previous
    const local = await this.localBindings.get(intent.profileId)
    const resolved = resolveDebugBrowserSession(projectId, intent, local)
    if (!resolved.ok) {
      const status = statusFor(id, intent, local ?? {}, resolved.phase, [], 0, resolved.reason, resolved.nextAction)
      this.statuses.set(id, status)
      return status
    }
    const diagnostics = appendDebugBrowserDiagnostic([], { at: Date.now(), level: 'info', code: 'session-starting', message: 'Starting the isolated debugging browser session.' })
    this.statuses.set(id, statusFor(id, intent, local!, 'starting', diagnostics, 0.1))
    let browser: DebugBrowserHostSession | undefined
    try {
      browser = await this.host.create(resolved.partition, intent.isolation)
      await browser.setProxy(resolved.proxy, local?.proxyCredentialRef)
      await browser.setCertificateMode(resolved.certificateMode, local?.certificatePath)
      await browser.navigate(intent.targetUrl)
    } catch (error) {
      try { await browser?.close() } catch { /* preserve the original lifecycle failure */ }
      const message = 'The isolated debugging browser could not start. Rebind its local browser, proxy, or certificate and retry.'
      const failed = statusFor(id, intent, local!, 'recovery', appendDebugBrowserDiagnostic(diagnostics, { at: Date.now(), level: 'error', code: 'session-start-failed', message }), 0, message, 'retry')
      this.statuses.set(id, failed)
      return failed
    }
    const running = statusFor(id, intent, local!, 'running', appendDebugBrowserDiagnostic(diagnostics, { at: Date.now(), level: 'info', code: 'session-running', message: 'The isolated debugging browser is running.' }), 1, undefined, 'stop')
    this.sessions.set(id, { ownerId, intent, local: local!, host: browser, status: running })
    this.statuses.set(id, running)
    return running
  }

  async stop(id: string): Promise<DebugBrowserStatus> {
    const session = this.sessions.get(id)
    if (!session) return this.status(id)
    this.sessions.delete(id)
    const stopping = statusFor(id, session.intent, session.local, 'stopping', appendDebugBrowserDiagnostic(session.status.diagnostics, { at: Date.now(), level: 'info', code: 'session-stopping', message: 'Stopping the isolated debugging browser session.' }), 0.5)
    this.statuses.set(id, stopping)
    try {
      await session.host.close()
      const stopped = statusFor(id, session.intent, session.local, 'stopped', appendDebugBrowserDiagnostic(stopping.diagnostics, { at: Date.now(), level: 'info', code: 'session-stopped', message: 'The isolated debugging browser session stopped.' }), 0)
      this.statuses.set(id, stopped)
      return stopped
    } catch {
      const failed = statusFor(id, session.intent, session.local, 'recovery', appendDebugBrowserDiagnostic(stopping.diagnostics, { at: Date.now(), level: 'error', code: 'session-stop-failed', message: 'The session did not confirm shutdown. Retry stop before starting another session.' }), 0, 'The session did not confirm shutdown.', 'retry')
      this.statuses.set(id, failed)
      return failed
    }
  }

  async releaseOwner(ownerId: string): Promise<void> {
    const owned = [...this.sessions.entries()].filter(([, session]) => session.ownerId === ownerId)
    for (const [id] of owned) await this.stop(id)
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.stop(id)
  }
}

export function profileToDebugIntent(profile: DebugBrowserProfile, targetUrl: string): DebugBrowserIntent {
  return {
    profileId: profile.id,
    targetUrl,
    isolation: profile.isolation,
    proxy: { ...profile.proxy, ...(profile.proxy.bypass ? { bypass: [...profile.proxy.bypass] } : {}) },
    certificateMode: profile.certificateMode,
    debuggingEnabled: true
  }
}
