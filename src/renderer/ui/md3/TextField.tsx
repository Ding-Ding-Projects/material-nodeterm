import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../cn'
import { useVocabularyMapper, type VocabularyTextMode } from '../../lib/personalVocabulary/useVocabularyText'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  /** Floating label — sits notched into the outline's top edge (measured off the Clone dialog
   *  prototype: 56px tall, r16, 1px `--md-outline`). */
  label: string
  /** Icon shown before the value, inside the outline. */
  leadingIcon?: ReactNode
  /** Content anchored to the trailing edge, inside the outline — "the slot every search field's
   *  `.*` regex chip goes in" per the component brief. Also where a Browse/Clear action lives. */
  trailingSlot?: ReactNode
  /** Helper/error text under the field. Rendered in `--md-error` when `invalid` is set. */
  supportText?: string
  invalid?: boolean
  /** Wrapper className — the input itself has no class escape hatch, since its layout is fixed
   *  by the outline it sits inside. */
  className?: string
  /** Marks standard accessible/title strings as authored prose or exact facts. */
  vocabularyMode?: VocabularyTextMode
}

/**
 * Outlined MD3 text field with a floating label. The label's notch is a solid patch painted over
 * the outline (see `ui/md3/primitives.css`'s `--mdx-field-surface` for why that has to be told
 * the field's ambient surface rather than guessed).
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, leadingIcon, trailingSlot, supportText, invalid = false, className, id, disabled, onFocus, onBlur, vocabularyMode = 'authored', ...rest },
  ref
) {
  const vocab = useVocabularyMapper()
  const generatedId = useId()
  const inputId = id ?? generatedId
  const [focused, setFocused] = useState(false)
  return (
    <div
      className={cn(
        'mdx-field',
        focused && 'mdx-field--focused',
        invalid && 'mdx-field--invalid',
        disabled && 'mdx-field--disabled',
        className
      )}
    >
      <label className="mdx-field__label" htmlFor={inputId}>
        {vocabularyMode === 'authored' ? vocab(label) : label}
      </label>
      <div className="mdx-field__control">
        {leadingIcon}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className="mdx-field__input"
          onFocus={(e) => {
            setFocused(true)
            onFocus?.(e)
          }}
          onBlur={(e) => {
            setFocused(false)
            onBlur?.(e)
          }}
          {...rest}
          aria-label={vocabularyMode === 'authored' ? vocab(rest['aria-label']) : rest['aria-label']}
          title={vocabularyMode === 'authored' ? vocab(rest.title) : rest.title}
          placeholder={vocabularyMode === 'authored' ? vocab(rest.placeholder) : rest.placeholder}
        />
        {trailingSlot && <div className="mdx-field__trailing">{trailingSlot}</div>}
      </div>
      {supportText && <div className="mdx-field__support">{vocabularyMode === 'authored' ? vocab(supportText) : supportText}</div>}
    </div>
  )
})
