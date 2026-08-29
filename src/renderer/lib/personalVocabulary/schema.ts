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
 *
 * Only the versioned entries payload is accepted. Documentation exports and alternate shapes are
 * rejected instead of being partially interpreted:
 *
 * VERSION HANDLING. A version must be present and exactly VOCAB_SCHEMA_VERSION. Future, older,
 * and missing versions are refused rather than guessed at.
 */
export const VOCAB_SCHEMA_VERSION = 1
/** Hard file-size ceiling, checked on the raw bytes before any parsing. */
export const VOCAB_MAX_FILE_BYTES = 256 * 1024
/**
 * `entries` needs 3 (root → object → string) and the `terms` list needs 4 (root → array → term
 * object → string field). The ceiling is well above both because a real vocabulary folder also
 * holds its own JSON Schema document, and those legitimately nest ~9 deep; refusing to even parse
 * one made the picker report "not valid JSON" about a perfectly valid file.
 *
 * Depth was never the real protection anyway — VOCAB_MAX_NODES and VOCAB_MAX_FILE_BYTES are what
 * actually bound the work, and both are unchanged. This stays finite so a pathological document
 * still cannot recurse without limit.
 */
export const VOCAB_MAX_DEPTH = 12
export const VOCAB_MAX_NODES = 20_000
export const VOCAB_MAX_ENTRIES = 2000
export const VOCAB_MAX_KEY_LENGTH = 200
export const VOCAB_MAX_VALUE_LENGTH = 500

/** `Object.prototype` pollution vectors — rejected at both object levels even though the scanner
 *  and returned dictionary have null prototypes, because the file is untrusted input and this is
 *  a cheap, unconditional guarantee that survives future refactors. */
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
 * `terms: [{ replaces, alias }]` → `{ [replaces]: alias }`.
 *
 * Rows without both strings are SKIPPED rather than rejecting the file: a dictionary export
 * legitimately carries documentation-only rows (notes, categories, open questions) alongside the
 * real pairs, and failing the whole upload over one of those would make the user's actual file
 * unusable. Every bound and refusal that applies to `entries` applies identically here.
 */
// Alternate payloads are intentionally unsupported; the strict validator below is the only
// entry point so malformed rows can never be silently skipped.

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

  return validateVocabularyValue(scanned.value)
}

/** Validate an already-decoded value against the same ownership and shape rules. The upload path
 *  always arrives through `scanJson`; keeping this decision as a pure value-level function makes
 *  the own-property boundary directly testable rather than an unobservable redundant guard. */
export function validateVocabularyValue(root: unknown): VocabValidationResult {
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    return { ok: false, error: 'the top level must be a JSON object' }
  }
  const rootObj = root as Record<string, unknown>

  for (const key of Object.keys(rootObj)) {
    if (UNSAFE_KEYS.has(key)) return { ok: false, error: `top-level key "${key}" is not allowed` }
  }

  // Accept exactly one versioned upload shape. Companion documents and terms lists are not
  // substitution files, and silently skipping malformed rows makes a rejected upload look
  // partially successful.
  if (!Object.hasOwn(rootObj, 'version') || rootObj.version !== VOCAB_SCHEMA_VERSION) {
    return { ok: false, error: 'unsupported or missing schema version (expected exactly ' + VOCAB_SCHEMA_VERSION + ')' }
  }
  const unknownUploadFields = Object.keys(rootObj).filter((key) => key !== 'version' && key !== 'entries')
  if (unknownUploadFields.length > 0) {
    return { ok: false, error: 'unknown top-level field "' + unknownUploadFields[0] + '"' }
  }
  if (!Object.hasOwn(rootObj, 'entries')) {
    return { ok: false, error: 'missing "entries" (term → replacement)' }
  }
  const hasEntries = true
  if (!hasEntries) {
    return {
      ok: false,
      error: 'no usable vocabulary found — expected "entries" (term → replacement)'
    }
  }
  const entriesRaw = rootObj.entries
  if (entriesRaw === null || typeof entriesRaw !== 'object' || Array.isArray(entriesRaw)) {
    return {
      ok: false,
      error: 'no usable vocabulary found — expected "entries" (term → replacement)'
    }
  }
  const entriesObj = entriesRaw as Record<string, unknown>
  const keys = Object.keys(entriesObj)
  if (keys.length > VOCAB_MAX_ENTRIES) {
    return { ok: false, error: `more than ${VOCAB_MAX_ENTRIES} entries (${keys.length})` }
  }

  // Keep the validated result prototype-free too. The scanner already made every input key an
  // own property; returning an ordinary `{}` here would reintroduce the `__proto__` setter at the
  // final copy boundary if the rejection above were ever weakened.
  const entries = Object.create(null) as PersonalVocabularyEntries
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
