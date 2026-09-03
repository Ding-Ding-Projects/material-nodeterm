import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import type { RemoteOAuthCompleteResult } from '../../shared/remote-oauth'
import { copy, fact, mapOwnedSentence } from '../lib/personalVocabulary/ownedCopy'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

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
  const map = useVocabularyMapper()

  useEffect(() => {
    const onDetected = (event: Event): void => {
      const value = (event as CustomEvent<Partial<PendingRemoteOAuth>>).detail
      const port = value?.port
      if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) return
      if (typeof value.callbackPath !== 'string' || typeof value.expiresAt !== 'number') return
      setPending({ port, callbackPath: value.callbackPath, expiresAt: value.expiresAt })
      setCallbackUrl('')
      setMessage(map('After the browser redirects to localhost, paste that complete callback URL here.'))
    }
    window.addEventListener('nodeterm:remote-oauth-callback', onDetected)
    return () => window.removeEventListener('nodeterm:remote-oauth-callback', onDetected)
  }, [map])

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
      setMessage(map('The callback could not be completed. Start the sign-in flow again.'))
      return
    }
    setBusy(false)
    if (result.status === 'completed') {
      setMessage(mapOwnedSentence(map, [copy('Remote sign-in callback delivered (HTTP '), fact(String(result.httpStatus)), copy(').')]))
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
  const sectionLabel = map('Remote OAuth callback')
  const heading = map('Complete remote sign-in')
  const destination = mapOwnedSentence(map, [
    copy('This terminal will redirect to localhost:'),
    fact(String(pending.port)),
    fact(pending.callbackPath),
    copy('. The server accepts only that observed loopback port and path, for this one attempt.')
  ])
  const expiry = mapOwnedSentence(map, [copy('This callback expires in about '), fact(String(seconds)), copy(' seconds.')])
  const placeholder = map('Paste the complete localhost callback URL')
  const inputLabel = map('Remote OAuth callback URL')
  const cancelLabel = map('Cancel')
  const completeLabel = map('Complete callback')
  return (
    <section className="md3-remote-oauth-notice" role="region" aria-label={sectionLabel}>
      <h2>{heading}</h2>
      <p>{destination}</p>
      <p aria-live="polite">{expiry}</p>
      <Input
        value={callbackUrl}
        onChange={(event) => setCallbackUrl(event.target.value)}
        vocabularyMode="factual"
        placeholder={placeholder}
        aria-label={inputLabel}
        type="url"
        autoFocus
        disabled={busy}
      />
      <p aria-live="polite">{message}</p>
      <div className="md3-dialog__actions">
        <Button vocabularyMode="factual" type="button" onClick={cancel} disabled={busy}>{cancelLabel}</Button>
        <Button vocabularyMode="factual" type="button" variant="primary" onClick={() => void complete()} disabled={busy || callbackUrl.trim().length === 0}>
          {completeLabel}
        </Button>
      </div>
    </section>
  )
}
