import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '../cn'
import { useVocabularyMapper, type VocabularyTextMode } from '../../lib/personalVocabulary/useVocabularyText'

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grows with its content instead of scrolling, up to `maxRows`. Off by default because a box
   *  that resizes while you type moves everything under it, which is wrong for a form and right
   *  for a comment field. */
  autoGrow?: boolean
  maxRows?: number
  vocabularyMode?: VocabularyTextMode
}

/**
 * Material Design 3 multi-line field -- the same outlined anatomy as `ui/Input`, sized for prose.
 *
 * Eleven files were hand-rolling a textarea before this existed, because the barrel had no
 * primitive for one. Each carried its own border, radius and focus treatment, so no two
 * multi-line fields in the app agreed on what a focused field looks like.
 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { autoGrow = false, maxRows = 12, className, onInput, style, vocabularyMode = 'authored', ...rest },
  ref
) {
  const vocab = useVocabularyMapper()
  return (
    <textarea
      ref={ref}
      className={cn('mdx-textarea', className)}
      style={autoGrow ? { ...style, maxHeight: `calc(${maxRows} * 1.5em + 24px)` } : style}
      onInput={(e) => {
        if (autoGrow) {
          const el = e.currentTarget
          // Reset first: without it the box can only ever grow, because scrollHeight of an
          // already-tall element never reports the smaller height its shorter content wants.
          el.style.height = 'auto'
          el.style.height = `${el.scrollHeight}px`
        }
        onInput?.(e)
      }}
      {...rest}
      aria-label={vocabularyMode === 'authored' ? vocab(rest['aria-label']) : rest['aria-label']}
      title={vocabularyMode === 'authored' ? vocab(rest.title) : rest.title}
    />
  )
})
