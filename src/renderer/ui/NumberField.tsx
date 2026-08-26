import { forwardRef, type InputHTMLAttributes } from 'react'
import './md3/primitives.css'
import { cn } from './cn'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

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
    const vocab = useVocabularyMapper()
    return (
      <input
        ref={ref}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={vocab(ariaLabel)}
        title={vocab(rest.title)}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn('mdx-input mdx-number-field', className)}
        {...rest}
      />
    )
  }
)
