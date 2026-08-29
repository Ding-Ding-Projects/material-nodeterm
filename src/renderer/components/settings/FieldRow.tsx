import type React from 'react'
import { useVocabularyTemplate, useVocabularyText } from '../../lib/personalVocabulary/useVocabularyText'
import { resolutionIncludes, useSettingsVocabularyResolution, type SettingsVocabularyResolution } from './context'
import { SettingsText, type SettingsTextSegment, validateSettingsCallsiteId } from './SettingsText'
import { useDebugValue } from 'react'

/** label (+ optional description, + optional highlighted note) on the left, a control on the right. */
export function FieldRow({
  label,
  labelSegments,
  description,
  descriptionSegments,
  descriptionParams,
  callsiteId,
  resolvedVocabulary,
  note,
  noteSegments,
  control,
  htmlFor
}: {
  label?: string
  labelSegments?: readonly SettingsTextSegment[]
  description?: string
  /** Mixed authored copy and exact runtime facts, kept as typed segments. */
  descriptionSegments?: readonly SettingsTextSegment[]
  /** Dynamic facts are interpolated only after the local prose vocabulary is applied. */
  descriptionParams?: Record<string, string>
  /** Stable source identifier for this exact settings copy boundary. */
  callsiteId?: string
  /** Set when the caller already resolved this prose through the shared local boundary. */
  resolvedVocabulary?: SettingsVocabularyResolution
  /** A caveat about the current value (e.g. "this setting can't take effect here") — same size as
   *  the description but in the warning accent, so it reads as a state, not as help text. */
  note?: string
  /** Mixed authored copy and exact current-value facts for warning/status notes. */
  noteSegments?: readonly SettingsTextSegment[]
  control: React.ReactNode
  htmlFor?: string
}): React.JSX.Element {
  const normalizedCallsiteId = validateSettingsCallsiteId(callsiteId)
  useDebugValue(normalizedCallsiteId ? `settings:${normalizedCallsiteId}` : undefined)
  // Personal-vocabulary boundary: every Settings label/description/note in the app funnels
  // through this one component, so this is where the substitution actually reaches users. Never
  // applied to `control` — that's live form widgets, not prose.
  const mappedLabel = useVocabularyText(label)
  const inheritedVocabularyResolution = useSettingsVocabularyResolution()
  const alreadyApplied = resolutionIncludes(resolvedVocabulary, 'row') || resolutionIncludes(inheritedVocabularyResolution, 'row')
  const vocabLabel = alreadyApplied ? label : mappedLabel
  const mappedDescription = useVocabularyTemplate(description, descriptionParams)
  const vocabDescription = alreadyApplied ? description : mappedDescription
  const mappedNote = useVocabularyText(note)
  const vocabNote = alreadyApplied ? note : mappedNote
  return (
    <div className="md3-settings-row">
      <div className="md3-settings-row__body">
        <label htmlFor={htmlFor} className="md3-settings-row__label">
          {labelSegments ? <SettingsText segments={labelSegments} /> : vocabLabel}
        </label>
        {descriptionSegments ? (
          <p className="md3-settings-row__desc"><SettingsText callsiteId={callsiteId} segments={descriptionSegments} /></p>
        ) : vocabDescription ? <p className="md3-settings-row__desc">{vocabDescription}</p> : null}
        {noteSegments ? (
          <p className="md3-settings-row__note"><SettingsText callsiteId={callsiteId} segments={noteSegments} /></p>
        ) : vocabNote ? <p className="md3-settings-row__note">{vocabNote}</p> : null}
      </div>
      <div className="md3-settings-row__control">{control}</div>
    </div>
  )
}
