import { useEffect, useId, useRef, useState } from 'react'
import { IconButton } from '../../ui/md3'
import { useI18n } from '../../lib/i18n'

export interface InfoGuideProps {
  /** The row's label, already through the vocabulary boundary. Names the guide. */
  label: string
  /** What the setting does, already through the vocabulary boundary. */
  description: string
}

/**
 * The per-control info button (@uh `info-icon-guidance`): a compact icon button that sits directly
 * above its control and opens a small anchored explanation of that one setting plus three guided
 * steps. It never changes a value. Enter/Space opens it, Escape or a press outside closes it, and
 * focus returns to the button on Escape so keyboard users land where they started.
 */
export function InfoGuide({ label, description }: InfoGuideProps) {
  const { ts } = useI18n()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      buttonRef.current?.focus()
    }
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (target && (panelRef.current?.contains(target) || buttonRef.current?.contains(target))) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointer, true)
    }
  }, [open])

  const name = ts('infoGuide.about', 'About this setting')
  return (
    <span className="md3-info-guide">
      <IconButton
        ref={buttonRef}
        size="compact"
        icon="info"
        vocabularyMode="factual"
        className="md3-info-guide__btn"
        aria-label={`${name}: ${label}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          className="md3-info-guide__panel"
          role="dialog"
          aria-label={`${name}: ${label}`}
          tabIndex={-1}
        >
          <strong className="md3-info-guide__title">{label}</strong>
          <p className="md3-info-guide__desc">{description}</p>
          <ol className="md3-info-guide__steps">
            <li>{ts('infoGuide.step1', 'Change it with the control just below this button.')}</li>
            <li>{ts('infoGuide.step2', 'There is no Save button: the change is kept automatically.')}</li>
            <li>{ts('infoGuide.step3', 'Changed your mind? Restore an earlier version from Settings → Local history.')}</li>
          </ol>
        </div>
      )}
    </span>
  )
}
