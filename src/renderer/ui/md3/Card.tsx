import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '../cn'

export type CardTone =
  | 'container'
  | 'container-lowest'
  | 'container-low'
  | 'container-high'
  | 'container-highest'
  | 'outlined'
export type CardShape = 'xs' | 'sm' | 'md' | 'lg'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** @default 'container' */
  tone?: CardTone
  /** @default 'sm' — r16, matching the kanban session card ("Card r16 surface-container-high
   *  (hover -highest)" — HANDOFF). Use `'lg'` (r24) for the kanban column shape. */
  shape?: CardShape
  /** Hover/focus affordance for a card that is itself a click target (a session card, a settings
   *  list-card row). Purely visual — wrap in a real `<button>`/`role="button"` for the a11y
   *  contract; this prop does not add one, since some interactive cards are `<a>` or already
   *  carry their own semantics. */
  interactive?: boolean
}

/**
 * A generic tonal surface container — the shape shared by kanban cards/columns, dialog inner
 * panels and settings list-cards throughout the design bundle. Not the composite "node card"
 * (header + body + context meter) HANDOFF describes for canvas terminal nodes — that stays a
 * feature-owned component; this is the plain surface underneath it.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { tone = 'container', shape = 'sm', interactive = false, className, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        'mdx-card',
        tone !== 'container' && `mdx-card--tone-${tone}`,
        shape !== 'sm' && `mdx-card--shape-${shape}`,
        interactive && 'mdx-card--interactive',
        className
      )}
      {...rest}
    />
  )
})
