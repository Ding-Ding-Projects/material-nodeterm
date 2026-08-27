import test from 'node:test'
import assert from 'node:assert/strict'
import { isFreshVocabularyCache, validateVocabularyCacheJson, validateVocabularyJson, VOCAB_CACHE_MAX_AGE_MS } from './vocabulary-state.js'
import { shapeCopy, shapeTitle } from './i18n.js'
import { createStore } from '../core/store.js'
import { render } from '../core/render.js'
import { notify, registerListRoom, toast } from '../core/engine.js'
import { DIM_SUM_TOAST_OWNERSHIP, registerDimSum } from '../features/dimsum.js'
import { datasetRecords } from '../features/exports.js'
import { handleVocabularyFileChange, readVocabularyFile, registerVocabulary } from '../features/vocabulary.js'

function storageFixture(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) }
  }
}

function cacheJson(entries, savedAt = Date.now()) {
  return JSON.stringify({ version: 1, entries, entryCount: Object.keys(entries).length, savedAt })
}

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

test('store cache state reaches the real home renderer and survives recreation', () => {
  const original = globalThis.localStorage
  const storage = storageFixture({
    'nodeterm-playground.vocabulary.v1': cacheJson({ 'Your terminals are': 'Your shell boxes are' })
  })
  globalThis.localStorage = storage
  try {
    const first = createStore()
    first.state.view = 'room'
    first.state.sec = 'home'
    const mapped = render(first)
    assert.match(mapped, /Your shell boxes are/)
    assert.doesNotMatch(mapped, />Your terminals are<br \/>/)

    const recreated = createStore()
    recreated.state.view = 'room'
    recreated.state.sec = 'home'
    assert.match(render(recreated), /Your shell boxes are/)
  } finally {
    if (original === undefined) delete globalThis.localStorage
    else globalThis.localStorage = original
  }
})

test('invalid and stale cache removal restores original rendered copy', () => {
  const original = globalThis.localStorage
  const storage = storageFixture({
    'nodeterm-playground.vocabulary.v1': cacheJson({ 'Your terminals are': 'Your shell boxes are' })
  })
  globalThis.localStorage = storage
  try {
    const loaded = createStore()
    loaded.state.view = 'room'
    loaded.state.sec = 'home'
    assert.match(render(loaded), /Your shell boxes are/)

    storage.setItem('nodeterm-playground.vocabulary.v1', '{"version":1,"entries":{"Your terminals are":"broken"},"entryCount":2,"savedAt":1}')
    const invalid = createStore()
    invalid.state.view = 'room'
    invalid.state.sec = 'home'
    assert.equal(invalid.state.vocabStatus, 'invalid')
    assert.doesNotMatch(render(invalid), /Your shell boxes are/)
    assert.match(render(invalid), />Your terminals are<br \/>/)

    storage.setItem('nodeterm-playground.vocabulary.v1', cacheJson({ 'Your terminals are': 'stale boxes' }, Date.now() - VOCAB_CACHE_MAX_AGE_MS - 1))
    const stale = createStore()
    stale.state.view = 'room'
    stale.state.sec = 'home'
    assert.equal(stale.state.vocabStatus, 'invalid')
    assert.doesNotMatch(render(stale), /stale boxes/)

    storage.removeItem('nodeterm-playground.vocabulary.v1')
    const removed = createStore()
    removed.state.view = 'room'
    removed.state.sec = 'home'
    assert.equal(removed.state.vocabStatus, 'no-file')
    assert.doesNotMatch(render(removed), /Your shell boxes are/)
  } finally {
    if (original === undefined) delete globalThis.localStorage
    else globalThis.localStorage = original
  }
})

test('School mode suppresses the mapped copy and the vocabulary settings card in full render', () => {
  const original = globalThis.localStorage
  globalThis.localStorage = storageFixture({
    'nodeterm-playground.vocabulary.v1': cacheJson({ 'Your terminals are': 'Your shell boxes are' })
  })
  try {
    const store = createStore()
    registerVocabulary(store, {}, () => {}, () => {})
    store.state.view = 'room'
    store.state.sec = 'settings'
    store.state.school = true
    store.state.schoolHydrated = true
    const schoolSettings = render(store)
    assert.doesNotMatch(schoolSettings, /Your shell boxes are/)
    assert.doesNotMatch(schoolSettings, /Vocabulary JSON file/)

    store.state.school = false
    const normalSettings = render(store)
    assert.match(normalSettings, /Vocabulary JSON file/)
  } finally {
    if (original === undefined) delete globalThis.localStorage
    else globalThis.localStorage = original
  }
})

