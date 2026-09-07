import { useCallback } from 'react'
import { useI18n } from '../i18n'

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

  return useCallback(
    (id: string, fallback: string, params?: Record<string, string>): string => {
      // `useI18n().ts()` resolves and maps the prose template before interpolation. Dynamic facts
      // such as paths, ids, detected names and tool errors therefore remain exact.
      return ts(id, fallback, params)
    },
    [ts]
  )
}

/**
 * Resolve authored, localized copy for a durable record that will cross the personal-vocabulary
 * boundary only when it is rendered. Storing mapped display copy would make a later vocabulary
 * change impossible to apply correctly and risks mapping it twice in a toast or history view.
 */
export function useLocalizedCopy(): (
  id: string,
  fallback: string,
  params?: Record<string, string>
) => string {
  const { tsUnmapped } = useI18n()
  return useCallback(
    (id: string, fallback: string, params?: Record<string, string>): string => tsUnmapped(id, fallback, params),
    [tsUnmapped]
  )
}
