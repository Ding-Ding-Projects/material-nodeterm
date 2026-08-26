import { useEffect, useId, useRef, type HTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../cn'
import { useVocabularyMapper, type VocabularyTextMode } from '../../lib/personalVocabulary/useVocabularyText'

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
  vocabularyMode?: VocabularyTextMode
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
  vocabularyMode = 'authored',
  className,
  ...rest
}: DialogProps): React.JSX.Element | null {
  const vocab = useVocabularyMapper()
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const scrim = panelRef.current?.parentElement
    const hidden: Array<{ element: HTMLElement; ariaHidden: string | null; inert: boolean }> = []
    for (const node of Array.from(document.body.children)) {
      if (!(node instanceof HTMLElement) || node === scrim) continue
      hidden.push({ element: node, ariaHidden: node.getAttribute('aria-hidden'), inert: node.inert })
      node.setAttribute('aria-hidden', 'true')
      node.inert = true
    }
    return () => {
      for (const item of hidden) {
        if (item.ariaHidden === null) item.element.removeAttribute('aria-hidden')
        else item.element.setAttribute('aria-hidden', item.ariaHidden)
        item.element.inert = item.inert
      }
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

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      )
      if (focusable.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  if (open && !title && !rest['aria-label']) {
    throw new Error('Dialog requires a title or an explicit aria-label')
  }

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
        tabIndex={-1}
        className={cn('mdx-dialog', className)}
        {...rest}
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? (vocabularyMode === 'authored' ? vocab(rest['aria-label']) : rest['aria-label']) : undefined}
      >
        {icon}
        {title && <div id={titleId} className="mdx-dialog__title">{vocabularyMode === 'authored' && typeof title === 'string' ? vocab(title) : title}</div>}
        {vocabularyMode === 'authored' && typeof children === 'string' ? vocab(children) : children}
        {actions && <div className="mdx-dialog__actions">{actions}</div>}
      </div>
    </div>,
    document.body
  )
}
