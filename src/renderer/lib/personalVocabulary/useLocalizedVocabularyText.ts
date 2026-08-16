import { useCallback } from 'react'
import { formatText } from '@shared/i18n'
import { useI18n } from '../i18n'
import { usePersonalVocabulary } from '../../state/personalVocabulary'
import { useSchoolMode } from '../../state/schoolMode'
import { applyVocabulary } from './apply'

/**
 * Resolve shipped UI prose through the active language/funny-level catalog and then through the
 * local personal-vocabulary boundary. Dynamic facts such as executable paths, profile ids,
 * detected distro names, and host error strings must stay outside this helper and be interpolated
 * only after the surrounding prose has been resolved.
 */
export function useLocalizedVocabularyText(): (
  id: string,
  fallback: string,
  params?: Record<string, string>
) => string {
  const { ts } = useI18n()
  const entries = usePersonalVocabulary((state) => state.entries)
  const schoolModeEnabled = useSchoolMode((state) => state.enabled)

  return useCallback(
    (id: string, fallback: string, params?: Record<string, string>): string => {
      const localized = ts(id, fallback)
      const prose = schoolModeEnabled ? localized : applyVocabulary(localized, entries)
      // Substitute dynamic facts last: a personal-vocabulary entry must never rewrite a detected
      // distro name, host error, executable path, or other verbatim value passed as a parameter.
      return params ? formatText(prose, params) : prose
    },
    [entries, schoolModeEnabled, ts]
  )
}
