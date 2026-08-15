import { useMemo } from 'react'
import { usePersonalVocabulary } from '../../state/personalVocabulary'
import { useSchoolMode } from '../../state/schoolMode'
import { applyVocabulary } from './apply'

/**
 * The user-facing text boundary: pass any string the app is ABOUT TO SHOW a user (a label, a
 * description, a notification body) through this before rendering it, and it comes back with any
 * approved personal-vocabulary replacements applied — or completely unchanged, either because no
 * file has ever been uploaded, or because School mode is on (which makes this capability behave
 * as if it were not installed, per the shared School-mode contract).
 *
 * Never wrap a command, URL, identifier, code snippet, file path, or a factual external record
 * (a commit SHA, an error message straight from a tool) in this — those must stay verbatim; this
 * hook exists for prose labels and copy only.
 */
export function useVocabularyText<T extends string | undefined>(text: T): T {
  const entries = usePersonalVocabulary((s) => s.entries)
  const schoolModeEnabled = useSchoolMode((s) => s.enabled)
  return useMemo(() => {
    if (text === undefined) return text
    if (schoolModeEnabled) return text
    return applyVocabulary(text, entries) as T
  }, [text, entries, schoolModeEnabled])
}
