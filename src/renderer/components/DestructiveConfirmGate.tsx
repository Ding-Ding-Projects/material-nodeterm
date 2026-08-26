import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMenuFlip } from '../ui/useMenuFlip'
import { isTopDialog, nextDialogId, popDialog, pushDialog } from './dialog-stack'
import { Slider } from '@renderer/ui/md3'

export interface DestructiveConfirmGateProps {
  /** The exact destructive action, in plain words — "Delete 3 nodes", "Delete project
   *  permanently". Never a euphemism; the funny-level/localization rules apply to copy
   *  ELSEWHERE in the app, never to this sentence. */
  title: string
  /** What will be affected and why it cannot be undone. Kept as plain, unambiguous prose —
   *  animation and styling below this line may not obscure what it says. */
  description: string
  /** Optional named list of the exact items affected (node titles, a project name, …) — so the
   *  user approves what they were actually shown, not whichever item a race condition left
   *  behind. */
  affected?: string[]
  confirmLabel?: string
  /** Screen coordinates of the control that triggered this — renders an ANCHORED card beside
   *  it (via useMenuFlip) instead of a dead-center modal, per the "prefer anchored" rule. Omit
   *  for a modal (e.g. a keyboard-triggered delete with no obvious anchor point). */
  anchor?: { x: number; y: number }
  /** The control to return keyboard focus to once this closes (confirm OR cancel). */
  restoreFocusEl?: HTMLElement | null
  onConfirm: () => void
  onCancel: () => void
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * Super confirmation for a destructive, irreversible action: two independently operated keys
 * arm a full-range slider, which must be dragged all the way across before the action fires.
 * Built entirely in this app's own UI layer — no separate helper app or hosted page. See
 * docs/destructive-confirmation.md for the full contract and where this is wired in.
 */
export function DestructiveConfirmGate({
  title,
  description,
  affected,
  confirmLabel = 'Delete',
  anchor,
  restoreFocusEl,
  onConfirm,
  onCancel
}: DestructiveConfirmGateProps): React.JSX.Element {
  const idRef = useRef<string>()
  if (!idRef.current) idRef.current = nextDialogId()
  const id = idRef.current
  const firstKeyRef = useRef<HTMLButtonElement>(null)
  const completingRef = useRef(false)
  const completionTimerRef = useRef<number | null>(null)

  const [keyA, setKeyA] = useState(false)
  const [keyB, setKeyB] = useState(false)
  const [value, setValue] = useState(0)
  const [completing, setCompleting] = useState(false)
  const bothArmed = keyA && keyB

  const titleId = `destgate-title-${id}`
  const descId = `destgate-desc-${id}`

  useEffect(() => {
    pushDialog(id)
    firstKeyRef.current?.focus()
    return () => {
      if (completionTimerRef.current !== null) window.clearTimeout(completionTimerRef.current)
      popDialog(id)
    }
  }, [id])

  // Return focus to the control that opened this, whichever way it closes.
  useEffect(() => {
    return () => {
      restoreFocusEl?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCancel = (): void => {
    if (completingRef.current) return // authorization is already in flight — Escape can't un-fire it
    onCancel()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isTopDialog(id)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        handleCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, completing])

  // Reaching the full range while both keys are armed authorizes the action — but only once,
  // and only forward (dragging back down before reaching 100 does nothing; there is no partial
  // trigger). A short completion animation plays first (skipped under reduced motion) so the
  // user sees confirmation land before the dialog disappears out from under them.
  const armAndMaybeFire = (v: number): void => {
    setValue(v)
    if (v >= 100 && bothArmed && !completingRef.current) {
      // State updates are asynchronous. The ref is the synchronous one-shot latch that prevents
      // an input event plus the same gesture's key-up from scheduling two irreversible commits.
      completingRef.current = true
      setCompleting(true)
      const delay = prefersReducedMotion() ? 120 : 480
      completionTimerRef.current = window.setTimeout(() => {
        completionTimerRef.current = null
        onConfirm()
      }, delay)
    }
  }

  // Always called (rules of hooks) — its measured position is only USED when an anchor was
  // given (see `style` below). A stray (0,0) flip target when there is no anchor is harmless.
  const flip = useMenuFlip(anchor?.y ?? 0, anchor?.x ?? 0)

  const card = (
    <div
      ref={flip.ref}
      className={`destgate${anchor ? ' destgate--anchored' : ' destgate--centered'}`}
      style={anchor ? { top: flip.top, left: flip.left } : undefined}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="destgate__head">
        <span className="destgate__icon" aria-hidden>
          ⚠
        </span>
        <div>
          <div className="destgate__title" id={titleId}>
            {title}
          </div>
          <div className="destgate__desc" id={descId}>
            {description}
          </div>
        </div>
      </div>

      {affected && affected.length > 0 && (
        <ul className="destgate__affected" aria-label="Affected items">
          {affected.map((a, i) => (
            <li key={i} title={a}>
              {a}
            </li>
          ))}
        </ul>
      )}

      {!completing && (
        <>
          <div className="destgate__keys">
            <button
              ref={firstKeyRef}
              type="button"
              className="destgate__key"
              aria-pressed={keyA}
              onClick={() => setKeyA((v) => !v)}
            >
              <span className="destgate__key-glyph" aria-hidden>
                {keyA ? '🔓' : '🔒'}
              </span>
              Key 1{keyA ? ' — armed' : ''}
            </button>
            <button
              type="button"
              className="destgate__key"
              aria-pressed={keyB}
              onClick={() => setKeyB((v) => !v)}
            >
              <span className="destgate__key-glyph" aria-hidden>
                {keyB ? '🔓' : '🔒'}
              </span>
              Key 2{keyB ? ' — armed' : ''}
            </button>
          </div>

          <div className="destgate__slider-wrap">
            <div className="destgate__slider-label">
              <span>Slide to confirm</span>
              <span>{value}%</span>
            </div>
            <Slider
              className="destgate__slider"
              min={0}
              max={100}
              step={1}
              value={value}
              disabled={!bothArmed}
              aria-label={`Slide fully across to confirm: ${title}`}
              aria-valuetext={`${value} percent${bothArmed ? '' : ' — both keys required first'}`}
              onChange={(e) => armAndMaybeFire(Number(e.target.value))}
              onKeyUp={(e) => {
                // Keyboard users can drag with arrow keys; End jumps straight to 100 exactly like
                // a full mouse drag would, and is the only keyboard-native way to reach it.
                if (e.key === 'End') armAndMaybeFire(100)
              }}
            />
            <div
              className={`destgate__track-fill${value > 0 && value < 100 ? ' pulsing' : ''}`}
              style={{ width: `${value}%` }}
              aria-hidden
            />
            <div className="destgate__hint">
              {bothArmed
                ? 'Drag all the way to the right to authorize.'
                : 'Arm both keys above to unlock the slider.'}
            </div>
          </div>

          <div className="destgate__actions">
            <button type="button" className="destgate__exit" onClick={handleCancel}>
              Emergency exit
            </button>
            <span className="destgate__hint">{confirmLabel} requires both keys + full slide</span>
          </div>
        </>
      )}

      {completing && (
        <div className="destgate__complete" role="status" aria-live="assertive">
          <span aria-hidden>✓</span> Authorized — {confirmLabel.toLowerCase()}ing…
        </div>
      )}
    </div>
  )

  return createPortal(
    <div
      className={`destgate-overlay${anchor ? ' destgate-overlay--anchored' : ''}`}
      onClick={handleCancel}
    >
      {card}
    </div>,
    document.body
  )
}
