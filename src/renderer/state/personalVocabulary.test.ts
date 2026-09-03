// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePersonalVocabulary } from './personalVocabulary'

const CACHE_KEY = 'nodeterm.personalVocabulary.v1'

function resetStore(): void {
  usePersonalVocabulary.setState({
    status: 'no-file',
    entries: {},
    entryCount: 0,
    loadedAt: null,
    lastError: null
  })
}

describe('personal vocabulary cache validation', () => {
  beforeEach(() => {
    localStorage.clear()
    resetStore()
  })

  it('rejects a hand-edited cache that bypasses the entries ownership boundary', () => {
    localStorage.setItem(
      CACHE_KEY,
      '{"version":1,"entries":{"__proto__":"poison"},"entryCount":1,"savedAt":123}'
    )

    usePersonalVocabulary.getState().hydrate()

    expect(usePersonalVocabulary.getState()).toMatchObject({
      status: 'no-file',
      entryCount: 0,
      loadedAt: null
    })
  })

  it('rehydrates a valid cache through the same validator and restores a safe dictionary', () => {
    const savedAt = Date.now()
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ version: 1, entries: { 'source phrase': 'replacement phrase' }, entryCount: 1, savedAt })
    )

    usePersonalVocabulary.getState().hydrate()

    const state = usePersonalVocabulary.getState()
    expect(state).toMatchObject({ status: 'loaded', entryCount: 1, loadedAt: savedAt })
    expect(Object.getPrototypeOf(state.entries)).toBeNull()
    expect(state.entries['source phrase']).toBe('replacement phrase')
  })

  it('rejects a cache whose entryCount was edited independently of its entries', () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ version: 1, entries: { terminal: 'shell box' }, entryCount: 999, savedAt: Date.now() })
    )

    usePersonalVocabulary.getState().hydrate()

    expect(usePersonalVocabulary.getState()).toMatchObject({ status: 'no-file', entryCount: 0 })
  })

  it('keeps the prior memory and cache when a replacement upload is rejected', () => {
    const first = usePersonalVocabulary.getState().upload(
      '{"schemaVersion":1,"entries":{"terminal":"shell box"}}'
    )
    expect(first).toEqual({ ok: true, entryCount: 1 })
    const second = usePersonalVocabulary.getState().upload(
      '{"schemaVersion":1,"entries":{"terminal":42}}'
    )
    expect(second.ok).toBe(false)
    expect(usePersonalVocabulary.getState().entries.terminal).toBe('shell box')
    expect(JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}')).toMatchObject({
      entries: { terminal: 'shell box' },
      entryCount: 1
    })
  })

  it('rejects the legacy upload spelling without disturbing a valid cache', () => {
    expect(usePersonalVocabulary.getState().upload(
      '{"schemaVersion":1,"entries":{"terminal":"shell box"}}'
    )).toEqual({ ok: true, entryCount: 1 })
    const previousCache = localStorage.getItem(CACHE_KEY)

    const legacy = usePersonalVocabulary.getState().upload(
      '{"version":1,"entries":{"terminal":"legacy box"}}'
    )

    expect(legacy.ok).toBe(false)
    if (!legacy.ok) expect(legacy.error).toMatch(/schema version/)
    expect(usePersonalVocabulary.getState().entries.terminal).toBe('shell box')
    expect(localStorage.getItem(CACHE_KEY)).toBe(previousCache)
  })

  it('keeps the accepted upload in memory when browser storage is blocked', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    try {
      const result = usePersonalVocabulary.getState().upload(
        '{"schemaVersion":1,"entries":{"terminal":"shell box"}}'
      )
      expect(result).toEqual({ ok: true, entryCount: 1 })
      expect(usePersonalVocabulary.getState()).toMatchObject({ status: 'loaded', entryCount: 1 })
      expect(usePersonalVocabulary.getState().entries.terminal).toBe('shell box')
    } finally {
      setItem.mockRestore()
    }
  })

  it.each([
    Date.now() - 31 * 24 * 60 * 60 * 1000,
    Date.now() + 24 * 60 * 60 * 1000,
    0
  ])('rejects a cache outside the savedAt freshness window: %s', (savedAt) => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ version: 1, entries: { terminal: 'shell box' }, entryCount: 1, savedAt })
    )
    usePersonalVocabulary.getState().hydrate()
    expect(usePersonalVocabulary.getState()).toMatchObject({ status: 'no-file', entryCount: 0 })
  })

  it.each([
    ['missing', null],
    ['corrupt', '{'],
    ['stale', JSON.stringify({ version: 1, entries: { terminal: 'shell box' }, entryCount: 1, savedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 })],
    ['future', JSON.stringify({ version: 1, entries: { terminal: 'shell box' }, entryCount: 1, savedAt: Date.now() + 2 * 24 * 60 * 60 * 1000 })],
    ['unsupported', JSON.stringify({ version: 99, entries: { terminal: 'shell box' }, entryCount: 1, savedAt: Date.now() })]
  ] as const)('clears the prior live dictionary and invalid storage for a %s cache', (_kind, raw) => {
    expect(usePersonalVocabulary.getState().upload(
      '{"schemaVersion":1,"entries":{"terminal":"shell box"}}'
    )).toEqual({ ok: true, entryCount: 1 })

    if (raw === null) localStorage.removeItem(CACHE_KEY)
    else localStorage.setItem(CACHE_KEY, raw)

    usePersonalVocabulary.getState().hydrate()

    expect(usePersonalVocabulary.getState()).toMatchObject({
      status: 'no-file',
      entries: {},
      entryCount: 0,
      loadedAt: null,
      lastError: null
    })
    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
  })
})
