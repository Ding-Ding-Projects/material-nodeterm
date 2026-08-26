import { useCallback, useMemo } from 'react'
import { usePersonalVocabulary } from '../../state/personalVocabulary'
import { useSchoolMode } from '../../state/schoolMode'
import { applyVocabulary, applyVocabularyToTemplate } from './apply'
import { schoolModeAllowsOptionalFeatures } from '../schoolModePolicy'

/**
 * The mapper behind every personal-vocabulary boundary in the renderer: one stable callback that
 * rewrites a single user-facing string, or returns it untouched when the capability is not in
 * effect (no file uploaded, or School mode — which must make this behave as if it were not
 * installed, per the shared School-mode contract; unknown hydration is fail-closed).
 *
 * Prefer this over calling `useVocabularyText` once per string: a component with a dozen labels
 * would otherwise need a dozen hooks in a fixed order, which is exactly the shape that breaks the
 * moment one of them becomes conditional.
 *
 * Never map a command, shell text bound for a pty, URL, file path, identifier, code, log line,
 * quoted tool output, settings key, or anything about to be written to disk or a public record.
 * A string that is both DISPLAYED and EXECUTED stays verbatim — the replacement exists to change
 * what a person reads, never what the machine runs.
 */
export function useVocabularyMapper(): <T extends string | undefined | null>(text: T) => T {
  const entries = usePersonalVocabulary((s) => s.entries)
  const schoolModeEnabled = useSchoolMode((s) => s.enabled)
  const schoolModeHydrated = useSchoolMode((s) => s.hydrated)
  const vocabularyAllowed = schoolModeAllowsOptionalFeatures({
    enabled: schoolModeEnabled,
    hydrated: schoolModeHydrated
  })
  return useCallback(
    <T extends string | undefined | null>(text: T): T => {
      if (typeof text !== 'string') return text
      if (!vocabularyAllowed) return text
      return applyVocabulary(text, entries) as T
    },
    [entries, vocabularyAllowed]
  )
}

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
  const map = useVocabularyMapper()
  return useMemo(() => map(text), [map, text])
}

/** Map a prose template while inserting dynamic facts verbatim after mapping. */
export function useVocabularyTemplate(
  text: string | undefined,
  params?: Record<string, string>
): string | undefined {
  const entries = usePersonalVocabulary((s) => s.entries)
  const schoolModeEnabled = useSchoolMode((s) => s.enabled)
  const schoolModeHydrated = useSchoolMode((s) => s.hydrated)
  const vocabularyAllowed = schoolModeAllowsOptionalFeatures({
    enabled: schoolModeEnabled,
    hydrated: schoolModeHydrated
  })
  return useMemo(() => {
    if (text == null || !vocabularyAllowed) return text
    return applyVocabularyToTemplate(text, entries, params)
  }, [entries, params, text, vocabularyAllowed])
}
