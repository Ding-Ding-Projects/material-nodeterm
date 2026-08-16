// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
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
    localStorage.setItem(
      CACHE_KEY,
      '{"version":1,"entries":{"飲茶 🫖":"yum cha"},"entryCount":999,"savedAt":456}'
    )

    usePersonalVocabulary.getState().hydrate()

    const state = usePersonalVocabulary.getState()
    expect(state).toMatchObject({ status: 'loaded', entryCount: 1, loadedAt: 456 })
    expect(Object.getPrototypeOf(state.entries)).toBeNull()
    expect(state.entries['飲茶 🫖']).toBe('yum cha')
  })
})
