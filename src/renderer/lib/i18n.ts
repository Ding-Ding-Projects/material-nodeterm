import { useCallback, useMemo } from 'react'
import { useSettings } from '../state/settings'
import {
  formatText,
  normalizeLanguageMode,
  t as resolveText,
  ts as resolveString,
  type FunnyLevels,
  type LanguageMode,
  type LocalizedText
} from '@shared/i18n'
import { useSchoolMode } from '../state/schoolMode'
import { schoolModeAllowsOptionalFeatures } from './schoolModePolicy'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { applyVocabularyToTemplate } from './personalVocabulary/apply'

/**
 * Renderer-side binding of the pure `@shared/i18n` resolver to the live `languageMode` /
 * `funnyLevelEn` / `funnyLevelYue` settings. Applies LIVE: it reads straight off the zustand
 * settings store, so a slider move re-renders every subscriber immediately, with no restart.
 *
 * `t(id, fallback)` returns `{ primary, secondary }` for surfaces that can render a stacked
 * primary + compact secondary line (bilingual mode). `ts(id, fallback)` joins the two into one
 * line ("English · 廣東話") for a button label, aria-label, or window title that can't stack.
 * Both functions apply the local vocabulary to prose before any supplied dynamic facts are
 * interpolated. School mode suppresses that optional mapping while preserving exact facts.
 * `emoji(char)` returns the given emoji when the user has opted into dialog decoration, else ''
 * — never call it for a button/label/control string (see docs/language-modes.md).
 */
export function useI18n(): {
  mode: LanguageMode
  funnyLevelEn: number
  funnyLevelYue: number
  showEmojiInDialogs: boolean
  t: (id: string, fallback: string, params?: Record<string, string>) => LocalizedText
  ts: (id: string, fallback: string, params?: Record<string, string>) => string
  /** Non-semantic decoration only — never for button/label/control text. Empty string when the
   *  toggle is off, so `` `${emoji('🗑️')} Delete this file` `` degrades cleanly either way. */
  emoji: (e: string) => string
} {
  const configuredMode = useSettings((s) => s.settings.languageMode)
  const funnyLevelEn = useSettings((s) => s.settings.funnyLevelEn)
  const funnyLevelYue = useSettings((s) => s.settings.funnyLevelYue)
  const showEmojiInDialogs = useSettings((s) => s.settings.showEmojiInDialogs)
  const schoolModeHydrated = useSchoolMode((s) => s.hydrated)
  const schoolModeEnabled = useSchoolMode((s) => s.enabled)
  const vocabularyEntries = usePersonalVocabulary((s) => s.entries)
  const languageFeaturesAllowed = schoolModeAllowsOptionalFeatures({
    hydrated: schoolModeHydrated,
    enabled: schoolModeEnabled
  })

  // Preserve the user's configured mode/levels in settings; School mode only suppresses them.
  // Unknown hydration is fail-closed, and a hand-edited invalid mode is English rather than an
  // `undefined` resolver result. Level 1 is the documented plain/professional voice.
  const mode: LanguageMode = languageFeaturesAllowed ? normalizeLanguageMode(configuredMode) : 'en'
  const effectiveFunnyLevelEn = languageFeaturesAllowed ? funnyLevelEn : 1
  const effectiveFunnyLevelYue = languageFeaturesAllowed ? funnyLevelYue : 1

  const levels: FunnyLevels = useMemo(
    () => ({ en: effectiveFunnyLevelEn, yue: effectiveFunnyLevelYue }),
    [effectiveFunnyLevelEn, effectiveFunnyLevelYue]
  )

  const t = useCallback(
    (id: string, fallback: string, params?: Record<string, string>): LocalizedText => {
      const resolved = resolveText(id, fallback, mode, levels)
      if (!languageFeaturesAllowed) {
        // School mode suppresses the optional vocabulary and bilingual variant, but it does not
        // erase factual placeholders. The same dynamic values still need to render exactly.
        return params
          ? {
              primary: formatText(resolved.primary, params),
              secondary: resolved.secondary ? formatText(resolved.secondary, params) : null
            }
          : resolved
      }
      // Apply the private local vocabulary while the value is still a prose template. Dynamic
      // facts are interpolated afterwards, so paths, ids, detected names and tool errors remain
      // exact even when a user term happens to match part of one.
      return {
        primary: applyVocabularyToTemplate(resolved.primary, vocabularyEntries, params),
        secondary: resolved.secondary
          ? applyVocabularyToTemplate(resolved.secondary, vocabularyEntries, params)
          : null
      }
    },
    [mode, levels, languageFeaturesAllowed, vocabularyEntries]
  )

  const ts = useCallback(
    (id: string, fallback: string, params?: Record<string, string>): string => {
      const resolved = resolveString(id, fallback, mode, levels)
      return languageFeaturesAllowed
        ? applyVocabularyToTemplate(resolved, vocabularyEntries, params)
        : params
          ? formatText(resolved, params)
          : resolved
    },
    [mode, levels, languageFeaturesAllowed, vocabularyEntries]
  )

  const emoji = useCallback((e: string) => (showEmojiInDialogs ? e : ''), [showEmojiInDialogs])

  return {
    mode,
    funnyLevelEn: effectiveFunnyLevelEn,
    funnyLevelYue: effectiveFunnyLevelYue,
    showEmojiInDialogs,
    t,
    ts,
    emoji
  }
}
