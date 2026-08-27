import { IPC } from '../shared/ipc'
import {
  parseRemoteOAuthCallbackUrl,
  REMOTE_OAUTH_TTL_MS,
  type RemoteOAuthArmInput,
  type RemoteOAuthArmResult,
  type RemoteOAuthCompleteResult
} from '../shared/remote-oauth'
import type { CorePlatform } from './platform'

const CALLBACK_TIMEOUT_MS = 10_000

interface ArmedCallback {
  input: RemoteOAuthArmInput
  expiresAt: number
}

/**
 * Server Edition callback completer.
 *
 * A browser client may paste the failed localhost callback after a remote CLI's authorize flow.
 * The client must first arm the exact port and path observed in terminal output. The arm is scoped
 * to the authenticated UI id, consumed before the fetch, and never written to disk.
 */
export class RemoteOAuthCallbackService {
  private readonly armed = new Map<number, ArmedCallback>()

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  arm(uiId: number, input: RemoteOAuthArmInput): RemoteOAuthArmResult {
    if (!Number.isInteger(uiId) || uiId < 1) return { ok: false, error: 'The browser session is invalid.' }
    if (!Number.isInteger(input?.port) || input.port < 1 || input.port > 65_535) {
      return { ok: false, error: 'The observed OAuth callback port is invalid.' }
    }
    if (typeof input.callbackPath !== 'string' || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,512}$/.test(input.callbackPath)) {
      return { ok: false, error: 'The observed OAuth callback path is invalid.' }
    }
    const expiresAt = Date.now() + REMOTE_OAUTH_TTL_MS
    this.armed.set(uiId, { input: { port: input.port, callbackPath: input.callbackPath }, expiresAt })
    return { ok: true, port: input.port, callbackPath: input.callbackPath, expiresAt }
  }

  cancel(uiId: number): boolean {
    return this.armed.delete(uiId)
  }

  async complete(uiId: number, callbackUrl: string): Promise<RemoteOAuthCompleteResult> {
    const armed = this.armed.get(uiId)
    this.armed.delete(uiId)
    if (!armed) return { status: 'rejected', httpStatus: null, error: 'No OAuth callback is waiting for this browser session.' }
    if (armed.expiresAt <= Date.now()) return { status: 'expired', httpStatus: null, error: 'The OAuth callback expired. Start the sign-in flow again.' }
    const callback = parseRemoteOAuthCallbackUrl(callbackUrl, armed.input)
    if (!callback) return { status: 'rejected', httpStatus: null, error: 'The callback must target the observed localhost port and path.' }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS)
    try {
      const response = await this.fetchImpl(callback.href, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal
      })
      // The callback listener owns the response body. Do not return or log it because it may carry
      // provider details or an authorization code. Cancelling avoids retaining a large response.
      const bodyCancel = response.body?.cancel()
      await bodyCancel?.catch(() => {})
      if (response.status < 200 || response.status >= 300) {
        return { status: 'rejected', httpStatus: response.status, error: 'The local OAuth callback listener rejected the callback.' }
      }
      return { status: 'completed', httpStatus: response.status }
    } catch {
      return { status: 'rejected', httpStatus: null, error: 'The local OAuth callback listener could not be reached.' }
    } finally {
      clearTimeout(timer)
    }
  }
}

export function registerRemoteOAuthCallbackIpc(
  platform: CorePlatform,
  service = new RemoteOAuthCallbackService()
): RemoteOAuthCallbackService {
  platform.handleWithSender(IPC.remoteOAuthArm, (uiId, input: RemoteOAuthArmInput) => service.arm(uiId, input))
  platform.handleWithSender(IPC.remoteOAuthComplete, (uiId, callbackUrl: string) => service.complete(uiId, callbackUrl))
  platform.handleWithSender(IPC.remoteOAuthCancel, (uiId) => service.cancel(uiId))
  return service
}
