import { useEffect, useState } from 'react'

import { IconLock } from '@renderer/components/icons'
import { verifyKidsModePin } from '@renderer/bridge/stubs'
import { openDestructiveGate } from '@renderer/state/destructiveGate'
import { useKidsMode } from '@renderer/state/kidsMode'
import { PinPad } from './PinPad'
import { narrateKidsScreen } from './narration'
import { Button } from '@renderer/ui/md3'
import { useVocabularyMapper, useVocabularyTemplate } from '@renderer/lib/personalVocabulary/useVocabularyText'

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
  const vocab = useVocabularyMapper()
  const [busy, setBusy] = useState(false)
  const [errorToken, setErrorToken] = useState<number | undefined>(undefined)
  const [message, setMessage] = useState<string | null>(null)
  const credentialState = useKidsMode((s) => s.credentialState)
  const resetCredential = useKidsMode((s) => s.resetCredential)

  useEffect(() => {
    narrateKidsScreen(
      variant === 'timesUp'
        ? vocab("Time's up for today. A grown-up can enter the PIN to continue.")
        : vocab('Just a moment. This part is for a grown-up. Enter the PIN.')
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant])

  const attempt = async (pin: string) => {
    setBusy(true)
    setMessage(null)
    // Even the absent route must ask the authoritative channel. A stale renderer-side
    // classification must never turn into a local grown-up bypass.
    const ok = credentialState !== 'unavailable' &&
      await verifyKidsModePin(window.nodeTerminal.kidsMode, credentialState === 'absent' ? '' : pin)
    setBusy(false)
    if (ok) {
      onVerified(pin)
      return
    }
    await useKidsMode.getState().refreshCredentialState()
    setMessage(vocab("That's not right — try again."))
    setErrorToken(Date.now())
  }

  const requestReset = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const target = event.currentTarget
    const rect = target.getBoundingClientRect()
    openDestructiveGate({
      title: vocab('Reset the Kids mode PIN'),
      description: vocab('Remove only the Kids mode PIN and turn Kids mode off. School mode, toy locks, projects, sessions, and other settings stay unchanged.'),
      affected: [vocab('Kids mode PIN'), vocab('Kids mode enabled state')],
      confirmLabel: vocab('Reset Kids mode PIN'),
      anchor: { x: rect.left, y: rect.bottom },
      restoreFocusEl: target,
      onConfirm: () => {
        void resetCredential().then((result) => {
          if (!result.ok) setMessage(result.error)
        })
      }
    })
  }

  const timesUpSubtitle = useVocabularyTemplate('{name}\'s time for today is up. A grown-up can enter the PIN to keep going.', { name: modeName })

  return (
    <div className="md3-kids-screen md3-kids-gate" data-screen-label={vocab('Parent gate')}>
      <div className="md3-kids-gate__icon">
        <IconLock />
      </div>
      <div className="md3-kids-gate__copy">
        <div className="md3-kids-gate__title">
          {variant === 'timesUp' ? vocab('All done for today') : vocab('Just a moment')}
        </div>
        <div className="md3-kids-gate__subtitle">
          {variant === 'timesUp'
            ? timesUpSubtitle
            : vocab('This part is for a grown-up. Enter the PIN.')}
        </div>
      </div>
      {credentialState === 'loading' ? (
        <div className="md3-kids-gate__status" role="status">{vocab('Checking the shared PIN state…')}</div>
      ) : credentialState === 'unavailable' ? (
        <div className="md3-kids-gate__status" role="alert">{vocab('The shared PIN cannot be checked. Kids mode stays locked.')}</div>
      ) : credentialState === 'present' ? (
        <PinPad
          length={4}
          onComplete={attempt}
          errorToken={errorToken}
          disabled={busy}
          ariaLabel={vocab('Grown-up PIN')}
        />
      ) : (
        <Button variant="filled" vocabularyMode="factual" className="md3-kids-filled-btn" onClick={() => void attempt('')}>
          {vocab('Continue to grown-up controls')}
        </Button>
      )}
      <div className="md3-kids-gate__status" role="status" aria-live="polite">
        {message}
      </div>
      {variant === 'casual' ? (
        <Button variant="text" vocabularyMode="factual" className="md3-kids-textbtn" onClick={onBackToKids}>
          {vocab('Back to Beep')}
        </Button>
      ) : null}
      <Button variant="text" vocabularyMode="factual" className="md3-kids-textbtn" onClick={requestReset}>
        {vocab('I never set this PIN')}
      </Button>
    </div>
  )
}
