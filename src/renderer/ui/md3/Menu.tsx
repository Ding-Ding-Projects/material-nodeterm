import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '../cn'

export interface MenuProps extends HTMLAttributes<HTMLDivElement> {
  /** @default false — r28 `surface-container-high` (HANDOFF's "Menu surface r28
   *  surface-container-high"), matching the command-palette panel. Set for the tighter r20 shape
   *  a compact context menu uses instead (measured off the Overlays prototype's context menu). */
  compact?: boolean
}

/**
 * The tonal floating-menu surface — `surface-container-high`, r28 by default. Deliberately owns
 * no positioning: anchoring, portal mounting and viewport clamping stay with the consumer (see
 * `ui/AnchoredPopover.tsx`, which every existing menu/palette in this app already uses for that).
 * This component is the panel's chrome only, so it composes with that positioning rather than
 * duplicating it.
 */
export const Menu = forwardRef<HTMLDivElement, MenuProps>(function Menu({ compact = false, className, role = 'menu', ...rest }, ref) {
  return <div ref={ref} role={role} className={cn('mdx-menu', compact && 'mdx-menu--compact', className)} {...rest} />
})
