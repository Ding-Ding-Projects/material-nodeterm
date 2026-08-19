import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useKidsMode } from '@renderer/state/kidsMode'
import { KIDS_DISCLOSURE } from '@shared/kids-mode-policy'
import { isTopDialog, nextDialogId, popDialog, pushDialog } from '@renderer/components/dialog-stack'
import { PinPad } from './PinPad'
import { useEnableKidsDialog } from './entry'

/**
 * First-time PIN setup for entering Kids mode from the nav rail's `child_care` destination — see
 * entry.ts. Only shown when no grown-up PIN exists anywhere on this machine yet; a machine that
 * already has one skips straight to `enable()` with no dialog at all.
 *
 * Mount once at the app root (regardless of whether Kids mode is currently on), since this is the
 * ENTRY path — it has to be reachable from the ordinary developer canvas, before `<KidsShell/>`
 * exists at all.
 */
export function EnableKidsModeDialogHost(): React.JSX.Element | null {
  const open = useEnableKidsDialog((s) => s.open)
  const hide = useEnableKidsDialog((s) => s.hide)
  const enable = useKidsMode((s) => s.enable)
  const [step, setStep] = useState<'choose' | 'confirm'>('choose')
  const [chosen, setChosen] = useState('')
  const [errorToken, setErrorToken] = useState<number | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const dialogId = useRef<string>()
  if (!dialogId.current) dialogId.current = nextDialogId()

  const reset = () => {
    setStep('choose')
    setChosen('')
    setErrorToken(undefined)
    setBusy(false)
  }

  const close = () => {
    reset()
    hide()
  }

  // Only join the modal stack (and own Escape) while genuinely open — this component itself
  // never unmounts, since it is the ENTRY point mounted unconditionally at the app root.
  useEffect(() => {
    if (!open) return
    const id = dialogId.current!
    pushDialog(id)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopDialog(id)) close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      popDialog(id)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const onChoose = (pin: string) => {
    setChosen(pin)
    setStep('confirm')
  }

  const onConfirm = async (pin: string) => {
    if (pin !== chosen) {
      setStep('choose')
      setChosen('')
      setErrorToken(Date.now())
      return
    }
    setBusy(true)
    const result = await enable(pin)
    setBusy(false)
    if (result.ok) close()
    else setErrorToken(Date.now())
  }

  return createPortal(
    <div className="confirm-overlay md3-kids-enable-overlay" onClick={close}>
      <div className="md3-kids-enable-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="md3-kids-enable-dialog__title">
          {step === 'choose' ? 'Choose a grown-up PIN' : 'Enter it again to confirm'}
        </div>
        <p className="md3-kids-enable-dialog__hint">
          {step === 'choose'
            ? 'This 4-digit PIN unlocks the grown-up screen and turns Kids mode off. You can change it any time from Settings → Kids mode.'
            : "Type the same 4 digits once more."}
        </p>
        <PinPad
          length={4}
          onComplete={step === 'choose' ? onChoose : onConfirm}
          errorToken={errorToken}
          disabled={busy}
          ariaLabel={step === 'choose' ? 'Choose a 4-digit PIN' : 'Confirm the 4-digit PIN'}
        />
        {errorToken !== undefined && step === 'choose' ? (
          <div className="md3-kids-gate__status" role="alert">
            Those didn&apos;t match — try again.
          </div>
        ) : null}
        <p className="md3-kids-disclosure">{KIDS_DISCLOSURE}</p>
        <button type="button" className="md3-kids-textbtn" onClick={close}>
          Cancel
        </button>
      </div>
    </div>,
    document.body
  )
}
