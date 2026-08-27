import { CATALOG } from './catalog'
import type { Catalog, FunnyLevels, LanguageMode, LocalizedText } from './types'
import { normalizeFunnyLevel, normalizeLanguageMode } from './validation'

const EXTRA_EN = [
  ' A little extra sparkle, with the facts still firmly in charge.',
  ' The copy has found a tasteful confetti button, and nothing factual moved.',
  ' More whimsy has entered the room; the action and its consequences stay exact.',
  ' Maximum playful voice engaged, while every useful detail remains on duty.',
  ' Full comedy overdrive: same facts, same choices, spectacularly sillier delivery.'
] as const
const EXTRA_YUE = [
  ' 加少少生氣，事實照樣企得穩陣。',
  ' 文字掂咗下靚靚紙碎，重要資料一粒都冇郁。',
  ' 多啲玩味入場，動作同後果仍然原原本本。',
  ' 玩味開到盡，所有有用細節繼續當值。',
  ' 全速搞笑模式：事實一樣，選擇一樣，語氣就放飛喇。'
] as const

function variantAt(
  variants: readonly string[],
  level: FunnyLevels['en'],
  extra: readonly string[],
  fallback: string
): string {
  const safeLevel = normalizeFunnyLevel(level, 1)
  const base = variants[Math.min(safeLevel, 5) - 1] || variants[0] || fallback
  // Ten-slot rows own their copy directly. Five-slot legacy rows receive a deliberate extra
  // voice layer for levels 6–10 instead of silently repeating level 5.
  if (variants.length >= 10 || safeLevel <= 5) return base
  return `${base}${extra[safeLevel - 6]}`
}

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

  const en = variantAt(entry.en, levels.en, EXTRA_EN, fallback)
  const yueRaw = variantAt(entry.yue, levels.yue, EXTRA_YUE, en)
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
