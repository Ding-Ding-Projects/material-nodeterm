import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../cn'

export interface DialogProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  open: boolean
  onClose: () => void
  /** Icon tile shown above the title — the destructive-gate/settings-warning treatment
   *  (52px, r16, `error-container`). Wrap it in `mdx-dialog__icon` yourself for that exact
   *  recipe, or pass any element for a different tone. */
  icon?: ReactNode
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  /** @default true */
  closeOnScrimClick?: boolean
  /** @default true */
  closeOnEscape?: boolean
}

/**
 * A centered modal surface + scrim — r28 `surface-container-high`, matching the Overlays
 * prototype's destructive-gate/clone-dialog shape. Owns the portal, the scrim, Escape-to-close and
 * returning focus to whatever opened it, since that contract belongs to the dialog itself rather
 * than being reimplemented per caller.
 *
 * Deliberately self-contained rather than plugged into this app's existing `dialog-stack.ts` /
 * `confirm-key.ts` (the window-level Enter/Escape arbitration `ConfirmDialog`/
 * `DestructiveConfirmGate` already share, which is careful about not stealing a key meant for a
 * terminal or the command palette). A primitives lane shouldn't quietly become a second dialog
 * stack — a consumer that needs that shared stacking/Enter behavior should keep using
 * `ConfirmDialog` today; wiring this component into that stack is a follow-up for whichever lane
 * actually migrates a call site onto it.
 */
export function Dialog({
  open,
  onClose,
  icon,
  title,
  actions,
  children,
  closeOnScrimClick = true,
  closeOnEscape = true,
  className,
  ...rest
}: DialogProps): React.JSX.Element | null {
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => {
      returnFocusRef.current?.focus?.()
    }
  }, [open])

  useEffect(() => {
    if (!open || !closeOnEscape) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, closeOnEscape, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="mdx-dialog-scrim"
      onMouseDown={(e) => {
        if (closeOnScrimClick && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={cn('mdx-dialog', className)}
        {...rest}
      >
        {icon}
        {title && <div className="mdx-dialog__title">{title}</div>}
        {children}
        {actions && <div className="mdx-dialog__actions">{actions}</div>}
      </div>
    </div>,
    document.body
  )
}
