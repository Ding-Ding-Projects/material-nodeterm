import { type ReactNode } from 'react'
import { cn } from '../cn'
import { useVocabularyMapper, type VocabularyTextMode } from '../../lib/personalVocabulary/useVocabularyText'

export interface FieldLabelProps {
  /** The visible label text. Runs through the vocabulary mapper unless `vocabularyMode` says otherwise. */
  label: string
  /** Explicit association. Omit it and wrap the control in `children` instead — a `<label>` that
   *  contains its control is associated implicitly, which is what the node bodies already relied on. */
  htmlFor?: string
  /** The control this labels. Wrapping is the default association, so this is the usual shape. */
  children?: ReactNode
  /** Helper text under the control, in the same on-surface-variant role the outlined field uses. */
  supportText?: string
  /** Row rather than column — for a label sitting beside its control (a checkbox, a switch). */
  inline?: boolean
  className?: string
  /** Marks the label/support strings as authored prose or exact facts. */
  vocabularyMode?: VocabularyTextMode
}

/**
 * The shared label for a dense control. It exists because there was no label primitive at all, so
 * every node body styled a bare `<label>` itself and each one re-decided the typography — which is
 * the whole reason those surfaces read as generic beside the outlined `TextField`, whose own
 * floating label is its notch and cannot be reused standalone.
 */
export function FieldLabel({
  label,
  htmlFor,
  children,
  supportText,
  inline = false,
  className,
  vocabularyMode = 'authored'
}: FieldLabelProps) {
  const vocab = useVocabularyMapper()
  const text = vocabularyMode === 'authored' ? vocab(label) : label
  return (
    <label className={cn('mdx-field-label', inline && 'mdx-field-label--inline', className)} htmlFor={htmlFor}>
      <span className="mdx-field-label__text">{text}</span>
      {children}
      {supportText && (
        <span className="mdx-field-label__support">
          {vocabularyMode === 'authored' ? vocab(supportText) : supportText}
        </span>
      )}
    </label>
  )
}
