import { scanJson } from './jsonScan'

/**
 * The ONE documented, versioned, bounded JSON contract for a personal-vocabulary upload. See
 * docs/personal-vocabulary.md for the human-readable version of every limit below.
 *
 * Shape:
 *   {
 *     "schemaVersion": 1,
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
 * VERSION HANDLING. `schemaVersion` must be present and exactly VOCAB_SCHEMA_VERSION. Future,
 * older, missing, and legacy `version` upload fields are refused rather than guessed at. The
 * internal cache envelope intentionally keeps its historical `version` field below so existing
 * valid cached users remain readable.
 */
export const VOCAB_SCHEMA_VERSION = 1
/** Hard file-size ceiling, checked on the raw bytes before any parsing. */
export const VOCAB_MAX_FILE_BYTES = 256 * 1024
/**
 * Uploads need only a few levels, while the persisted cache envelope and hand-authored future
 * metadata can legitimately nest deeper. The ceiling is finite so a pathological document still
 * cannot recurse without limit.
 *
 * Depth was never the real protection anyway — VOCAB_MAX_NODES and VOCAB_MAX_FILE_BYTES are what
 * actually bound the work, and both are unchanged. This stays finite so a pathological document
 * still cannot recurse without limit.
 */
export const VOCAB_MAX_DEPTH = 3
export const VOCAB_MAX_NODES = 20_000
export const VOCAB_MAX_ENTRIES = 4096
export const VOCAB_MAX_KEY_LENGTH = 160
export const VOCAB_MAX_VALUE_LENGTH = 1000

/** `Object.prototype` pollution vectors — rejected at both object levels even though the scanner
 *  and returned dictionary have null prototypes, because the file is untrusted input and this is
 *  a cheap, unconditional guarantee that survives future refactors. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
// Keep the canonical untrusted-text refusal set in step with the shared identity boundary:
// C0/C1 controls, bidi overrides/isolates, zero-width marks, and BOM are all disallowed. They can
// break a one-line copy surface or make a replacement inspect differently from what it renders.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u

export interface PersonalVocabularyEntries {
  [term: string]: string
}

export interface PersonalVocabularyCacheEnvelope {
  version: typeof VOCAB_SCHEMA_VERSION
  entries: PersonalVocabularyEntries
  entryCount: number
  savedAt: number
}

export type VocabValidationResult =
  | { ok: true; entries: PersonalVocabularyEntries; entryCount: number }
  | { ok: false; error: string }

function validateEntriesValue(entriesRaw: unknown): VocabValidationResult {
  if (entriesRaw === null || typeof entriesRaw !== 'object' || Array.isArray(entriesRaw)) {
    return {
      ok: false,
      error: 'no usable vocabulary found — expected "entries" (term → replacement)'
    }
  }
  const entriesObj = entriesRaw as Record<string, unknown>
  const keys = Object.keys(entriesObj)
  if (keys.length === 0) {
    return { ok: false, error: 'no usable vocabulary found — "entries" must contain at least one pair' }
  }
  if (keys.length > VOCAB_MAX_ENTRIES) {
    return { ok: false, error: `more than ${VOCAB_MAX_ENTRIES} entries (${keys.length})` }
  }

  const entries = Object.create(null) as PersonalVocabularyEntries
  for (const key of keys) {
    if (UNSAFE_KEYS.has(key)) return { ok: false, error: `"${key}" is not an allowed key` }
    if (key.length === 0) return { ok: false, error: 'an entry has an empty key' }
    if (CONTROL_CHARACTERS.test(key)) return { ok: false, error: 'an entry key contains a control character' }
    if (key.length > VOCAB_MAX_KEY_LENGTH) {
      return { ok: false, error: `a key is longer than ${VOCAB_MAX_KEY_LENGTH} characters` }
    }
    const value = entriesObj[key]
    if (typeof value !== 'string') {
      return { ok: false, error: `the value for "${key}" is not a string (only string replacements are allowed)` }
    }
    if (CONTROL_CHARACTERS.test(value)) return { ok: false, error: `the value for "${key}" contains a control character` }
    if (value.length > VOCAB_MAX_VALUE_LENGTH) {
      return { ok: false, error: `the value for "${key}" is longer than ${VOCAB_MAX_VALUE_LENGTH} characters` }
    }
    entries[key] = value
  }
  return { ok: true, entries, entryCount: keys.length }
}

function byteLength(text: string): number {
  // TextEncoder is the exact "bytes on disk" measure a hard file-size limit means; text.length
  // (UTF-16 code units) undercounts anything outside the BMP and every non-ASCII byte generally.
  return new TextEncoder().encode(text).length
}

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
  if (!Object.hasOwn(rootObj, 'schemaVersion') || rootObj.schemaVersion !== VOCAB_SCHEMA_VERSION) {
    return {
      ok: false,
      error: 'unsupported or missing schema version (expected exactly ' + VOCAB_SCHEMA_VERSION + '; select a file with "schemaVersion": ' + VOCAB_SCHEMA_VERSION + ')'
    }
  }
  const unknownUploadFields = Object.keys(rootObj).filter((key) => key !== 'schemaVersion' && key !== 'entries')
  if (unknownUploadFields.length > 0) {
    return { ok: false, error: 'unknown top-level field "' + unknownUploadFields[0] + '"' }
  }
  if (!Object.hasOwn(rootObj, 'entries')) {
    return { ok: false, error: 'missing "entries" (term → replacement)' }
  }
  return validateEntriesValue(rootObj.entries)
}

/** Validate the private localStorage envelope. The cache has its own exact shape because adding
 * persistence metadata to an upload would otherwise make a valid upload look like an unknown
 * schema. This parser is shared by the renderer and non-React entrypoints such as the HUD. */
