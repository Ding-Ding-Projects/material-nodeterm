import { scanJson } from './jsonScan'

/**
 * The ONE documented, versioned, bounded JSON contract for a personal-vocabulary upload. See
 * docs/personal-vocabulary.md for the human-readable version of every limit below.
 *
 * Shape:
 *   {
 *     "version": 1,
 *     "entries": { "<term the app would otherwise show>": "<replacement text>", ... }
 *   }
 *
 * `entries` is intentionally FLAT (string → string only, never nested) — the substitution
 * boundary (`applyVocabulary`) is a literal text replacement, so a nested or non-string value
 * would have no defined meaning there.
 */
export const VOCAB_SCHEMA_VERSION = 1
/** Hard file-size ceiling, checked on the raw bytes before any parsing. */
export const VOCAB_MAX_FILE_BYTES = 256 * 1024
/** Root object (depth 1) → `entries` object (depth 2) → string value (depth 3). Nothing in this
 *  schema is ever legitimately deeper than that. */
export const VOCAB_MAX_DEPTH = 3
export const VOCAB_MAX_NODES = 20_000
export const VOCAB_MAX_ENTRIES = 2000
export const VOCAB_MAX_KEY_LENGTH = 200
export const VOCAB_MAX_VALUE_LENGTH = 500

/** `Object.prototype` pollution vectors — rejected as keys even though `entries` is a plain
 *  object literal we build ourselves (never `Object.assign`ed onto a live prototype-bearing
 *  object), because the file is untrusted input and this is a cheap, unconditional guarantee. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export interface PersonalVocabularyEntries {
  [term: string]: string
}

export type VocabValidationResult =
  | { ok: true; entries: PersonalVocabularyEntries; entryCount: number }
  | { ok: false; error: string }

function byteLength(text: string): number {
  // TextEncoder is the exact "bytes on disk" measure a hard file-size limit means; text.length
  // (UTF-16 code units) undercounts anything outside the BMP and every non-ASCII byte generally.
  return new TextEncoder().encode(text).length
}

/**
 * Validate the COMPLETE payload before anything derived from it is displayed or cached. Never
 * partial: any single violation rejects the whole file, and the caller must not apply a subset.
 */
export function validateVocabularyPayload(raw: string): VocabValidationResult {
  const size = byteLength(raw)
  if (size > VOCAB_MAX_FILE_BYTES) {
    return { ok: false, error: `the file is ${size.toLocaleString()} bytes, over the ${VOCAB_MAX_FILE_BYTES.toLocaleString()}-byte limit` }
  }

  const scanned = scanJson(raw, { maxDepth: VOCAB_MAX_DEPTH, maxNodes: VOCAB_MAX_NODES })
  if (!scanned.ok) return { ok: false, error: `not valid JSON — ${scanned.error}` }

  const root = scanned.value
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    return { ok: false, error: 'the top level must be a JSON object' }
  }
  const rootObj = root as Record<string, unknown>

  if (rootObj.version !== VOCAB_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `unsupported or missing schema version (expected ${VOCAB_SCHEMA_VERSION}, a future/older format is rejected rather than guessed at)`
    }
  }

  const entriesRaw = rootObj.entries
  if (entriesRaw === null || typeof entriesRaw !== 'object' || Array.isArray(entriesRaw)) {
    return { ok: false, error: '"entries" must be a JSON object of string → string' }
  }
  const entriesObj = entriesRaw as Record<string, unknown>
  const keys = Object.keys(entriesObj)
  if (keys.length > VOCAB_MAX_ENTRIES) {
    return { ok: false, error: `more than ${VOCAB_MAX_ENTRIES} entries (${keys.length})` }
  }

  const entries: PersonalVocabularyEntries = {}
  for (const key of keys) {
    if (UNSAFE_KEYS.has(key)) return { ok: false, error: `"${key}" is not an allowed key` }
    if (key.length === 0) return { ok: false, error: 'an entry has an empty key' }
    if (key.length > VOCAB_MAX_KEY_LENGTH) {
      return { ok: false, error: `a key is longer than ${VOCAB_MAX_KEY_LENGTH} characters` }
    }
    const value = entriesObj[key]
    if (typeof value !== 'string') {
      return { ok: false, error: `the value for "${key}" is not a string (only string replacements are allowed)` }
    }
    if (value.length > VOCAB_MAX_VALUE_LENGTH) {
      return { ok: false, error: `the value for "${key}" is longer than ${VOCAB_MAX_VALUE_LENGTH} characters` }
    }
    entries[key] = value
  }

  // Unknown top-level fields are tolerated (forward-compatible additions), but nothing outside
  // `version`/`entries` may carry a real vocabulary value — the schema only ever reads these two.

  return { ok: true, entries, entryCount: keys.length }
}
