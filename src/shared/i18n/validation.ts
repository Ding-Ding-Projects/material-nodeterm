import {
  DEFAULT_FUNNY_LEVEL,
  FUNNY_LEVEL_MAX,
  FUNNY_LEVEL_MIN,
  type FunnyLevel,
  type LanguageMode
} from './types'

/**
 * Settings are hand-editable JSON, so the compile-time union does not prove the runtime value.
 * Unknown language modes fail to the shipped English-only default: that is both readable and the
 * least surprising mode, and it keeps the resolver from returning `undefined` through an
 * exhaustive switch whose exhaustiveness exists only at compile time.
 */
export function normalizeLanguageMode(value: unknown): LanguageMode {
  return value === 'yue' || value === 'bilingual' ? value : 'en'
}

/**
 * Hand-edited settings are runtime input, not proof of the TypeScript union. Keep valid values
 * exactly as chosen, and use the explicit supplied fallback for malformed, fractional, or
 * out-of-range values. The settings store supplies the new-install default of 10; School mode
 * supplies 1 at the effective-render boundary.
 */
export function normalizeFunnyLevel(
  value: unknown,
  fallback: FunnyLevel = DEFAULT_FUNNY_LEVEL
): FunnyLevel {
  return typeof value === 'number' && Number.isInteger(value) && value >= FUNNY_LEVEL_MIN && value <= FUNNY_LEVEL_MAX
    ? (value as FunnyLevel)
    : fallback
}

export function isFunnyLevel(value: unknown): value is FunnyLevel {
  return typeof value === 'number' && Number.isInteger(value) && value >= FUNNY_LEVEL_MIN && value <= FUNNY_LEVEL_MAX
}
