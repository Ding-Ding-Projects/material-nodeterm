import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import type { RemoteOAuthCompleteResult } from '../../shared/remote-oauth'

interface PendingRemoteOAuth {
  port: number
  callbackPath: string
  expiresAt: number
}

/**
 * Server Edition's explicit callback-completion surface.
 *
 * The authorize flow is detected from terminal output, but the callback URL is user-supplied only
 * after the browser has redirected. Keep it in this component's ephemeral state and pass it once
 * to the host-side single-use completer. Nothing is written to settings, history, or logs.
 */
export function RemoteOAuthCallbackNotice(): React.JSX.Element | null {
  const [pending, setPending] = useState<PendingRemoteOAuth | null>(null)
  const [callbackUrl, setCallbackUrl] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onDetected = (event: Event): void => {
      const value = (event as CustomEvent<Partial<PendingRemoteOAuth>>).detail
      if (!Number.isInteger(value?.port) || value.port! < 1 || value.port! > 65_535) return
      if (typeof value.callbackPath !== 'string' || typeof value.expiresAt !== 'number') return
      setPending({ port: value.port, callbackPath: value.callbackPath, expiresAt: value.expiresAt })
      setCallbackUrl('')
      setMessage('After the browser redirects to localhost, paste that complete callback URL here.')
    }
    window.addEventListener('nodeterm:remote-oauth-callback', onDetected)
    return () => window.removeEventListener('nodeterm:remote-oauth-callback', onDetected)
  }, [])

  const cancel = (): void => {
    const pendingCancel = window.nodeTerminal.remoteOAuth?.cancel()
    void pendingCancel?.catch(() => {})
    setPending(null)
    setCallbackUrl('')
    setMessage('')
  }

  const complete = async (): Promise<void> => {
    const api = window.nodeTerminal.remoteOAuth
    if (!api || !pending || busy) return
    setBusy(true)
    let result: RemoteOAuthCompleteResult
    try {
      result = await api.complete(callbackUrl)
    } catch {
      setBusy(false)
      setMessage('The callback could not be completed. Start the sign-in flow again.')
      return
    }
    setBusy(false)
    if (result.status === 'completed') {
      setMessage(`Remote sign-in callback delivered (HTTP ${result.httpStatus}).`)
      setPending(null)
      setCallbackUrl('')
      return
    }
    setMessage(result.error)
    setCallbackUrl('')
    setPending(null)
  }

  if (!pending || !window.nodeTerminal.remoteOAuth) return null
  const seconds = Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000))
  return (
    <section className="md3-remote-oauth-notice" role="region" aria-label="Remote OAuth callback">
      <h2>Complete remote sign-in</h2>
      <p>
        This terminal will redirect to localhost:{pending.port}{pending.callbackPath}. The server
        accepts only that observed loopback port and path, for this one attempt.
      </p>
      <p aria-live="polite">This callback expires in about {seconds} seconds.</p>
      <Input
        value={callbackUrl}
        onChange={(event) => setCallbackUrl(event.target.value)}
        placeholder="Paste the complete localhost callback URL"
        aria-label="Remote OAuth callback URL"
        type="url"
        autoFocus
        disabled={busy}
      />
      <p aria-live="polite">{message}</p>
      <div className="md3-dialog__actions">
        <Button type="button" onClick={cancel} disabled={busy}>Cancel</Button>
        <Button type="button" variant="primary" onClick={() => void complete()} disabled={busy || callbackUrl.trim().length === 0}>
          Complete callback
        </Button>
      </div>
    </section>
  )
}
