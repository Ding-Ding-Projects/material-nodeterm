import test from 'node:test'
import assert from 'node:assert/strict'
import { isFreshVocabularyCache, validateVocabularyCacheJson, validateVocabularyJson, VOCAB_CACHE_MAX_AGE_MS } from './vocabulary-state.js'
import { shapeCopy, shapeTitle } from './i18n.js'
import { createStore } from '../core/store.js'

test('accepts the shared versioned JSON shape', () => {
  const result = validateVocabularyJson('{"version":1,"entries":{"terminal":"shell box"}}')
  assert.equal(result.ok, true)
  assert.equal(result.entryCount, 1)
})

test('rejects duplicate keys before parsing can discard one', () => {
  const result = validateVocabularyJson('{"version":1,"entries":{"terminal":"a","terminal":"b"}}')
  assert.equal(result.ok, false)
  assert.match(result.reason, /duplicate key/)
})

test('rejects empty entries and the former free-text format', () => {
  assert.equal(validateVocabularyJson('{"version":1,"entries":{}}').ok, false)
  assert.equal(validateVocabularyJson('terminal=shell box').ok, false)
})

test('rejects escaped control characters that could affect a terminal marker', () => {
  assert.equal(validateVocabularyJson('{"version":1,"entries":{"terminal":"line\\u001b[31m"}}').ok, false)
  assert.equal(validateVocabularyJson('{"version":1,"entries":{"term\\nkey":"safe"}}').ok, false)
})

test('validates cache metadata independently and checks its count', () => {
  const good = validateVocabularyCacheJson(
    '{"version":1,"entries":{"terminal":"shell box"},"entryCount":1,"savedAt":1700000000000}'
  )
  assert.equal(good.ok, true)
  assert.equal(validateVocabularyCacheJson(
    '{"version":1,"entries":{"terminal":"shell box"},"entryCount":2,"savedAt":1700000000000}'
  ).ok, false)
})

test('cache freshness is explicit at stale, future, zero, and boundary values', () => {
  const now = 1000000000000
  assert.equal(isFreshVocabularyCache(now - VOCAB_CACHE_MAX_AGE_MS, now), true)
  assert.equal(isFreshVocabularyCache(now - VOCAB_CACHE_MAX_AGE_MS - 1, now), false)
  assert.equal(isFreshVocabularyCache(now + 60000, now), true)
  assert.equal(isFreshVocabularyCache(now + 60001, now), false)
  assert.equal(isFreshVocabularyCache(0, now), false)
})

test('School mode suppresses vocabulary in both copy and title shaping', () => {
  const state = { school: true, schoolHydrated: true, vocabEntries: { terminal: 'shell box' } }
  assert.equal(shapeCopy(state, 'terminal'), 'terminal')
  assert.equal(shapeTitle(state, 'terminal'), 'terminal')
  assert.equal(shapeCopy({ ...state, school: false }, 'terminal'), 'shell box')
})

test('store reloads a valid cache and fails closed for blocked storage', () => {
  const original = globalThis.localStorage
  let cache = JSON.stringify({ version: 1, entries: { terminal: 'shell box' }, entryCount: 1, savedAt: Date.now() })
  globalThis.localStorage = {
    getItem: (key) => key === 'nodeterm-playground.vocabulary.v1' ? cache : null,
    setItem: () => {},
    removeItem: () => {}
  }
  try {
    const loaded = createStore()
    assert.equal(loaded.state.vocabEntries.terminal, 'shell box')
    cache = ''
    globalThis.localStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => {}, removeItem: () => {} }
    const blocked = createStore()
    assert.equal(blocked.state.vocabStatus, 'no-file')
  } finally {
    if (original === undefined) delete globalThis.localStorage
    else globalThis.localStorage = original
  }
})
