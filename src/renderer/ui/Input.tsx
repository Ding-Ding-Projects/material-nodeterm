import { forwardRef, type InputHTMLAttributes } from 'react'
import './md3/primitives.css'
import { cn } from './cn'
import { useVocabularyMapper, type VocabularyTextMode } from '../lib/personalVocabulary/useVocabularyText'

/**
 * The app's dense text input, on Material Design 3's outlined-field anatomy
 * (`.mdx-input`, `ui/md3/primitives.css`) rather than the pre-MD3 `border-border` / `bg-bg`
 * literals it used to carry -- which is why fields read as generic next to the buttons.
 *
 * The full 56px floating-label field is `ui/md3/TextField`; reach for that in a dialog or any
 * standalone form. This stays 32px because its call sites are settings rows built around that
 * height, and it is the same M3 outlined field at a dense size, not a different control.
 */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { vocabularyMode?: VocabularyTextMode }>(
  function Input({ className, vocabularyMode = 'authored', ...rest }, ref) {
    const vocab = useVocabularyMapper()
    return (
      <input
        ref={ref}
        className={cn('mdx-input', className)}
        {...rest}
        aria-label={vocabularyMode === 'authored' ? vocab(rest['aria-label']) : rest['aria-label']}
        title={vocabularyMode === 'authored' ? vocab(rest.title) : rest.title}
      />
    )
  }
)
