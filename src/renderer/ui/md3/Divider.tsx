import { cn } from '../cn'

export interface DividerProps {
  /** @default 'horizontal' */
  orientation?: 'horizontal' | 'vertical'
  className?: string
}

/** A 1px `--md-outline-variant` hairline — the rule between the command palette's search head
 *  and its results, or between segments in a toolbar. */
export function Divider({ orientation = 'horizontal', className }: DividerProps): React.JSX.Element {
  return (
    <hr
      className={cn('mdx-divider', `mdx-divider--${orientation}`, className)}
      aria-orientation={orientation}
    />
  )
}
