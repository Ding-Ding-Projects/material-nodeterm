import type React from 'react'
import { useVocabularyText } from '../../lib/personalVocabulary/useVocabularyText'

/** label (+ optional description, + optional highlighted note) on the left, a control on the right. */
export function FieldRow({
  label,
  description,
  note,
  control,
  htmlFor
}: {
  label: string
  description?: string
  /** A caveat about the current value (e.g. "this setting can't take effect here") — same size as
   *  the description but in the warning accent, so it reads as a state, not as help text. */
  note?: string
  control: React.ReactNode
  htmlFor?: string
}): React.JSX.Element {
  // Personal-vocabulary boundary: every Settings label/description/note in the app funnels
  // through this one component, so this is where the substitution actually reaches users. Never
  // applied to `control` — that's live form widgets, not prose.
  const vocabLabel = useVocabularyText(label)
  const vocabDescription = useVocabularyText(description)
  const vocabNote = useVocabularyText(note)
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-text">
          {vocabLabel}
        </label>
        {vocabDescription ? (
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{vocabDescription}</p>
        ) : null}
        {vocabNote ? (
          <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--warn)]">{vocabNote}</p>
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}