test('rejected replacement preserves the active memory and cache and exposes storage failure', () => {
  const original = globalThis.localStorage
  const storage = storageFixture({
    'nodeterm-playground.vocabulary.v1': cacheJson({ terminal: 'shell box' })
  })
  globalThis.localStorage = storage
  try {
    const store = createStore()
    let binding
    registerVocabulary(store, {}, () => {}, (id, handler) => { if (id === 'vocab-file') binding = handler })
    const save = (patch) => store.setState(patch, { persist: false })
    const h = { save, toast: () => {} }
    assert.equal(typeof binding, 'function')
    const previousCache = storage.getItem('nodeterm-playground.vocabulary.v1')
    binding(store.state, '', '{"version":1,"entries":{"terminal":"new box"},"entryCount":2,"savedAt":1}', h)
    assert.equal(store.state.vocabEntries.terminal, 'shell box')
    assert.equal(storage.getItem('nodeterm-playground.vocabulary.v1'), previousCache)
    store.state.view = 'room'
    store.state.sec = 'settings'
    assert.match(render(store), /currently loaded file remains active/)

    globalThis.localStorage = {
      getItem: storage.getItem,
      setItem() { throw new Error('quota exceeded') },
      removeItem: storage.removeItem
    }
    binding(store.state, '', '{"version":1,"entries":{"terminal":"new box"}}', h)
    assert.equal(store.state.vocabEntries.terminal, 'new box')
    assert.match(store.state.vocabError, /storage could not save/)
    assert.match(render(store), /storage could not save/)
  } finally {
    if (original === undefined) delete globalThis.localStorage
    else globalThis.localStorage = original
  }
})

test('file handler exposes a rejected read instead of claiming an upload', async () => {
  await assert.rejects(
    readVocabularyFile({ text: () => Promise.reject(new Error('read failed')) }),
    /read failed/
  )
})

test('delegated file change resets the picker, reports size/read errors, and rerenders a valid upload', async () => {
  const original = globalThis.localStorage
  const storage = storageFixture()
  globalThis.localStorage = storage
  try {
    const store = createStore()
    let binding
    registerVocabulary(store, {}, () => {}, (id, handler) => { if (id === 'vocab-file') binding = handler })
    const save = (patch) => store.setState(patch, { persist: false })
    const h = { save, toast: () => {} }
    const events = []
    const oversized = { files: [{ size: 999999, text: async () => '{}' }], value: 'oversized.json' }
    assert.equal(await handleVocabularyFileChange(oversized, {
      onTooLarge: (size) => events.push(['too-large', size]),
      onText: () => events.push(['text']),
      onReadError: () => events.push(['read-error'])
    }), 'too-large')
    assert.equal(oversized.value, '')
    assert.deepEqual(events, [['too-large', 999999]])

    const unreadable = { files: [{ size: 3, text: () => Promise.reject(new Error('read failed')) }], value: 'broken.json' }
    assert.equal(await handleVocabularyFileChange(unreadable, {
      onTooLarge: () => events.push(['too-large-again']),
      onText: () => events.push(['text-again']),
      onReadError: () => events.push(['read-error'])
    }), 'read-error')
    assert.equal(unreadable.value, '')
    assert.deepEqual(events, [['too-large', 999999], ['read-error']])

    const valid = { files: [{ size: 40, text: async () => '{"version":1,"entries":{"terminal":"shell box"}}' }], value: 'valid.json' }
    assert.equal(await handleVocabularyFileChange(valid, {
      onTooLarge: () => events.push(['too-large-valid']),
      onText: (text) => binding(store.state, '', text, h),
      onReadError: () => events.push(['read-error-valid'])
    }), 'loaded')
    assert.equal(valid.value, '')
    assert.equal(store.state.vocabEntries.terminal, 'shell box')
    store.state.view = 'room'
    store.state.sec = 'home'
    assert.match(render(store), /shell box/)
  } finally {
    if (original === undefined) delete globalThis.localStorage
    else globalThis.localStorage = original
  }
})

