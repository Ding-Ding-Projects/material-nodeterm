import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../cn'

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Filter-chip selected state — filled `secondary-container`, no border. Omit for a plain
   *  assist chip (outlined, never filled). */
  selected?: boolean
  icon?: ReactNode
}

/**
 * A generic assist/filter chip — 32px, r8, matching the Board filter row and the kanban
 * session-id chip (`design/v2/MD3 Board.dc.html`). For the tone-mapped RUNNING/NEEDS-YOU/…
 * agent-status pill, see `StatusChip` instead — different shape, different job.
 */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected = false, icon, className, children, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={rest.onClick ? selected : undefined}
      className={cn('mdx-chip', selected && 'mdx-chip--selected', className)}
      {...rest}
    >
      {icon && <span className="mdx-chip__icon">{icon}</span>}
      {children}
    </button>
  )
})
