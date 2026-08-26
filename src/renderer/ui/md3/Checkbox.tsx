import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../cn'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Renders the indeterminate ("some but not all") state. Native `indeterminate` is a DOM
   *  property rather than an attribute, so React cannot set it from JSX; this drives the visual
   *  and sets `aria-checked="mixed"`, which is what assistive technology actually reads. */
  indeterminate?: boolean
}

/**
 * Material Design 3 checkbox.
 *
 * Like `Slider`, this paints the native input rather than rebuilding it from a `div`. The native
 * element carries the label association, the space-to-toggle keyboard model, the `checkbox` role
 * and its checked-state announcements, and form participation. A rebuilt one has to reimplement
 * every one of those and usually reimplements some of them wrongly.
 *
 * Twelve files were hand-rolling a checkbox before this existed, because the barrel had no
 * primitive for one -- there was nothing to adopt.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { indeterminate = false, className, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-checked={indeterminate ? 'mixed' : undefined}
      className={cn('mdx-checkbox', indeterminate && 'mdx-checkbox--indeterminate', className)}
      {...rest}
    />
  )
})
