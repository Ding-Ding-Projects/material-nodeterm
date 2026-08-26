import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { MaterialSymbol, type MaterialSymbolName } from '../../components/MaterialSymbol'
import { cn } from '../cn'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'

export interface FabProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  'aria-label': string
  icon?: MaterialSymbolName
  children?: React.ReactNode
  /** Rotates the glyph 45° — the FAB's own "now showing its menu" tell (`.md3-fab.is-open`, used
   *  today by `components/FabMenu.tsx`'s node-creation FAB). */
  open?: boolean
  /** @default 'default' — 56px, r16, `primary-container` (HANDOFF's literal FAB recipe).
   *  `'small'` is the 40px M3 also defines. */
  size?: 'default' | 'small'
}

/**
 * Floating action button. Reuses `.md3-fab` from `styles.md3.css` verbatim — already exactly the
 * HANDOFF recipe (56px, r16, `--md-primary-container`) as shipped for the nav rail's node-creation
 * FAB.
 */
export const Fab = forwardRef<HTMLButtonElement, FabProps>(function Fab(
  { icon, children, open = false, size = 'default', className, type = 'button', ...rest },
  ref
) {
  const vocab = useVocabularyMapper()
  return (
    <button
      ref={ref}
      type={type}
      className={cn('md3-fab', size === 'small' && 'mdx-fab--small', open && 'is-open', className)}
      {...rest}
      aria-label={vocab(rest['aria-label'])}
      title={vocab(rest.title)}
    >
      {icon ? <MaterialSymbol name={icon} size={size === 'small' ? 20 : 26} /> : children}
    </button>
  )
})
