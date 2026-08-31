import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useKidsMode } from '@renderer/state/kidsMode'
import { KIDS_DISCLOSURE } from '@shared/kids-mode-policy'
import { isTopDialog, nextDialogId, popDialog, pushDialog } from '@renderer/components/dialog-stack'
import { PinPad } from './PinPad'
import { useEnableKidsDialog } from './entry'

/**
 * PIN setup or verification for entering Kids mode from the nav rail's `child_care` destination —
 * see entry.ts. A machine with no grown-up PIN gets choose plus confirm; an existing PIN must be
 * verified before `enable()` can turn the mode on.
 *
 * Mount once at the app root (regardless of whether Kids mode is currently on), since this is the
 * ENTRY path — it has to be reachable from the ordinary developer canvas, before `<KidsShell/>`
 * exists at all.
 */
export function EnableKidsModeDialogHost(): React.JSX.Element | null {
  const open = useEnableKidsDialog((s) => s.open)
  const hide = useEnableKidsDialog((s) => s.hide)
  const enable = useKidsMode((s) => s.enable)
  const credentialState = useKidsMode((s) => s.credentialState)
  const refreshCredentialState = useKidsMode((s) => s.refreshCredentialState)
  const [step, setStep] = useState<'choose' | 'confirm'>('choose')
  const [chosen, setChosen] = useState('')
  const [errorToken, setErrorToken] = useState<number | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const dialogId = useRef<string>()
  const dialogRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const focusedReadyState = useRef(false)
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
    if (!open) {
      focusedReadyState.current = false
      return
    }
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void refreshCredentialState()
    const id = dialogId.current!
    pushDialog(id)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopDialog(id)) close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      popDialog(id)
      window.removeEventListener('keydown', onKey)
      openerRef.current?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open || credentialState === 'loading' || focusedReadyState.current) return
    const first = dialogRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    first?.focus()
    focusedReadyState.current = true
  }, [open, credentialState])

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab' || !isTopDialog(dialogId.current!)) return
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )]
    if (focusable.length === 0) return
    event.preventDefault()
    const current = focusable.indexOf(document.activeElement as HTMLElement)
    const next = event.shiftKey
      ? (current <= 0 ? focusable.length - 1 : current - 1)
      : (current + 1) % focusable.length
    focusable[next]?.focus()
  }

  if (!open) return null

  const onChoose = (pin: string) => {
    setChosen(pin)
    setStep('confirm')
  }

  const onVerifyExisting = async (pin: string) => {
    setBusy(true)
    const result = await enable(pin)
    setBusy(false)
    if (result.ok) close()
    else setErrorToken(Date.now())
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
    <div className="confirm-overlay md3-kids-enable-overlay" onClick={() => isTopDialog(dialogId.current!) && close()}>
      <div
        ref={dialogRef}
        className="md3-kids-enable-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`kids-enable-title-${dialogId.current}`}
        aria-describedby={`kids-enable-hint-${dialogId.current}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <div className="md3-kids-enable-dialog__title" id={`kids-enable-title-${dialogId.current}`}>
          {credentialState === 'loading'
            ? 'Checking the grown-up PIN'
            : credentialState === 'unavailable'
              ? 'The grown-up PIN is unavailable'
              : credentialState === 'present'
                ? 'Enter the grown-up PIN to continue'
                : step === 'choose'
                  ? 'Choose a grown-up PIN'
                  : 'Enter it again to confirm'}
        </div>
        <p className="md3-kids-enable-dialog__hint" id={`kids-enable-hint-${dialogId.current}`}>
          {credentialState === 'loading'
            ? 'The app is checking the shared PIN state. Nothing will be changed yet.'
            : credentialState === 'unavailable'
              ? 'The shared PIN cannot be checked. Nothing was changed; try again after the credential store is available.'
              : credentialState === 'present'
                ? 'Kids mode already has a PIN. Verify it here before turning the mode on.'
                : step === 'choose'
                  ? 'This 4-digit PIN unlocks the grown-up screen and turns Kids mode off. You can change it any time from Settings → Kids mode.'
                  : 'Type the same 4 digits once more.'}
        </p>
        {credentialState === 'present' ? <PinPad
          key="verify-existing"
          length={4}
          onComplete={onVerifyExisting}
          errorToken={errorToken}
          disabled={busy}
          ariaLabel="Verify the existing grown-up PIN"
        /> : credentialState === 'absent' ? <PinPad
          // `key` is load-bearing, not tidiness. PinPad holds the typed digits in its OWN state and
          // `push()` early-returns once that reaches `length`. Without a key React reuses one instance
          // across choose -> confirm, so the confirm step arrives still holding the four digits from
          // the choose step: every tap is silently ignored, `onComplete` never fires again, and a
          // first-time user simply cannot turn Kids mode on. Remounting per step gives the confirm pad
          // the empty value that step actually means.
          key={step}
          length={4}
          onComplete={step === 'choose' ? onChoose : onConfirm}
          errorToken={errorToken}
          disabled={busy}
          ariaLabel={step === 'choose' ? 'Choose a 4-digit PIN' : 'Confirm the 4-digit PIN'}
        /> : null}
        {errorToken !== undefined && (step === 'choose' || credentialState === 'present') ? (
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
