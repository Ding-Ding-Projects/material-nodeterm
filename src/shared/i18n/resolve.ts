import { CATALOG } from './catalog'
import type { Catalog, FunnyLevels, LanguageMode, LocalizedText } from './types'
import { normalizeLanguageMode } from './validation'

/**
 * Pure resolver: given a catalogue id, the caller's own English default, the active language
 * mode and both funny-level sliders, returns what to render. Pure and catalogue-injectable so it
 * is trivial to test against a small fixture catalogue rather than the real (large) one.
 *
 * Fallback rules (see docs/language-modes.md for the full contract):
 *  - An id with no catalogue entry at all resolves to the caller-supplied `fallback` for every
 *    mode. There is no Cantonese text to show for an untranslated string, so bilingual mode just
 *    shows the fallback with no secondary line — that is honest, not broken.
 *  - An id that DOES exist but whose Cantonese variant at the active level is an empty string
 *    falls back to the ENGLISH variant at that same level, never to a blank string.
 */
export function t(
  id: string,
  fallback: string,
  mode: LanguageMode,
  levels: FunnyLevels,
  catalog: Catalog = CATALOG
): LocalizedText {
  const entry = catalog[id]
  if (!entry) return { primary: fallback, secondary: null }

  const en = entry.en[levels.en - 1] || entry.en[0] || fallback
  const yueRaw = entry.yue[levels.yue - 1]
  const yue = yueRaw && yueRaw.length > 0 ? yueRaw : en

  switch (normalizeLanguageMode(mode)) {
    case 'en':
      return { primary: en, secondary: null }
    case 'yue':
      return { primary: yue, secondary: null }
    case 'bilingual':
      return { primary: en, secondary: yue === en ? null : yue }
  }
}

/** Same resolution as `t()`, but joined into a single line — for contexts that can't render a
 *  stacked primary/secondary (a button label, an aria-label, a window title). Bilingual mode
 *  reads "English · 廣東話"; en/yue modes are unchanged from `t()`'s primary. */
export function ts(
  id: string,
  fallback: string,
  mode: LanguageMode,
  levels: FunnyLevels,
  catalog: Catalog = CATALOG
): string {
  const { primary, secondary } = t(id, fallback, mode, levels, catalog)
  return secondary ? `${primary} · ${secondary}` : primary
}

/** Fills `{token}` placeholders in a resolved (or any) string. Never interpolate a live value
 *  into the catalogue itself — the catalogue holds the template, the caller holds the fact. */
export function formatText(text: string, params: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? params[key] : match
  )
}

/** `t()` + `formatText()` on both primary and secondary in one call. */
export function tf(
  id: string,
  fallback: string,
  mode: LanguageMode,
  levels: FunnyLevels,
  params: Record<string, string>,
  catalog: Catalog = CATALOG
): LocalizedText {
  const resolved = t(id, fallback, mode, levels, catalog)
  return {
    primary: formatText(resolved.primary, params),
    secondary: resolved.secondary ? formatText(resolved.secondary, params) : null
  }
}

/** `ts()` + `formatText()` in one call. */
export function tsf(
  id: string,
  fallback: string,
  mode: LanguageMode,
  levels: FunnyLevels,
  params: Record<string, string>,
  catalog: Catalog = CATALOG
): string {
  return formatText(ts(id, fallback, mode, levels, catalog), params)
}
