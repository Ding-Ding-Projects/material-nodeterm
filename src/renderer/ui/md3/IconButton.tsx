import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { MaterialSymbol, type MaterialSymbolName } from '../../components/MaterialSymbol'
import { cn } from '../cn'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required — an icon-only control's accessible name has nowhere else to come from. */
  'aria-label': string
  /** Convenience: renders a bundled Material Symbol at the button's own icon size. Omit and pass
   *  `children` instead for anything else (a mascot sprite, a spinner, a custom SVG). */
  icon?: MaterialSymbolName
  /** Renders the icon filled (`FILL` 1) — the design's emphasis treatment for a selected/active
   *  destination or toggle. */
  filled?: boolean
  children?: React.ReactNode
  /** Selected/pressed visual state (a toggle that is currently on). */
  active?: boolean
  /** @default 'standard' — 44px, the shared `.md3-icon-btn` recipe ("every app-bar action").
   *  `'dense'` is 40px, for a tighter row. */
  size?: 'standard' | 'dense'
}

/**
 * A round icon-only button. Reuses `.md3-icon-btn` from `styles.md3.css` verbatim — that class is
 * already exactly this recipe ("Shared 44px round icon button — every app-bar action") — rather
 * than duplicating it under a new name.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, filled = false, active = false, size = 'standard', className, children, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn('md3-icon-btn', size === 'dense' && 'mdx-icon-btn--dense', active && 'is-active', className)}
      {...rest}
    >
      {icon ? <MaterialSymbol name={icon} size={size === 'dense' ? 18 : 20} fill={filled} /> : children}
    </button>
  )
})
