import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../cn'
import { useVocabularyMapper, type VocabularyTextMode } from '../../lib/personalVocabulary/useVocabularyText'

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> { vocabularyMode?: VocabularyTextMode }

/**
 * Material Design 3 radio control backed by the native input.
 *
 * Keeping the native element preserves the browser's grouping, keyboard, form and assistive
 * technology behavior. The shared stylesheet owns only the visual track, selected dot, state
 * layer and focus ring.
 */
export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio({ className, vocabularyMode = 'authored', ...rest }, ref) {
  const vocab = useVocabularyMapper()
  return <input ref={ref} type="radio" className={cn('mdx-radio', className)} {...rest} aria-label={vocabularyMode === 'authored' ? vocab(rest['aria-label']) : rest['aria-label']} title={vocabularyMode === 'authored' ? vocab(rest.title) : rest.title} />
})


