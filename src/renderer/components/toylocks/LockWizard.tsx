// The toy-lock creation wizard: a NON-MODAL popover anchored beside the exact element being
// locked. Names the target, picks password-or-TOTP, picks an unlock duration, states the
// just-for-fun disclosure and the recovery path, and creates the lock. See docs/toy-locks.md.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  ToyLockCredentialKind,
  ToyLockDurationMode,
  ToyLockTarget,
  ToyLockTotpEnrollment
} from '@shared/toylock'
import { useToyLocks } from '../../state/toylocks'
import { QrCode } from './QrCode'
import { RecoveryNotice } from './RecoveryNotice'

type Step = 'setup' | 'password' | 'totp' | 'done'

// Windows Hello itself is not reachable from here — Electron's `systemPreferences` biometric
// prompt (`promptTouchID`) is macOS-only, and there is no documented Electron API surface for
// Windows' own Hello/PIN prompt (see docs/toy-locks.md). What this ships instead, honestly
// labelled, is a Windows-only NUMERIC PIN credential — mechanically identical to a password (same
// scrypt hashing, see toylock-service.ts), never presented as "Windows Hello" anywhere in this
// file's copy. `navigator.platform`/`navigator.userAgent` is the same convention every other
// Windows-only affordance in this renderer already uses (see e.g. Canvas.tsx's `isMac`); the core
// re-checks `process.platform` itself before ever creating one, so a wrong guess here only costs a
// hidden/disabled option, never a false accept.
const isWindows = /Win/i.test(navigator.platform || navigator.userAgent)

