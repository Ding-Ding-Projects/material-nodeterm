import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { log, removeHistoryEntries, save, undoEntry } from './engine.js'
import { createStore } from './store.js'

describe('Pages playground time machine', () => {
  let values
  let storage

  beforeEach(() => {
    vi.useFakeTimers()
    values = new Map()
    storage = {
      getItem: vi.fn((key) => values.get(key) ?? null),
      setItem: vi.fn((key, value) => values.set(key, value)),
    }
    vi.stubGlobal('localStorage', storage)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('restores the actual prior state and makes the restore itself reversible', () => {
    const store = createStore()
    save(store, { theme: 'night', accent: '#123456' }, 'Look changed')

    const change = store.state.history[0]
    expect(change.undo).toEqual({ theme: 'day', accent: '#ffd93d' })
    expect(undoEntry(store, change.id)).toBe(true)
    expect(store.state.theme).toBe('day')
    expect(store.state.accent).toBe('#ffd93d')
    expect(store.state.history.some((entry) => entry.id === change.id)).toBe(false)

    const restore = store.state.history[0]
    expect(restore.title).toBe('Put back: Look changed')
    expect(restore.undo).toEqual({ theme: 'night', accent: '#123456' })
    expect(undoEntry(store, restore.id)).toBe(true)
    expect(store.state.theme).toBe('night')
    expect(store.state.accent).toBe('#123456')

    // This is the persisted browser runtime, not an in-memory-only claim.
    expect(createStore().state.theme).toBe('night')
  })

  it('marks event-only log rows as non-reversible instead of pretending to undo them', () => {
    const store = createStore()
    log(store, 'Exported settings.json')
    const event = store.state.history[0]
    const before = JSON.stringify(store.state.history)

    expect(event.undo).toBeUndefined()
    expect(undoEntry(store, event.id)).toBe(false)
    expect(JSON.stringify(store.state.history)).toBe(before)
    expect(store.state.toasts.at(-1)?.title).toBe('Log entry only')
  })

  it('snapshots only durable values, not transient form fields bundled into the save patch', () => {
    const store = createStore()
    store.setState({ addA: 'Account', addB: 'SECRET' }, { persist: false })

    save(
      store,
      { auth: [{ id: 'a1', label: 'Account', secret: 'SECRET' }], addA: '', addB: '' },
      'Added a code',
    )

    expect(store.state.history[0].undo).toEqual({ auth: [] })
  })

  it('persists deletion even when the last history row is removed', () => {
    const store = createStore()
    const ids = store.state.history.map((entry) => entry.id)

    removeHistoryEntries(store, ids)

    expect(store.state.history).toEqual([])
    expect(JSON.parse(values.get('nodeterm-playground.v1')).history).toEqual([])
    expect(createStore().state.history).toEqual([])
  })
})
