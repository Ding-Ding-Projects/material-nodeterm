import type { LanguageMode } from './types'

/**
 * Settings are hand-editable JSON, so the compile-time union does not prove the runtime value.
 * Unknown language modes fail to the shipped English-only default: that is both readable and the
 * least surprising mode, and it keeps the resolver from returning `undefined` through an
 * exhaustive switch whose exhaustiveness exists only at compile time.
 */
export function normalizeLanguageMode(value: unknown): LanguageMode {
  return value === 'yue' || value === 'bilingual' ? value : 'en'
}