export function validateVocabularyCachePayload(raw: string):
  | { ok: true; cache: PersonalVocabularyCacheEnvelope }
  | { ok: false; error: string } {
  if (byteLength(raw) > VOCAB_MAX_FILE_BYTES) {
    return { ok: false, error: 'cached vocabulary exceeds the file-size limit' }
  }
  const scanned = scanJson(raw, { maxDepth: VOCAB_MAX_DEPTH, maxNodes: VOCAB_MAX_NODES })
  if (!scanned.ok) return { ok: false, error: `not valid JSON — ${scanned.error}` }
  const root = scanned.value
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    return { ok: false, error: 'cached vocabulary must be a JSON object' }
  }
  const rootObj = root as Record<string, unknown>
  for (const key of Object.keys(rootObj)) {
    if (UNSAFE_KEYS.has(key)) return { ok: false, error: `top-level key "${key}" is not allowed` }
  }
  const expected = ['version', 'entries', 'entryCount', 'savedAt']
  const unknown = Object.keys(rootObj).find((key) => !expected.includes(key))
  if (unknown) return { ok: false, error: `unknown cache field "${unknown}"` }
  if (!Object.hasOwn(rootObj, 'version') || rootObj.version !== VOCAB_SCHEMA_VERSION) {
    return { ok: false, error: 'unsupported or missing cache schema version' }
  }
  if (!Object.hasOwn(rootObj, 'entryCount') || typeof rootObj.entryCount !== 'number' || !Number.isInteger(rootObj.entryCount)) {
    return { ok: false, error: 'cached entryCount must be an integer' }
  }
  if (!Object.hasOwn(rootObj, 'savedAt') || typeof rootObj.savedAt !== 'number' || !Number.isFinite(rootObj.savedAt)) {
    return { ok: false, error: 'cached savedAt must be a finite number' }
  }
  const entries = validateEntriesValue(rootObj.entries)
  if (!entries.ok) return entries
  if (rootObj.entryCount !== entries.entryCount) {
    return { ok: false, error: 'cached entryCount does not match entries' }
  }
  return {
    ok: true,
    cache: {
      version: VOCAB_SCHEMA_VERSION,
      entries: entries.entries,
      entryCount: entries.entryCount,
      savedAt: rootObj.savedAt
    }
  }
}
