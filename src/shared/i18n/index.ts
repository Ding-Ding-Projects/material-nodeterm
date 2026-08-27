export type {
  Catalog,
  CatalogEntry,
  FiveVariants,
  FunnyVariants,
  FunnyLevel,
  FunnyLevels,
  LanguageMode,
  LocalizedText
} from './types'
export { DEFAULT_FUNNY_LEVEL, FUNNY_LEVEL_MAX, FUNNY_LEVEL_MIN } from './types'
export { CATALOG } from './catalog'
export { formatText, t, tf, ts, tsf } from './resolve'
export { isFunnyLevel, normalizeFunnyLevel, normalizeLanguageMode } from './validation'
