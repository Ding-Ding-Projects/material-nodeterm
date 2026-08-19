import { useEffect, useRef, useState } from 'react'

/**
 * The grown-up PIN keypad — 84px keys, r28, matching `MD3 Kids Mode.dc.html`'s
 * `gateKeys`/`gateDots` layout exactly (3-column grid: 1‑9, blank, 0, ⌫; four dots above).
 *
 * Kids-mode PINs are exactly `length` digits (default 4), enforced both here and at the two
 * places a PIN is CHOSEN (`KidsModeSection.tsx`'s Settings fields and `EnableKidsModeDialog.tsx`).
 * That is a deliberate constraint, not an oversight: the pad only has digit keys, so a PIN
 * containing a letter — or a different length — set some other way could never be typed back in
 * here, and the grown-up screen would become unreachable without deleting the shared kids-mode
 * folder. Fixing the length at the one place it is entered means it can never drift from the one
 * place it is typed.
 *
 * Purely presentational plus its own digit buffer: it never talks to IPC itself. The caller
 * decides what a completed PIN means (verify, or "choose a new one") via `onComplete`.
 */
export function PinPad({
  length = 4,
  onComplete,
  /** Flip briefly (a new object identity per attempt is enough) after a wrong PIN — clears the
   *  buffer and shows the shake. */
  errorToken,
  disabled = false,
  ariaLabel
}: {
  length?: number
  onComplete: (pin: string) => void
  errorToken?: unknown
  disabled?: boolean
  ariaLabel: string
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [shaking, setShaking] = useState(false)
  const lastErrorToken = useRef(errorToken)

  useEffect(() => {
    if (errorToken === undefined || errorToken === lastErrorToken.current) return
    lastErrorToken.current = errorToken
    setValue('')
    setShaking(true)
    const t = setTimeout(() => setShaking(false), 420)
    return () => clearTimeout(t)
  }, [errorToken])

  const push = (d: string) => {
    if (disabled) return
    setValue((v) => {
      if (v.length >= length) return v
      const next = v + d
      if (next.length === length) {
        // Let the last dot paint before handing the completed PIN to the caller.
        window.setTimeout(() => onComplete(next), 60)
      }
      return next
    })
  }
  const backspace = () => !disabled && setValue((v) => v.slice(0, -1))

  // Keyboard support: digits and Backspace work the same as tapping the pad. Skipped while some
  // OTHER real text control has focus (an input/textarea/contenteditable elsewhere on the page) —
  // this pad's own keys are plain buttons a kid mostly clicks rather than tabs to, and a bare
  // `window` listener with no such guard would steal a digit meant for a focused field in whatever
  // dialog was open when `EnableKidsModeDialogHost` (reachable from the ordinary dev canvas, where
  // other dialogs can coexist) happened to be triggered.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return
      const active = document.activeElement
      const editing =
        active instanceof HTMLElement &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
      if (editing) return
      if (e.key >= '0' && e.key <= '9') push(e.key)
      else if (e.key === 'Backspace') backspace()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, length])

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']

  return (
    <div className="md3-kids-pinpad" role="group" aria-label={ariaLabel}>
      <div className="md3-kids-pinpad__dots" aria-hidden="true">
        {Array.from({ length }).map((_, i) => (
          <span
            key={i}
            className={
              'md3-kids-pinpad__dot' + (i < value.length ? ' md3-kids-pinpad__dot--filled' : '') +
              (shaking ? ' md3-kids-pinpad__dot--shake' : '')
            }
          />
        ))}
      </div>
      <div className="md3-kids-pinpad__grid">
        {keys.map((k, i) =>
          k === '' ? (
            <span key={i} className="md3-kids-pinpad__key md3-kids-pinpad__key--blank" aria-hidden="true" />
          ) : (
            <button
              key={i}
              type="button"
              className={
                'md3-kids-pinpad__key' + (k === '⌫' ? ' md3-kids-pinpad__key--back' : '')
              }
              disabled={disabled}
              onClick={() => (k === '⌫' ? backspace() : push(k))}
              aria-label={k === '⌫' ? 'Backspace' : `Digit ${k}`}
            >
              {k}
            </button>
          )
        )}
      </div>
    </div>
  )
}
