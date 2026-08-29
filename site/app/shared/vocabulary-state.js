// site/app/shared/vocabulary-state.js
//
// Personal-vocabulary swaps: "word=newword, word=newword" pairs, validated
// and bounded before they are ever applied to page copy (see
// app/shared/i18n.js#applyReplacements). Local-only: the swap list lives
// in localStorage and is never sent anywhere.

export const MAX_ENTRIES = 40
export const MAX_TEXT_LENGTH = 600
export const MAX_WORD_LENGTH = 40
export const VOCABULARY_SCHEMA_VERSION = 1
export const MAX_JSON_BYTES = 64 * 1024

// Reject a key that could poison a plain object's prototype if this text
// were ever naively assigned onto one (defence in depth — this module
// never actually does that assignment, but the guard against it documents
// the rule for whoever adds a feature that does).
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function validateVocabularyText(text) {
  const raw = String(text || '')
  if (raw.length > MAX_TEXT_LENGTH) {
    return { ok: false, reason: `Keep it under ${MAX_TEXT_LENGTH} characters.` }
  }
  const pairs = raw
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (pairs.length > MAX_ENTRIES) {
    return { ok: false, reason: `Only ${MAX_ENTRIES} swaps at a time.` }
  }
  const entries = []
  for (const pair of pairs) {
    const bits = pair.split('=')
    if (bits.length !== 2) continue
    const from = bits[0].trim()
    const to = bits[1].trim()
    if (!from || from.length > MAX_WORD_LENGTH || to.length > MAX_WORD_LENGTH) continue
    if (UNSAFE_KEYS.has(from.toLowerCase())) continue
    entries.push([from, to])
  }
  return { ok: true, entries }
}

// The file route uses one bounded JSON contract. Text input remains as a compatibility route for
// existing visitors, but a valid uploaded file is always parsed completely before application.
export function validateVocabularyJson(text) {
  const raw = String(text || '')
  if (raw.length > MAX_JSON_BYTES) return { ok: false, reason: `Keep the JSON file under ${MAX_JSON_BYTES} characters.` }
  let value
  try { value = JSON.parse(raw) } catch (_err) { return { ok: false, reason: 'The vocabulary file is not valid JSON.' } }
  if (!value || Array.isArray(value) || value.version !== VOCABULARY_SCHEMA_VERSION || !value.entries || Array.isArray(value.entries)) {
    return { ok: false, reason: `Use vocabulary JSON version ${VOCABULARY_SCHEMA_VERSION} with an entries object.` }
  }
  const keys = Object.keys(value.entries)
  if (keys.length > MAX_ENTRIES) return { ok: false, reason: `Only ${MAX_ENTRIES} swaps at a time.` }
  const entries = []
  for (const from of keys) {
    const to = value.entries[from]
    if (UNSAFE_KEYS.has(from.toLowerCase()) || !from || from.length > MAX_WORD_LENGTH || typeof to !== 'string' || to.length > MAX_WORD_LENGTH) {
      return { ok: false, reason: 'Every entry must use bounded string keys and values.' }
    }
    entries.push([from, to])
  }
  return { ok: true, entries }
}
