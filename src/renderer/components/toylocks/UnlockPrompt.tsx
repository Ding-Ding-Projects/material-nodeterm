// The unlock prompt for an existing toy lock: anchored, non-modal, asks for whatever credential
// kind the lock was created with, and gives honest rate-limited feedback on a wrong attempt — see
// docs/toy-locks.md. Never characterises the stored credential (its length, composition, etc.).
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ToyLockRecord } from '@shared/toylock'
import { useToyLocks } from '../../state/toylocks'

export function UnlockPrompt({
  record,
  anchor,
  onUnlocked,
  onClose
}: {
  record: ToyLockRecord
  anchor: { x: number; y: number }
  onUnlocked: () => void
  onClose: () => void
}): React.JSX.Element {
  // `password` carries a plain password OR a Windows PIN (same field on the wire — see
  // ToyLockVerifyInput); `code` carries a TOTP code. The combo kind (`password-totp`) is the only
  // one that reads both.
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [retryAfterMs, setRetryAfterMs] = useState(0)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const needsPassword = record.credentialKind !== 'totp'
  const needsCode = record.credentialKind === 'totp' || record.credentialKind === 'password-totp'

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Countdown re-render while a rate-limit window is in effect, so "try again in 12s" actually
  // ticks down rather than sitting frozen.
  useEffect(() => {
    if (retryAfterMs <= 0) return
    const t = setTimeout(() => setRetryAfterMs((v) => Math.max(0, v - 250)), 250)
    return () => clearTimeout(t)
  }, [retryAfterMs])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const submit = async (): Promise<void> => {
    if (retryAfterMs > 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await window.nodeTerminal.toylock.verify({
        id: record.id,
        password: needsPassword ? password : undefined,
        code: needsCode ? code : undefined
      })
      if (res.ok) {
        useToyLocks.getState().markUnlocked(record)
        onUnlocked()
        return
      }
      setError(res.reason ?? 'That did not match.')
      if (res.retryAfterMs) setRetryAfterMs(res.retryAfterMs)
    } finally {
      setBusy(false)
    }
  }

  const openSupportTickets = (): void => {
    onClose()
    window.dispatchEvent(new CustomEvent('nodeterm:open-settings', { detail: { section: 'support' } }))
  }

  const top = Math.min(anchor.y + 8, window.innerHeight - 220)
  const left = Math.min(anchor.x + 8, window.innerWidth - 300)
  const waitSeconds = Math.ceil(retryAfterMs / 1000)

  return createPortal(
    <>
      <div className="toylock-wizard__backdrop" onClick={onClose} />
      <div
        className="toylock-wizard toylock-unlock"
        style={{ top: Math.max(8, top), left: Math.max(8, left) }}
        role="dialog"
        aria-modal="false"
        aria-label={`Unlock ${record.target.label}`}
      >
        <div className="toylock-wizard__title">🔒 “{record.target.label}” is locked</div>
        {needsPassword && (
          <div className="toylock-field">
            <span className="toylock-field__label">
              {record.credentialKind === 'windows-pin' ? 'PIN' : 'Password'}
              {record.credentialKind === 'password-totp' && ' (both required)'}
            </span>
            <input
              ref={inputRef}
              type="password"
              inputMode={record.credentialKind === 'windows-pin' ? 'numeric' : undefined}
              className="toylock-input"
              value={password}
              onChange={(e) =>
                setPassword(
                  record.credentialKind === 'windows-pin' ? e.target.value.replace(/[^0-9]/g, '') : e.target.value
                )
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !needsCode) void submit()
              }}
              disabled={retryAfterMs > 0}
            />
          </div>
        )}
        {needsCode && (
          <div className="toylock-field">
            <span className="toylock-field__label">
              Authenticator code
              {record.credentialKind === 'password-totp' && ' (both required)'}
            </span>
            <input
              ref={needsPassword ? undefined : inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="toylock-input toylock-input--code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
              disabled={retryAfterMs > 0}
              maxLength={8}
            />
          </div>
        )}
        {error && (
          <div className="toylock-error">
            {error}
            {retryAfterMs > 0 && ` Try again in ${waitSeconds}s.`}
          </div>
        )}
        <div className="toylock-wizard__actions">
          <button className="toylock-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="toylock-btn toylock-btn--primary"
            disabled={
              busy || retryAfterMs > 0 || (needsPassword && !password) || (needsCode && !code)
            }
            onClick={() => void submit()}
          >
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </div>
        <button className="toylock-btn--link" onClick={openSupportTickets}>
          Forgotten your password?
        </button>
      </div>
    </>,
    document.body
  )
}
