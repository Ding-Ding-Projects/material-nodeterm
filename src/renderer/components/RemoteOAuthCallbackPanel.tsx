import { useEffect, useState } from 'react'
import { useOAuthCallbacks } from '../state/oauthCallbacks'
import { notify } from '../lib/adhdNotify'
import { Button, IconButton, TextField } from '../ui/md3'

/** Guided Server Edition recovery for an OAuth redirect that landed on the session host. */
function Prompt({
  ticket,
  provider,
  redirectPort,
  redirectPath,
  expiresAt,
  error
}: {
  ticket: string
  provider: string
  redirectPort: number
  redirectPath: string
  expiresAt: number
  error?: string
}): React.JSX.Element {
  const remove = useOAuthCallbacks((state) => state.remove)
  const setError = useOAuthCallbacks((state) => state.setError)
  const [callbackUrl, setCallbackUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAt - Date.now()))

  useEffect(() => {
    const timer = window.setInterval(() => setRemaining(Math.max(0, expiresAt - Date.now())), 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt])

  useEffect(() => {
    if (remaining === 0) void window.nodeTerminal.oauthCallbacks.cancel(ticket).finally(() => remove(ticket))
  }, [remaining, remove, ticket])

  const complete = async (): Promise<void> => {
    if (busy || !callbackUrl.trim()) return
    setBusy(true)
    try {
      const result = await window.nodeTerminal.oauthCallbacks.complete(ticket, callbackUrl.trim())
      if (result.ok) {
        remove(ticket)
        return
      }
      if (result.retryable) setError(ticket, result.message)
      else {
        notify({ kind: 'error', title: 'OAuth sign-in is incomplete', body: result.message })
        remove(ticket)
      }
    } catch {
      setError(ticket, 'The session host could not complete this callback. Check the session connection and retry.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="remote-oauth-panel" aria-labelledby={`remote-oauth-${ticket}`}>
      <div className="remote-oauth-panel__header">
        <div>
          <h2 id={`remote-oauth-${ticket}`}>Finish {provider} sign-in</h2>
          <p>
            This session uses <code>localhost:{redirectPort}{redirectPath}</code>. After the browser
            redirects, copy the complete callback URL from the address bar and paste it below.
          </p>
        </div>
        <IconButton
          className="remote-oauth-panel__close"
          size="dense"
          icon="close"
          aria-label="Cancel OAuth callback"
          onClick={() => void window.nodeTerminal.oauthCallbacks.cancel(ticket).finally(() => remove(ticket))}
        />
      </div>
      <TextField
        label="Callback URL"
        id={`remote-oauth-input-${ticket}`}
        type="url"
        value={callbackUrl}
        onChange={(event) => setCallbackUrl(event.target.value)}
        placeholder={`http://localhost:${redirectPort}${redirectPath}?code=…&state=…`}
        aria-describedby={`remote-oauth-help-${ticket}`}
        autoComplete="off"
      />
      <p id={`remote-oauth-help-${ticket}`} className="remote-oauth-panel__help">
        {error ?? `Expires in ${Math.ceil(remaining / 1000)} seconds. The URL is checked against this provider and session before it is fetched.`}
      </p>
      <div className="remote-oauth-panel__actions">
        <Button variant="filled" onClick={() => void complete()} disabled={busy || !callbackUrl.trim() || remaining === 0}>
          {busy ? 'Completing…' : 'Complete sign-in'}
        </Button>
        <Button variant="text" className="remote-oauth-panel__secondary" onClick={() => void window.nodeTerminal.oauthCallbacks.cancel(ticket).finally(() => remove(ticket))} disabled={busy}>
          Cancel
        </Button>
      </div>
    </section>
  )
}

export function RemoteOAuthCallbackPanel(): React.JSX.Element | null {
  const prompts = useOAuthCallbacks((state) => state.prompts)
  if (prompts.length === 0) return null
  return (
    <div className="remote-oauth-panel-stack" aria-live="polite">
      {prompts.map((prompt) => (
        <Prompt key={prompt.ticket} {...prompt} />
      ))}
    </div>
  )
}