export function LockWizard({
  target,
  anchor,
  onClose
}: {
  target: ToyLockTarget
  /** Viewport coordinates of whatever was clicked to open this — the popover anchors beside it. */
  anchor: { x: number; y: number }
  onClose: () => void
}): React.JSX.Element {
  const [step, setStep] = useState<Step>('setup')
  const [credentialKind, setCredentialKind] = useState<ToyLockCredentialKind>('password')
  const [duration, setDuration] = useState<ToyLockDurationMode>('session')
  const [durationMinutes, setDurationMinutes] = useState(15)
  const [lockedOnLaunch, setLockedOnLaunch] = useState(true)
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [enrollment, setEnrollment] = useState<ToyLockTotpEnrollment | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [alsoSaveToAuthenticator, setAlsoSaveToAuthenticator] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [step])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        cancelAndClose()
      }
    }
    // Capture so an in-flight TOTP enrollment is always cancelled server-side, even if a child
    // input would otherwise swallow Escape first.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cancelAndClose is stable enough here
  }, [enrollment])

  const cancelAndClose = (): void => {
    if (enrollment) void window.nodeTerminal.toylock.cancelTotp(enrollment.lockId)
    onClose()
  }

  // 'password' and 'windows-pin' go straight to the password step; 'password-totp' collects its
  // FIRST factor there too (submitPassword below routes it into startTotp instead of createPassword
  // once both password fields match) before moving on to enrollment.
  const startPassword = (): void => {
    setError(null)
    setStep('password')
  }

  /** `comboPassword` is set only when finishing the combo's password step — it is the signal to
   *  the core that this enrollment needs BOTH factors before it may ever be persisted (see
   *  ToyLockBeginTotpInput.password in shared/toylock.ts). */
  const startTotp = async (comboPassword?: string): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const res = await window.nodeTerminal.toylock.beginTotp({
        target,
        duration,
        durationMinutes: duration === 'minutes' ? durationMinutes : undefined,
        lockedOnLaunch,
        password: comboPassword
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setEnrollment(res.enrollment)
      setStep('totp')
    } finally {
      setBusy(false)
    }
  }

  const submitPassword = async (): Promise<void> => {
    if (!password) {
      setError(credentialKind === 'windows-pin' ? 'A PIN is required.' : 'A password is required.')
      return
    }
    if (credentialKind === 'windows-pin' && !/^\d+$/.test(password)) {
      setError('A Windows PIN must be digits only.')
      return
    }
    if (password !== passwordConfirm) {
      setError(
        credentialKind === 'windows-pin' ? 'The two PINs do not match.' : 'The two passwords do not match.'
      )
      return
    }
    setError(null)
    // The combo's password step hands off to TOTP enrollment instead of creating the lock now —
    // nothing is persisted until confirmTotp proves the second factor too (see toylock-service.ts).
    if (credentialKind === 'password-totp') {
      await startTotp(password)
      return
    }
    setBusy(true)
    try {
      const res = await window.nodeTerminal.toylock.createPassword({
        target,
        password,
        duration,
        durationMinutes: duration === 'minutes' ? durationMinutes : undefined,
        lockedOnLaunch,
        credentialKind: credentialKind === 'windows-pin' ? 'windows-pin' : undefined
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      useToyLocks.getState().upsert(res.record)
      setStep('done')
    } finally {
      setBusy(false)
    }
  }

  const confirmTotp = async (): Promise<void> => {
    if (!enrollment) return
    setError(null)
    setBusy(true)
    try {
      const res = await window.nodeTerminal.toylock.confirmTotp({ lockId: enrollment.lockId, code: totpCode })
      if (!res.ok) {
        setError(res.error)
        return
      }
      if (alsoSaveToAuthenticator) {
        await window.nodeTerminal.authenticator.addManual({
          issuer: enrollment.issuer,
          account: enrollment.account,
          secretBase32: enrollment.secretBase32,
          algorithm: enrollment.algorithm,
          digits: enrollment.digits,
          period: enrollment.period
        })
      }
      useToyLocks.getState().upsert(res.record)
      setStep('done')
    } finally {
      setBusy(false)
    }
  }

  const top = Math.min(anchor.y + 8, window.innerHeight - 420)
  const left = Math.min(anchor.x + 8, window.innerWidth - 320)

  return createPortal(
    <>
      <div className="toylock-wizard__backdrop" onClick={cancelAndClose} />
      <div
        className="toylock-wizard"
        style={{ top: Math.max(8, top), left: Math.max(8, left) }}
        role="dialog"
        aria-modal="false"
        aria-label={`Lock ${target.label}`}
        ref={boxRef}
      >
        <div className="toylock-wizard__title">Lock “{target.label}”</div>

        {step === 'setup' && (
          <>
            <RecoveryNotice />
            <div className="toylock-field">
              <span className="toylock-field__label">Unlock with</span>
              <div className="toylock-radio-row">
                <label>
                  <input
                    type="radio"
                    name="credentialKind"
                    checked={credentialKind === 'password'}
                    onChange={() => setCredentialKind('password')}
                    ref={firstFieldRef}
                  />
                  Password
                </label>
                <label>
                  <input
                    type="radio"
                    name="credentialKind"
                    checked={credentialKind === 'totp'}
                    onChange={() => setCredentialKind('totp')}
                  />
                  Authenticator code (TOTP)
                </label>
                <label>
                  <input
                    type="radio"
                    name="credentialKind"
                    checked={credentialKind === 'password-totp'}
                    onChange={() => setCredentialKind('password-totp')}
                  />
                  Password + code (both required)
                </label>
                <label title={isWindows ? undefined : 'Windows only'}>
                  <input
                    type="radio"
                    name="credentialKind"
                    checked={credentialKind === 'windows-pin'}
                    disabled={!isWindows}
                    onChange={() => setCredentialKind('windows-pin')}
                  />
                  Windows PIN{!isWindows && ' (Windows only)'}
                </label>
              </div>
              {credentialKind === 'windows-pin' && (
                <span className="toylock-hint">
                  A numeric PIN, hashed the same way as a password — not Windows Hello. Electron has
                  no Windows Hello prompt to call into; see docs/toy-locks.md.
                </span>
              )}
            </div>
            <div className="toylock-field">
              <span className="toylock-field__label">Stay unlocked</span>
              <select
                className="toylock-select"
                value={duration}
                onChange={(e) => setDuration(e.target.value as ToyLockDurationMode)}
              >
                <option value="session">Just while you're on this surface</option>
                <option value="minutes">For a number of minutes</option>
                <option value="until-close">Until nodeterm quits</option>
              </select>
              {duration === 'minutes' && (
                <input
                  type="number"
                  className="toylock-number"
                  min={1}
                  max={1440}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Math.max(1, Number(e.target.value) || 1))}
                  aria-label="Minutes to stay unlocked"
                />
              )}
            </div>
            <label className="toylock-checkbox-row">
              <input
                type="checkbox"
                checked={lockedOnLaunch}
                onChange={(e) => setLockedOnLaunch(e.target.checked)}
              />
              Locked again the next time nodeterm starts
            </label>
            {error && <div className="toylock-error">{error}</div>}
            <div className="toylock-wizard__actions">
              <button className="toylock-btn" onClick={cancelAndClose}>
                Cancel
              </button>
              <button
                className="toylock-btn toylock-btn--primary"
                disabled={busy}
                onClick={() =>
                  credentialKind === 'password' || credentialKind === 'windows-pin' || credentialKind === 'password-totp'
                    ? startPassword()
                    : void startTotp()
                }
              >
                {credentialKind === 'password'
                  ? 'Set password…'
                  : credentialKind === 'windows-pin'
                    ? 'Set PIN…'
                    : credentialKind === 'password-totp'
                      ? 'Set password…'
                      : 'Generate secret…'}
              </button>
            </div>
          </>
        )}

        {step === 'password' && (
          <>
            <div className="toylock-field">
              <span className="toylock-field__label">
                {credentialKind === 'windows-pin' ? 'PIN' : 'Password'}
                {credentialKind === 'password-totp' && ' (first factor — an authenticator code is required too)'}
              </span>
              <input
                ref={firstFieldRef}
                type="password"
                inputMode={credentialKind === 'windows-pin' ? 'numeric' : undefined}
                className="toylock-input"
                value={password}
                onChange={(e) =>
                  setPassword(
                    credentialKind === 'windows-pin' ? e.target.value.replace(/[^0-9]/g, '') : e.target.value
                  )
                }
                autoComplete="new-password"
              />
            </div>
            <div className="toylock-field">
              <span className="toylock-field__label">
                {credentialKind === 'windows-pin' ? 'Confirm PIN' : 'Confirm password'}
              </span>
              <input
                type="password"
                inputMode={credentialKind === 'windows-pin' ? 'numeric' : undefined}
                className="toylock-input"
                value={passwordConfirm}
                onChange={(e) =>
                  setPasswordConfirm(
                    credentialKind === 'windows-pin' ? e.target.value.replace(/[^0-9]/g, '') : e.target.value
                  )
                }
                autoComplete="new-password"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitPassword()
                }}
              />
            </div>
            {error && <div className="toylock-error">{error}</div>}
            <div className="toylock-wizard__actions">
              <button className="toylock-btn" onClick={() => setStep('setup')}>
                Back
              </button>
              <button className="toylock-btn toylock-btn--primary" disabled={busy} onClick={() => void submitPassword()}>
                {credentialKind === 'password-totp'
                  ? busy
                    ? 'Continuing…'
                    : 'Next: authenticator code…'
                  : busy
                    ? 'Locking…'
                    : 'Lock it'}
              </button>
            </div>
          </>
        )}

        {step === 'totp' && enrollment && (
          <>
            <div className="toylock-qr-wrap">
              <QrCode text={enrollment.otpauthUri} size={180} label={`Pair an authenticator for ${target.label}`} />
            </div>
            <div className="toylock-manual-secret">
              <span className="toylock-field__label">Or type this into an authenticator app</span>
              <code className="toylock-secret-text">{groupSecret(enrollment.secretBase32)}</code>
              <span className="toylock-hint">
                {enrollment.algorithm} · {enrollment.digits} digits · every {enrollment.period}s
              </span>
            </div>
            <div className="toylock-field">
              <span className="toylock-field__label">Type the current code to confirm pairing</span>
              <input
                ref={firstFieldRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="toylock-input toylock-input--code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void confirmTotp()
                }}
                maxLength={8}
              />
            </div>
            <label className="toylock-checkbox-row">
              <input
                type="checkbox"
                checked={alsoSaveToAuthenticator}
                onChange={(e) => setAlsoSaveToAuthenticator(e.target.checked)}
              />
              Also save this secret in the built-in authenticator (this makes the lock ornamental —
              the key is right there next to the door it opens)
            </label>
            {error && <div className="toylock-error">{error}</div>}
            <div className="toylock-wizard__actions">
              <button className="toylock-btn" onClick={cancelAndClose}>
                Cancel
              </button>
              <button className="toylock-btn toylock-btn--primary" disabled={busy || totpCode.length < 6} onClick={() => void confirmTotp()}>
                {busy ? 'Confirming…' : 'Confirm & lock'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <div className="toylock-success">🔒 “{target.label}” is locked.</div>
            <RecoveryNotice />
            <div className="toylock-wizard__actions">
              <button className="toylock-btn toylock-btn--primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </>,
    document.body
  )
}

/** Groups a base32 secret into 4-character chunks for easier manual typing/reading. */
function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim()
}
