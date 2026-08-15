import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore, makeMatcher } from './store.js'

describe('Pages playground store persistence', () => {
  let values
  let storage

  beforeEach(() => {
    values = new Map()
    storage = {
      getItem: vi.fn((key) => values.get(key) ?? null),
      setItem: vi.fn((key, value) => values.set(key, value)),
    }
    vi.stubGlobal('localStorage', storage)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('persists an ordinary update to a durable key without requiring options', () => {
    const store = createStore()

    store.setState({ theme: 'night' })

    expect(storage.setItem).toHaveBeenCalledOnce()
    expect(JSON.parse(values.get('nodeterm-playground.v1')).theme).toBe('night')
    expect(createStore().state.theme).toBe('night')
  })

  it('keeps persist:false as the explicit opt-out', () => {
    const store = createStore()

    store.setState({ theme: 'night' }, { persist: false })

    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('does not write when a patch only changes visit-local state', () => {
    const store = createStore()

    store.setState({ qGlobal: 'har gow' })

    expect(storage.setItem).not.toHaveBeenCalled()
  })
})

describe('Pages playground search matcher', () => {
  function matcher(flags, pattern = 'a') {
    return makeMatcher(
      { rxOn: { field: true }, rxFlags: { field: flags } },
      'field',
      pattern,
    )
  }

  it('is repeatable with the global flag', () => {
    const matches = matcher('gi')

    expect([matches('alpha'), matches('alpha'), matches('alpha')]).toEqual([true, true, true])
  })

  it('does not leak global lastIndex from one row into the next', () => {
    const matches = matcher('g')

    expect([matches('a'), matches('a'), matches('beta'), matches('a')]).toEqual([
      true,
      true,
      true,
      true,
    ])
  })

  it('is repeatable with the sticky flag while preserving start-only matching', () => {
    const matches = matcher('y')

    expect([matches('alpha'), matches('alpha'), matches('beta'), matches('alpha')]).toEqual([
      true,
      true,
      false,
      true,
    ])
  })
})
