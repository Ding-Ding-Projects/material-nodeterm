import { Children, forwardRef, isValidElement, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../cn'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import type { VocabularyTextMode } from '../../lib/personalVocabulary/useVocabularyText'

export interface ListRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Leading icon tile (40px, r12, `surface-container-highest`) — pass a `<MaterialSymbol/>` or
   *  any small element. Omit for a row with no leading tile (a plain menu item). */
  icon?: ReactNode
  label: ReactNode
  sub?: ReactNode
  /** Trailing content — a `kbd` shortcut chip is common enough to get its own convenience prop;
   *  anything else (a switch, a chevron, a count) goes through `trailing`. */
  kbd?: string
  /** Non-interactive trailing decoration only. Interactive actions must be rendered as siblings
   *  by the caller because a button cannot contain another button, input, or link. */
  trailing?: ReactNode
  /** The row's one destructive action (a delete/remove entry in a context menu) — error-tinted
   *  icon tile and text, per the Overlays prototype's "destructive row in error red" contract. */
  danger?: boolean
  vocabularyMode?: VocabularyTextMode
}

/**
 * The row shape shared by menu items, command-palette results and settings list rows: a leading
 * icon tile, a label/sub-label stack, and trailing content. Radius sits inside HANDOFF's stated
 * "rows r14-20" range for menu/dialog surfaces (`ui/md3/primitives.css`).
 */
export const ListRow = forwardRef<HTMLButtonElement, ListRowProps>(function ListRow(
  { icon, label, sub, kbd, trailing, danger = false, className, type = 'button', vocabularyMode = 'authored', ...rest },
  ref
) {
  const vocab = useVocabularyMapper()
  const trailingIsInteractive = Children.toArray(trailing).some((child) => {
    if (!isValidElement(child)) return false
    if (typeof child.type === 'string' && ['a', 'button', 'input', 'select', 'textarea'].includes(child.type)) return true
    const props = child.props as { onClick?: unknown; tabIndex?: number; role?: string }
    return Boolean(props.onClick || props.tabIndex != null || props.role === 'button')
  })
  if (trailingIsInteractive) {
    throw new Error('ListRow trailing content must be non-interactive; render actions beside the row button')
  }
  return (
    <button
      ref={ref}
      type={type}
      className={cn('mdx-row', danger && 'mdx-row--danger', className)}
      {...rest}
    >
      {icon && <span className="mdx-row__icon">{icon}</span>}
      <span className="mdx-row__body">
        <span className="mdx-row__label">{vocabularyMode === 'authored' && typeof label === 'string' ? vocab(label) : label}</span>
        {sub && <span className="mdx-row__sub">{vocabularyMode === 'authored' && typeof sub === 'string' ? vocab(sub) : sub}</span>}
      </span>
      {(kbd || trailing) && (
        <span className="mdx-row__trailing">
          {trailing}
          {kbd && <span className="mdx-row__kbd">{kbd}</span>}
        </span>
      )}
    </button>
  )
})
