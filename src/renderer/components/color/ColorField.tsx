import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ColorPicker } from './ColorPicker'
import { useAnchoredPosition } from '@renderer/lib/appearance/useAnchoredPosition'
import { parseAnyColor, toHex } from '@renderer/lib/color/convert'
import { useVocabularyMapper } from '@renderer/lib/personalVocabulary/useVocabularyText'

/**
 * A labelled swatch that opens the full infinite `ColorPicker` in a small anchored popover — the
 * compact form every property row in the appearance editor uses, so the editor doesn't have to
 * show a full picker per colour property at once. The picker itself is still the real thing: this
 * is presentation, not a reduced/swatch-only substitute (docs/colour-picker.md).
 */
export function ColorField({
  label,
  value,
  onChange,
  onClear,
  against,
  allowAlpha = true
}: {
  label: string
  /** undefined = unset (shows a "not set" swatch); any parseable colour string otherwise. */
  value: string | undefined
  onChange: (next: string) => void
  onClear?: () => void
  against?: string
  allowAlpha?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const vocab = useVocabularyMapper()
  const anchorRef = useRef<HTMLButtonElement>(null)
  const pos = useAnchoredPosition(anchorRef.current, open)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (anchorRef.current?.contains(t) || pos.ref.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        anchorRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const parsed = value ? parseAnyColor(value) : null
  const swatchBg = parsed ? toHex(parsed, parsed.a < 1) : undefined

  return (
    <div className="color-field">
      <span className="color-field__label">{label}</span>
      <div className="color-field__controls">
        <button
          ref={anchorRef}
          type="button"
          className="color-field__swatch"
          style={swatchBg ? { background: swatchBg } : undefined}
          aria-label={vocab(`${label}: ${value ?? 'not set'} — open colour picker`)}
          onClick={() => setOpen((o) => !o)}
        >
          {!swatchBg && <span className="color-field__unset" aria-hidden="true" />}
        </button>
        <span className="color-field__value">{value ?? vocab('Not set — inherits the platform default')}</span>
        {onClear && value && (
          <button
            type="button"
            className="color-field__reset"
            title={vocab(`Reset ${label} to the platform default`)}
            aria-label={vocab(`Reset ${label}`)}
            onClick={onClear}
          >
            ↺
          </button>
        )}
      </div>
      {open &&
        createPortal(
          <div
            ref={pos.ref}
            className="color-field__popover"
            style={{ top: pos.top, left: pos.left }}
            role="dialog"
            aria-label={vocab(`${label} colour picker`)}
          >
            <ColorPicker
              label={label}
              value={value ?? '#ffffff'}
              onChange={onChange}
              against={against}
              allowAlpha={allowAlpha}
            />
          </div>,
          document.body
        )}
    </div>
  )
}
