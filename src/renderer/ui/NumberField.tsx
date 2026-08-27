import { forwardRef, type InputHTMLAttributes } from 'react'
import './md3/primitives.css'
import { cn } from './cn'

/**
 * Dense numeric field on the shared Material Design 3 outlined-field recipe.
 *
 * This used to be the one shared field that still emitted Tailwind utility classes and legacy
 * palette names. That made settings that happened to use a number look different from their
 * neighbouring text/select fields, and its focus state did not use the same primary state layer.
 * Keep the small value-oriented API for existing settings rows, but make its rendered control the
 * same native, keyboard-accessible input recipe as `ui/Input`.
 */
export const NumberField = forwardRef<HTMLInputElement, {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  className?: string
  disabled?: boolean
  ariaLabel?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'className'>>(
  function NumberField({ value, onChange, min, max, step, className, disabled, ariaLabel, ...rest }, ref) {
  function NumberField({
    value,
    onChange,
    min,
    max,
    step,
    className,
    disabled,
    ariaLabel,
    ...rest
  }, ref): React.JSX.Element {
    return (
      <input
        ref={ref}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn('mdx-input mdx-number-field', className)}
        {...rest}
      />
    )
  }
)
