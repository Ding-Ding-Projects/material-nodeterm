/**
 * Shared localization types. Kept separate from the catalogue (catalog.ts) and the resolver
 * (resolve.ts) on purpose: a type-only module has no runtime weight, so importing just the shape
 * (e.g. from a settings field) never pulls the whole string table along.
 */

/** English, playful Hong Kong-style Cantonese, or both at once (English prominent, Cantonese
 *  compact secondary). Persisted in Settings.languageMode. */
export type LanguageMode = 'en' | 'yue' | 'bilingual'

/** The inclusive funny-level range. Level 1 is fully professional; level 10 is maximum
 * playfulness. The English and Cantonese controls remain independent. */
export const FUNNY_LEVEL_MIN = 1 as const
export const FUNNY_LEVEL_MAX = 10 as const
export const DEFAULT_FUNNY_LEVEL = 10 as const
export type FunnyLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export interface FunnyLevels {
  en: FunnyLevel
  yue: FunnyLevel
}

/** Legacy five-variant rows remain accepted while the catalogue migrates. The resolver expands
 * those rows through five additional, voice-only levels, so old persisted/catalogue data never
 * indexes past its end. New rows should use FunnyVariants. */
export type FiveVariants = readonly [string, string, string, string, string]

/** Ten variants, indexed [level 1 .. level 10]. An empty Cantonese slot means "use the English
 * variant at the same level" rather than rendering blank. */
export type FunnyVariants = readonly [
  string, string, string, string, string,
  string, string, string, string, string
]

export interface CatalogEntry {
  en: FunnyVariants | FiveVariants
  yue: FunnyVariants | FiveVariants
}

export type Catalog = Record<string, CatalogEntry>

/** What a resolved string looks like once mode + funny levels have been applied. `secondary` is
 *  present only in bilingual mode (and only when there is a distinct Cantonese fallback to show);
 *  callers that render a single line join the two themselves — see `ts()` in resolve.ts. */
export interface LocalizedText {
  primary: string
  secondary: string | null
}
