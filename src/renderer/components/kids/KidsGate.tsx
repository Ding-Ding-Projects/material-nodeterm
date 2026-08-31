import { useEffect, useState } from 'react'

import { IconLock } from '@renderer/components/icons'
import { verifyKidsModePin } from '@renderer/bridge/stubs'
import { openDestructiveGate } from '@renderer/state/destructiveGate'
import { useKidsMode } from '@renderer/state/kidsMode'
import { PinPad } from './PinPad'
import { narrateKidsScreen } from './narration'

/**
 * The parent gate — "Just a moment, this part is for a grown-up. Enter the PIN."
 *
 * Verification goes over IPC (`window.nodeTerminal.kidsMode.verifyPin`), never a local string
 * comparison — the renderer never learns what the real PIN is, only whether the attempt matched.
 * This is a READ-ONLY check: unlike Settings' "Turn off" flow it never calls `disable()`, so
 * getting the PIN right here does not leave kids mode — the grown-up screen this gate protects
 * has its own explicit "Exit to developer mode" action for that.
 *
 * `variant='casual'` is the everyday accidental-tap gate (the Home screen's lock icon): it offers
 * "Back to Beep" so a kid who tapped the lock icon by mistake is not stuck facing a PIN pad.
 * `variant='timesUp'` is what the daily time limit switches to when it fires: the same pad and
 * the same verification, but with NO way back to Home without the PIN — offering an escape there
 * would make the whole "ends the session" promise of that switch a decoration.
 */
export function KidsGate({
  modeName,
  variant,
  onVerified,
  onBackToKids
}: {
  /** The renamable Kids-mode display name (e.g. a child's own name) — used only for the
   *  "time's up" copy. "Beep" the mascot below is a fixed character name and is never affected
   *  by this rename. */
  modeName: string
  variant: 'casual' | 'timesUp'
  onVerified: (pin: string) => void
  onBackToKids: () => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [errorToken, setErrorToken] = useState<number | undefined>(undefined)
  const [message, setMessage] = useState<string | null>(null)
  const credentialState = useKidsMode((s) => s.credentialState)
  const resetCredential = useKidsMode((s) => s.resetCredential)

  useEffect(() => {
    narrateKidsScreen(
      variant === 'timesUp'
        ? "Time's up for today. A grown-up can enter the PIN to continue."
        : 'Just a moment. This part is for a grown-up. Enter the PIN.'
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant])

  const attempt = async (pin: string) => {
    setBusy(true)
    setMessage(null)
    const ok = credentialState === 'absent'
      ? true
      : credentialState === 'present' && await verifyKidsModePin(window.nodeTerminal.kidsMode, pin)
    setBusy(false)
    if (ok) {
      onVerified(pin)
      return
    }
    setMessage("That's not right — try again.")
    setErrorToken(Date.now())
  }

  const requestReset = (): void => {
    openDestructiveGate({
      title: 'Reset the Kids mode PIN',
      description: 'Remove only the Kids mode PIN and turn Kids mode off. School mode, toy locks, projects, sessions, and other settings stay unchanged.',
      affected: ['Kids mode PIN', 'Kids mode enabled state'],
      confirmLabel: 'Reset Kids mode PIN',
      onConfirm: () => {
        void resetCredential().then((result) => {
          if (!result.ok) setMessage(result.error)
        })
      }
    })
  }

  return (
    <div className="md3-kids-screen md3-kids-gate" data-screen-label="Parent gate">
      <div className="md3-kids-gate__icon">
        <IconLock />
      </div>
      <div className="md3-kids-gate__copy">
        <div className="md3-kids-gate__title">
          {variant === 'timesUp' ? 'All done for today' : 'Just a moment'}
        </div>
        <div className="md3-kids-gate__subtitle">
          {variant === 'timesUp'
            ? `${modeName}'s time for today is up. A grown-up can enter the PIN to keep going.`
            : 'This part is for a grown-up. Enter the PIN.'}
        </div>
      </div>
      {credentialState === 'loading' ? (
        <div className="md3-kids-gate__status" role="status">Checking the shared PIN state…</div>
      ) : credentialState === 'unavailable' ? (
        <div className="md3-kids-gate__status" role="alert">The shared PIN cannot be checked. Kids mode stays locked.</div>
      ) : credentialState === 'present' ? (
        <PinPad
          length={4}
          onComplete={attempt}
          errorToken={errorToken}
          disabled={busy}
          ariaLabel="Grown-up PIN"
        />
      ) : (
        <button type="button" className="md3-kids-filled-btn" onClick={() => onVerified('')}>
          Continue to grown-up controls
        </button>
      )}
      <div className="md3-kids-gate__status" role="status" aria-live="polite">
        {message}
      </div>
      {variant === 'casual' ? (
        <button type="button" className="md3-kids-textbtn" onClick={onBackToKids}>
          Back to Beep
        </button>
      ) : null}
      <button type="button" className="md3-kids-textbtn" onClick={requestReset}>
        I never set this PIN
      </button>
    </div>
  )
}
