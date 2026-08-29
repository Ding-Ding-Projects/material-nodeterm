/**
 * Shared localization types. Kept separate from the catalogue (catalog.ts) and the resolver
 * (resolve.ts) on purpose: a type-only module has no runtime weight, so importing just the shape
 * (e.g. from a settings field) never pulls the whole string table along.
 */

/** English, playful Hong Kong-style Cantonese, or both at once (English prominent, Cantonese
 *  compact secondary). Persisted in Settings.languageMode. */
export type LanguageMode = 'en' | 'yue' | 'bilingual'

/** 1 = fully professional, 5 = maximum playfulness. Two independent sliders — one per language —
 *  because a user may want plain English with playful Cantonese, or the reverse. */
export type FunnyLevel = 1 | 2 | 3 | 4 | 5

export interface FunnyLevels {
  en: FunnyLevel
  yue: FunnyLevel
}

/** Exactly five variants, indexed [level 1 .. level 5]. A level may repeat a neighbour's text
 *  verbatim when a distinct joke would add nothing (a plain noun like "Terminal" needs no fifth
 *  variant) — but the array must always carry all five so a slider move never resolves to
 *  nothing. An empty string at a Cantonese index means "no distinct Cantonese text" and falls
 *  back to the English variant at the same level (see resolve.ts) rather than rendering blank. */
export type FiveVariants = readonly [string, string, string, string, string]

export interface CatalogEntry {
  en: FiveVariants
  yue: FiveVariants
}

export type Catalog = Record<string, CatalogEntry>

/** What a resolved string looks like once mode + funny levels have been applied. `secondary` is
 *  present only in bilingual mode (and only when there is a distinct Cantonese fallback to show);
 *  callers that render a single line join the two themselves — see `ts()` in resolve.ts. */
export interface LocalizedText {
  primary: string
  secondary: string | null
}
