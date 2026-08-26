import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../cn'

export interface NumberFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {}

/** Numeric variant of the dense outlined field. */
export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  { className, ...rest },
  ref
) {
  return <input ref={ref} type="number" className={cn('mdx-input mdx-number-field', className)} {...rest} />
})
