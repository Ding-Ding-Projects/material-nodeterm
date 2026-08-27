import { cn } from '../cn'

export interface ProgressProps {
  /** A finite value makes the bar determinate. `null` or `undefined` keeps it indeterminate. */
  value?: number | null
  min?: number
  max?: number
  label?: string
  className?: string
  barClassName?: string
}

/**
 * A tokenized linear progress indicator for long operations.
 *
 * The ARIA progressbar lives on the same element that paints the track. Indeterminate progress
 * omits `aria-valuenow`, while determinate progress clamps the exposed value to the declared
 * range. The label is required by callers that cannot provide an adjacent visible description.
 */
export function Progress({
  value = null,
  min = 0,
  max = 100,
  label = 'Progress',
  className,
  barClassName
}: ProgressProps): React.JSX.Element {
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : null
  const bounded = numericValue === null || max <= min ? null : Math.min(max, Math.max(min, numericValue))
  const determinate = bounded !== null
  const pct = bounded === null ? null : ((bounded - min) / (max - min)) * 100

  return (
    <div
      className={cn('mdx-progress', pct === null && 'mdx-progress--indeterminate', className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={determinate ? min : undefined}
      aria-valuemax={determinate ? max : undefined}
      aria-valuenow={bounded === null ? undefined : bounded}
    >
      <div
        className={cn('mdx-progress__bar', barClassName)}
        style={pct === null ? undefined : { width: `${pct}%` }}
      />
    </div>
  )
}


