import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../cn'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Numeric/short label content. Omit for a plain dot indicator (`dot`). */
  children?: ReactNode
  /** A minimal 8px dot instead of a labelled pill — an unread marker with no count. */
  dot?: boolean
  /** Absolutely positions the badge over a `position: relative` ancestor's top-right corner —
   *  the app-bar notification bell's own placement. */
  corner?: boolean
  /** @default false — `--md-error`/`--md-on-error` (the app's convention for an unread/alert
   *  count). Set for a quieter `surface-container-highest` tone (a plain count, nothing wrong). */
  neutral?: boolean
}

/**
 * A small numeric or dot indicator, matching the app bar's `.notif-bell__badge` (min-width 16px,
 * r8, `--md-error`/`--md-on-error`).
 */
export function Badge({ dot = false, corner = false, neutral = false, className, children, ...rest }: BadgeProps): React.JSX.Element {
  return (
    <span
      className={cn('mdx-badge', dot && 'mdx-badge--dot', corner && 'mdx-badge--corner', neutral && 'mdx-badge--neutral', className)}
      {...rest}
    >
      {!dot && children}
    </span>
  )
}
