// site/app/shared/vocabulary-state.js
//
// The landing page uses the same versioned JSON contract as the desktop renderer. The parser is
// local-only and bounded, and it rejects duplicate keys before JSON.parse can discard one.

export const VOCAB_SCHEMA_VERSION = 1
export const VOCAB_MAX_FILE_BYTES = 256 * 1024
export const VOCAB_MAX_DEPTH = 12
export const VOCAB_MAX_NODES = 20000
export const VOCAB_MAX_ENTRIES = 2000
export const VOCAB_MAX_KEY_LENGTH = 200
export const VOCAB_MAX_VALUE_LENGTH = 500
export const VOCAB_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

function bytes(text) { return new TextEncoder().encode(String(text)).length }

function scanJson(text) {
  let i = 0
  let nodes = 0
  const fail = (reason) => ({ ok: false, reason })
  const skip = () => { while (i < text.length && ' \t\r\n'.includes(text[i])) i++ }
  const budget = () => { nodes++; return nodes > VOCAB_MAX_NODES ? `the file has more than ${VOCAB_MAX_NODES} JSON values` : null }
  function string() {
    const start = i++
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue }
      if (text[i] === '"') {
        const raw = text.slice(start, ++i)
        try { return { ok: true, value: JSON.parse(raw) } } catch (_e) { return fail('invalid string escape') }
      }
      if (text.charCodeAt(i) < 0x20) return fail('control character in string')
      i++
    }
    return fail('unterminated string')
  }
  function value(depth) {
    skip()
    if (depth > VOCAB_MAX_DEPTH) return fail(`nested more than ${VOCAB_MAX_DEPTH} levels deep`)
    const b = budget(); if (b) return fail(b)
    if (text[i] === '"') return string()
    if (text[i] === '{') return object(depth)
    if (text[i] === '[') return array(depth)
    const rest = text.slice(i)
    const number = rest.match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/)
    if (number) { i += number[0].length; return { ok: true, value: Number(number[0]) } }
    for (const [word, val] of [['true', true], ['false', false], ['null', null]]) {
      if (rest.startsWith(word)) { i += word.length; return { ok: true, value: val } }
    }
    return fail('unexpected character')
  }
  function object(depth) {
    i++; const out = Object.create(null); const seen = new Set(); skip()
    if (text[i] === '}') { i++; return { ok: true, value: out } }
    while (i < text.length) {
      skip(); if (text[i] !== '"') return fail('expected an object key')
      const key = string(); if (!key.ok) return key
      if (seen.has(key.value)) return fail(`duplicate key "${key.value}"`)
      seen.add(key.value); skip(); if (text[i++] !== ':') return fail('expected ":" after object key')
      const child = value(depth + 1); if (!child.ok) return child
      out[key.value] = child.value; skip()
      if (text[i] === '}') { i++; return { ok: true, value: out } }
      if (text[i++] !== ',') return fail('expected "," or "}" in object')
    }
    return fail('unterminated object')
  }
  function array(depth) {
    i++; const out = []; skip()
    if (text[i] === ']') { i++; return { ok: true, value: out } }
    while (i < text.length) {
      const child = value(depth + 1); if (!child.ok) return child
      out.push(child.value); skip()
      if (text[i] === ']') { i++; return { ok: true, value: out } }
      if (text[i++] !== ',') return fail('expected "," or "]" in array')
    }
    return fail('unterminated array')
  }
  skip(); if (i >= text.length) return fail('empty file')
  const result = value(1); if (!result.ok) return result
  skip(); return i === text.length ? result : fail('trailing data after the JSON value')
}

function validateEntries(entries) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return { ok: false, reason: 'entries must be a flat object' }
  const keys = Object.keys(entries)
  if (!keys.length) return { ok: false, reason: 'entries must contain at least one pair' }
  if (keys.length > VOCAB_MAX_ENTRIES) return { ok: false, reason: `more than ${VOCAB_MAX_ENTRIES} entries` }
  const out = Object.create(null)
  for (const key of keys) {
    if (UNSAFE_KEYS.has(key) || !key || key.length > VOCAB_MAX_KEY_LENGTH || CONTROL_CHARACTERS.test(key)) return { ok: false, reason: `invalid entry key "${key}"` }
    if (typeof entries[key] !== 'string' || entries[key].length > VOCAB_MAX_VALUE_LENGTH || CONTROL_CHARACTERS.test(entries[key])) return { ok: false, reason: `invalid replacement for "${key}"` }
    out[key] = entries[key]
  }
  return { ok: true, entries: out, entryCount: keys.length }
}

export function validateVocabularyJson(text) {
  const raw = String(text || '')
  if (bytes(raw) > VOCAB_MAX_FILE_BYTES) return { ok: false, reason: `the file is over the ${VOCAB_MAX_FILE_BYTES}-byte limit` }
  const scanned = scanJson(raw)
  if (!scanned.ok) return scanned
  const root = scanned.value
  if (!root || typeof root !== 'object' || Array.isArray(root)) return { ok: false, reason: 'the top level must be a JSON object' }
  const keys = Object.keys(root)
  if (keys.some((key) => UNSAFE_KEYS.has(key))) return { ok: false, reason: 'an unsafe top-level key was found' }
  if (root.version !== VOCAB_SCHEMA_VERSION) return { ok: false, reason: `schema version must be exactly ${VOCAB_SCHEMA_VERSION}` }
  if (keys.some((key) => key !== 'version' && key !== 'entries')) return { ok: false, reason: 'unknown top-level field' }
  return validateEntries(root.entries)
}

export function validateVocabularyCacheJson(text) {
  const raw = String(text || '')
  if (bytes(raw) > VOCAB_MAX_FILE_BYTES) return { ok: false, reason: 'cached vocabulary exceeds the file-size limit' }
  const scanned = scanJson(raw)
  if (!scanned.ok) return scanned
  const root = scanned.value
  if (!root || typeof root !== 'object' || Array.isArray(root)) return { ok: false, reason: 'the cache must be a JSON object' }
  const keys = Object.keys(root)
  if (keys.some((key) => UNSAFE_KEYS.has(key))) return { ok: false, reason: 'an unsafe cache key was found' }
  if (keys.some((key) => !['version', 'entries', 'entryCount', 'savedAt'].includes(key))) return { ok: false, reason: 'unknown cache field' }
  if (root.version !== VOCAB_SCHEMA_VERSION || !Number.isInteger(root.entryCount) || typeof root.savedAt !== 'number' || !Number.isFinite(root.savedAt)) {
    return { ok: false, reason: 'invalid cache envelope' }
  }
  const entries = validateEntries(root.entries)
  if (!entries.ok || entries.entryCount !== root.entryCount) return { ok: false, reason: 'cache count does not match entries' }
  return { ok: true, cache: { version: VOCAB_SCHEMA_VERSION, entries: entries.entries, entryCount: entries.entryCount, savedAt: root.savedAt } }
}

export function isFreshVocabularyCache(savedAt, now = Date.now()) {
  return savedAt > 0 && now - savedAt <= VOCAB_CACHE_MAX_AGE_MS && savedAt <= now + 60000
}

// Kept as a named compatibility export for the feature module. It now accepts JSON text only.
export const validateVocabularyText = validateVocabularyJson