test('the real renderer maps authored strings and preserves exact facts', () => {
  const original = globalThis.localStorage
  globalThis.localStorage = storageFixture()
  try {
    const store = createStore()
    store.state.vocabEntries = {
      Jump: 'JUMPED',
      Changelog: 'CHANGES',
      items: 'THINGS',
      nodeterm: 'WRONG BRAND',
      GitHub: 'WRONG FORGE',
      'BUSL-1.1 licensed · fork of': 'WRONG LICENSE',
      'Magic jump box — Ctrl+Shift+F': 'WRONG SHORTCUT',
      'Windows x64 · unsigned Squirrel installer': 'WRONG INSTALLER'
    }
    store.state.vocabStatus = 'loaded'
    store.state.view = 'hall'
    const hall = render(store)
    // Authored labels are intentionally replaceable in the user-visible renderer.
    assert.match(hall, />✨ Jump</)
    // Brand, command, shortcut and URL-adjacent facts stay byte-identical.
    assert.match(hall, />nodeterm school</)
    assert.match(hall, /Magic jump box — Ctrl\+Shift\+F/)
    assert.match(hall, /Windows x64 · unsigned Squirrel installer/)
    assert.match(hall, /<span class="brand__name">nodeterm school<\/span>/)
    assert.match(hall, /title="Magic jump box — Ctrl\+Shift\+F"/)
    assert.match(hall, /Windows x64 · unsigned Squirrel installer/)

    store.state.view = 'room'
    store.state.sec = 'notes'
    const room = render(store)
    assert.match(room, />CHANGES</)
    assert.match(room, /BUSL-1\.1 licensed · fork of/)
    assert.match(room, />GitHub</)
    assert.match(room, /BUSL-1\.1 licensed · fork of/)
    assert.match(room, />GitHub</)
  } finally {
    if (original === undefined) delete globalThis.localStorage
    else globalThis.localStorage = original
  }
})

test('Day Teet Hui toasts map authored title, body, and sub fields while facts stay exact', () => {
  const original = globalThis.localStorage
  globalThis.localStorage = storageFixture()
  try {
    const store = createStore()
    store.state.vocabEntries = { 'friendly title': 'mapped title', 'friendly body': 'mapped body', 'friendly sub': 'mapped sub', 'provider body': 'wrong fact' }
    toast(store, 'ℹ️', 'friendly title', 'provider body', 'friendly sub', undefined, {
      titleKind: 'authored',
      bodyKind: 'fact',
      subKind: 'authored'
    })
    store.state.view = 'hall'
    const output = render(store)
    assert.match(output, /mapped title/)
    assert.match(output, /provider body/)
    assert.match(output, /mapped sub/)
    assert.doesNotMatch(output, /wrong fact/)
    assert.throws(() => toast(store, 'ℹ️', 'title', 'body', '', undefined, { titleKind: 'unknown' }), /ownership/)
  } finally {
    if (original === undefined) delete globalThis.localStorage
    else globalThis.localStorage = original
  }
})

test('dim sum surprise marks its authored trolley title separately from factual dish fields', () => {
  const store = createStore()
  let another
  registerDimSum(store, {}, (id, handler) => { if (id === 'dish-another') another = handler }, () => {})
  const calls = []
  another(store.state, '', null, { toast: (...args) => calls.push(args) })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0][4], DIM_SUM_TOAST_OWNERSHIP)
  assert.equal(calls[0][4].titleKind, 'authored')
  assert.equal(calls[0][4].bodyKind, 'fact')
  assert.equal(calls[0][4].subKind, 'fact')
})

test('persistent Day Teet Hui messages retain ownership through render, search, and export', () => {
  const original = globalThis.localStorage
  globalThis.localStorage = storageFixture()
  try {
    const store = createStore()
    store.state.vocabEntries = { terminal: 'shell box' }
    notify(store, 'Open terminal', 'fatal: C:/workspace/terminal', 'fact-check', { titleKind: 'authored', bodyKind: 'fact' })
    const saved = store.state.notes[0]
    assert.equal(saved.titleKind, 'authored')
    assert.equal(saved.bodyKind, 'fact')
    registerListRoom('notes', { kind: 'list', getRows: (s) => s.notes.map((n) => ({ ...n, meta: '', right: '' })) })
    store.state.view = 'room'
    store.state.sec = 'notes'
    assert.match(render(store), /Open shell box/)
    assert.match(render(store), /fatal: C:\/workspace\/terminal/)
    store.state.qSec = 'shell box'
    assert.match(render(store), /Open shell box/)
    const exported = datasetRecords(store, 'notes')[0]
    assert.deepEqual(exported, {
      title: 'Open terminal',
      body: 'fatal: C:/workspace/terminal',
      titleKind: 'authored',
      bodyKind: 'fact',
      tag: 'fact-check',
      when: saved.when
    })
  } finally {
    if (original === undefined) delete globalThis.localStorage
    else globalThis.localStorage = original
  }
})
