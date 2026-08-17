import { scanJson } from './jsonScan'

/**
 * The ONE documented, versioned, bounded JSON contract for a personal-vocabulary upload. See
 * docs/personal-vocabulary.md for the human-readable version of every limit below.
 *
 * Shape:
 *   {
 *     "version": 1,            // or "schemaVersion": 1 — both spellings are accepted
 *     "entries": { "<term the app would otherwise show>": "<replacement text>", ... }
 *   }
 *
 * `entries` is intentionally FLAT (string → string only, never nested) — the substitution
 * boundary (`applyVocabulary`) is a literal text replacement, so a nested or non-string value
 * would have no defined meaning there.
 *
 * TWO ALTERNATIVE PAYLOADS are also accepted, because a real dictionary is maintained in more
 * than one file and a loader that only reads the one shape it was written against is a loader
 * that rejects the user's actual data:
 *
 *   { "terms": [ { "replaces": "<ordinary word>", "alias": "<what to show instead>" }, ... ] }
 *   { "requiredPhrases": [ ... ] }     // carries no term→replacement pairs; accepted, applies none
 *
 * VERSION HANDLING. A version that is PRESENT must be exactly VOCAB_SCHEMA_VERSION — a future or
 * older format is still refused rather than guessed at. A version that is ABSENT is accepted and
 * the payload identified by shape. That is a deliberate relaxation of the original
 * reject-if-missing rule: files that predate the field are otherwise unreadable forever, and the
 * shape check below is what actually establishes the data is meaningful. Every bound, the
 * string-only rule and the prototype-pollution refusal are unchanged and still apply to all three.
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
 * `terms: [{ replaces, alias }]` → `{ [replaces]: alias }`.
 *
 * Rows without both strings are SKIPPED rather than rejecting the file: a dictionary export
 * legitimately carries documentation-only rows (notes, categories, open questions) alongside the
 * real pairs, and failing the whole upload over one of those would make the user's actual file
 * unusable. Every bound and refusal that applies to `entries` applies identically here.
 */
function entriesFromTerms(terms: unknown[]): VocabValidationResult {
  if (terms.length > VOCAB_MAX_ENTRIES) {
    return { ok: false, error: `more than ${VOCAB_MAX_ENTRIES} terms (${terms.length})` }
  }
  const entries: PersonalVocabularyEntries = {}
  let count = 0
  for (const row of terms) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue
    const { replaces, alias } = row as { replaces?: unknown; alias?: unknown }
    if (typeof replaces !== 'string' || typeof alias !== 'string') continue
    if (replaces.length === 0 || alias.length === 0) continue
    if (UNSAFE_KEYS.has(replaces)) {
      return { ok: false, error: `"${replaces}" is not an allowed key` }
    }
    // Over-long rows are skipped for the same reason malformed ones are: a dictionary export
    // carries prose rows (a sentence in `replaces`, a whole explanation in `alias`) beside the
    // real pairs, and failing the upload over one of those makes the user's file unusable while
    // telling them nothing they can act on. The bound still holds — such a row is never applied.
    if (replaces.length > VOCAB_MAX_KEY_LENGTH) continue
    if (alias.length > VOCAB_MAX_VALUE_LENGTH) continue
    entries[replaces] = alias
    count += 1
  }
  return { ok: true, entries, entryCount: count }
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

  // Accept either spelling of the version field. Present ⇒ must match; absent ⇒ identified by
  // shape below (see the header note on why missing is no longer fatal).
  const declared = rootObj.version ?? rootObj.schemaVersion
  if (declared !== undefined && declared !== VOCAB_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `unsupported schema version ${JSON.stringify(declared)} (expected ${VOCAB_SCHEMA_VERSION}; a future/older format is rejected rather than guessed at)`
    }
  }

  // `terms` list form: [{ replaces, alias }] → { replaces: alias }. A row missing either string
  // is skipped rather than failing the file: these exports carry documentation-only rows too.
  if (rootObj.entries === undefined && Array.isArray(rootObj.terms)) {
    return entriesFromTerms(rootObj.terms)
  }

  // Two companion documents carry no term→replacement pairs at all: a required-phrases file
  // (an object OR a list, depending on which generation wrote it) and the folder's own JSON
  // Schema. Both are valid files with nothing to substitute, so accepting them with zero
  // entries is the honest answer — reporting an error would say the file is broken when it is
  // simply not a substitution table.
  const hasPhrases = rootObj.requiredPhrases !== null && rootObj.requiredPhrases !== undefined
  const isJsonSchemaDoc = typeof rootObj.$schema === 'string' && rootObj.properties !== undefined
  if (rootObj.entries === undefined && (hasPhrases || isJsonSchemaDoc)) {
    return { ok: true, entries: {}, entryCount: 0 }
  }

  const entriesRaw = rootObj.entries
  if (entriesRaw === null || typeof entriesRaw !== 'object' || Array.isArray(entriesRaw)) {
    return {
      ok: false,
      error: 'no usable vocabulary found — expected "entries" (term → replacement), a "terms" list, or "requiredPhrases"'
    }
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
