import {
  OAuthCallbackRegistry,
  type OAuthCallbackArmInput,
  type OAuthCallbackArmResult,
  type OAuthCallbackCompleteResult
} from '../core/oauth-callback'

/** Server Edition callback completer. It fetches only a registry-approved loopback URL. */
export class ServerOAuthCallbackService {
  private readonly registry = new OAuthCallbackRegistry()

  arm(input: OAuthCallbackArmInput): OAuthCallbackArmResult {
    return this.registry.arm({ ...input, mode: 'server-completer' })
  }

  cancel(ticket: string): boolean {
    return this.registry.cancel(ticket)
  }

  async complete(ticket: string, callbackUrl: string): Promise<OAuthCallbackCompleteResult> {
    const claimed = this.registry.complete(ticket, callbackUrl)
    if (!claimed.ok) return claimed
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(claimed.callbackUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'text/html,application/xhtml+xml' }
      })
      if (response.status < 200 || response.status >= 400) {
        return { ok: false, code: 'invalid-callback', message: 'The remote OAuth callback did not accept the completion request. Retry sign-in.' }
      }
      return claimed
    } catch {
      return { ok: false, code: 'invalid-callback', message: 'The session host could not reach its loopback OAuth listener. Retry sign-in while the session is running.' }
    } finally {
      clearTimeout(timeout)
    }
  }

  dispose(): void {
    this.registry.dispose()
  }
}

