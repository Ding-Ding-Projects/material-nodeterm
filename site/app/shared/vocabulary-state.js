// site/app/shared/vocabulary-state.js
//
// Pure state + validation for the personal-vocabulary JSON upload. Split
// from features/vocabulary.js (the file-picker UI) so shared/i18n.js can
// apply replacements at the text boundary without a feature module
// importing a shared module importing a feature module back.
//
// Schema (version 1), validated COMPLETELY before anything is stored or
// applied — a rejected file never applies partially:
//   { "version": 1, "entries": { "word": "replacement", ... } }
// - version must be exactly the supported number (1)
// - entries must be a plain object, at most MAX_ENTRIES keys
// - every key: string, 1..MAX_KEY_LEN chars, not "__proto__" / "constructor"
//   / "prototype" (case-insensitive)
// - every value: string, 0..MAX_VALUE_LEN chars (string-only values — no
//   numbers, booleans, objects, or arrays)
// - the whole parsed structure must not exceed MAX_DEPTH nesting levels
// - the raw file must not exceed MAX_FILE_BYTES
//
// The data only ever exists after the visitor supplies a valid file — this
// module ships no built-in mappings, samples, or defaults. Nothing here
// ever leaves the browser: no network request, and the raw vocabulary
// values are never written to logs, exports, or any other surface besides
// the replacement it performs and its own settings panel.

import { readJSON, writeJSON, writeString, readString, remove, subscribe } from './storage.js'

export const SCHEMA_VERSION = 1
export const MAX_FILE_BYTES = 200 * 1024
export const MAX_ENTRIES = 2000
export const MAX_KEY_LEN = 100
export const MAX_VALUE_LEN = 500
export const MAX_DEPTH = 4
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const KEY_DATA = 'vocab.data'
const KEY_FILENAME = 'vocab.fileName'

function jsonDepth(value, depth = 0) {
  if (depth > MAX_DEPTH) return depth
  if (value == null || typeof value !== 'object') return depth
  let max = depth
  for (const v of Object.values(value)) {
    const d = jsonDepth(v, depth + 1)
    if (d > max) max = d
    if (max > MAX_DEPTH) return max
  }
  return max
}

/**
 * Validates a raw file's TEXT content against the bounded schema above.
 * Returns { ok: true, entries } or { ok: false, error }. Never throws.
 */
export function validateVocabularyText(text) {
  if (typeof text !== 'string') return { ok: false, error: 'File content is not text.' }
  if (new Blob([text]).size > MAX_FILE_BYTES) {
    return { ok: false, error: `File is larger than the ${Math.round(MAX_FILE_BYTES / 1024)} KB limit.` }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return { ok: false, error: 'Not valid JSON: ' + (err.message || String(err)) }
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'The top level must be a JSON object.' }
  }
  if (jsonDepth(parsed) > MAX_DEPTH) {
    return { ok: false, error: `Nested more than ${MAX_DEPTH} levels deep.` }
  }
  if (parsed.version !== SCHEMA_VERSION) {
    return { ok: false, error: `Unsupported schema version (expected ${SCHEMA_VERSION}).` }
  }
  const entries = parsed.entries
  if (entries == null || typeof entries !== 'object' || Array.isArray(entries)) {
    return { ok: false, error: '"entries" must be a JSON object.' }
  }
  const keys = Object.keys(entries)
  if (keys.length > MAX_ENTRIES) {
    return { ok: false, error: `Too many entries (max ${MAX_ENTRIES}).` }
  }
  const clean = {}
  for (const key of keys) {
    if (UNSAFE_KEYS.has(key.toLowerCase())) {
      return { ok: false, error: `Unsafe key not allowed: "${key}".` }
    }
    if (typeof key !== 'string' || key.length < 1 || key.length > MAX_KEY_LEN) {
      return { ok: false, error: `Key "${key}" is empty or longer than ${MAX_KEY_LEN} characters.` }
    }
    const value = entries[key]
    if (typeof value !== 'string') {
      return { ok: false, error: `Value for "${key}" must be a string.` }
    }
    if (value.length > MAX_VALUE_LEN) {
      return { ok: false, error: `Value for "${key}" is longer than ${MAX_VALUE_LEN} characters.` }
    }
    clean[key] = value
  }
  return { ok: true, entries: clean }
}

export function hasVocabulary() {
  return readJSON(KEY_DATA, null) != null
}

export function getFileName() {
  return readString(KEY_FILENAME, '')
}

export function getEntries() {
  const data = readJSON(KEY_DATA, null)
  return data && data.entries ? data.entries : {}
}

export function setVocabulary(fileName, entries) {
  writeJSON(KEY_DATA, { version: SCHEMA_VERSION, entries })
  writeString(KEY_FILENAME, fileName || 'uploaded.json')
}

export function clearVocabulary() {
  remove(KEY_DATA)
  remove(KEY_FILENAME)
}

export function subscribeVocabulary(cb) {
  const unsubs = [subscribe(KEY_DATA, cb), subscribe(KEY_FILENAME, cb)]
  return () => unsubs.forEach((u) => u())
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

let compiledCache = null
let compiledForEntries = null

function compile(entries) {
  if (compiledForEntries === entries) return compiledCache
  const keys = Object.keys(entries).sort((a, b) => b.length - a.length)
  if (keys.length === 0) {
    compiledCache = null
  } else {
    const pattern = keys.map(escapeRegExp).join('|')
    try {
      compiledCache = { re: new RegExp('\\b(?:' + pattern + ')\\b', 'g'), entries }
    } catch (_err) {
      compiledCache = null
    }
  }
  compiledForEntries = entries
  return compiledCache
}

/**
 * Applies the visitor's replacements at the user-facing TEXT boundary only.
 * Code, URLs, identifiers, and paths are never passed through this — call
 * sites choose what counts as prose (see shared/i18n.js's t()).
 */
export function applyReplacements(text) {
  if (typeof text !== 'string' || !text) return text
  const entries = getEntries()
  if (Object.keys(entries).length === 0) return text
  const compiled = compile(entries)
  if (!compiled) return text
  return text.replace(compiled.re, (match) => (Object.prototype.hasOwnProperty.call(entries, match) ? entries[match] : match))
}
