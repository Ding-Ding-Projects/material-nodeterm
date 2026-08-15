import { useCallback, useMemo } from 'react'
import { useSettings } from '../state/settings'
import {
  formatText,
  t as resolveText,
  ts as resolveString,
  type FunnyLevels,
  type LanguageMode,
  type LocalizedText
} from '@shared/i18n'

/**
 * Renderer-side binding of the pure `@shared/i18n` resolver to the live `languageMode` /
 * `funnyLevelEn` / `funnyLevelYue` settings. Applies LIVE: it reads straight off the zustand
 * settings store, so a slider move re-renders every subscriber immediately, with no restart.
 *
 * `t(id, fallback)` returns `{ primary, secondary }` for surfaces that can render a stacked
 * primary + compact secondary line (bilingual mode). `ts(id, fallback)` joins the two into one
 * line ("English · 廣東話") for a button label, aria-label, or window title that can't stack.
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
  const mode = useSettings((s) => s.settings.languageMode)
  const funnyLevelEn = useSettings((s) => s.settings.funnyLevelEn)
  const funnyLevelYue = useSettings((s) => s.settings.funnyLevelYue)
  const showEmojiInDialogs = useSettings((s) => s.settings.showEmojiInDialogs)

  const levels: FunnyLevels = useMemo(
    () => ({ en: funnyLevelEn, yue: funnyLevelYue }),
    [funnyLevelEn, funnyLevelYue]
  )

  const t = useCallback(
    (id: string, fallback: string, params?: Record<string, string>): LocalizedText => {
      const resolved = resolveText(id, fallback, mode, levels)
      if (!params) return resolved
      return {
        primary: formatText(resolved.primary, params),
        secondary: resolved.secondary ? formatText(resolved.secondary, params) : null
      }
    },
    [mode, levels]
  )

  const ts = useCallback(
    (id: string, fallback: string, params?: Record<string, string>): string => {
      const resolved = resolveString(id, fallback, mode, levels)
      return params ? formatText(resolved, params) : resolved
    },
    [mode, levels]
  )

  const emoji = useCallback((e: string) => (showEmojiInDialogs ? e : ''), [showEmojiInDialogs])

  return { mode, funnyLevelEn, funnyLevelYue, showEmojiInDialogs, t, ts, emoji }
}
