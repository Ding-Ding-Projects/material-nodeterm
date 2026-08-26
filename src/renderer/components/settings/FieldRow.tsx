import type React from 'react'
import { useVocabularyTemplate, useVocabularyText } from '../../lib/personalVocabulary/useVocabularyText'

/** label (+ optional description, + optional highlighted note) on the left, a control on the right. */
export function FieldRow({
  label,
  description,
  descriptionParams,
  vocabularyApplied = false,
  note,
  control,
  htmlFor
}: {
  label: string
  description?: string
  /** Dynamic facts are interpolated only after the local prose vocabulary is applied. */
  descriptionParams?: Record<string, string>
  /** Set when the caller already resolved this prose through the shared local boundary. */
  vocabularyApplied?: boolean
  /** A caveat about the current value (e.g. "this setting can't take effect here") — same size as
   *  the description but in the warning accent, so it reads as a state, not as help text. */
  note?: string
  control: React.ReactNode
  htmlFor?: string
}): React.JSX.Element {
  // Personal-vocabulary boundary: every Settings label/description/note in the app funnels
  // through this one component, so this is where the substitution actually reaches users. Never
  // applied to `control` — that's live form widgets, not prose.
  const mappedLabel = useVocabularyText(label)
  const vocabLabel = vocabularyApplied ? label : mappedLabel
  const mappedDescription = useVocabularyTemplate(description, descriptionParams)
  const vocabDescription = vocabularyApplied ? description : mappedDescription
  const mappedNote = useVocabularyText(note)
  const vocabNote = vocabularyApplied ? note : mappedNote
  return (
    <div className="md3-settings-row">
      <div className="md3-settings-row__body">
        <label htmlFor={htmlFor} className="md3-settings-row__label">
          {vocabLabel}
        </label>
        {vocabDescription ? <p className="md3-settings-row__desc">{vocabDescription}</p> : null}
        {vocabNote ? <p className="md3-settings-row__note">{vocabNote}</p> : null}
      </div>
      <div className="md3-settings-row__control">{control}</div>
    </div>
  )
}
