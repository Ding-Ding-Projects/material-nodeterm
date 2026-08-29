/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, getRoom, log, menuDefs, registerListRoom, removeHistoryEntries, save, undoEntry } from './engine.js'
import { render } from './render.js'
import { createStore } from './store.js'
import { registerAuthenticator } from '../features/authenticator.js'
import { registerAboutYou } from '../features/about-you.js'
import { registerNarrator } from '../features/narrator.js'
import { datasetRecords } from '../features/exports.js'
import { EXPORT_FORMATS, emit } from '../shared/exportFormats.js'

describe('Pages playground time machine', () => {
  let values
  let storage

  beforeEach(() => {
    vi.useFakeTimers()
    values = new Map()
    values.set('nodeterm-playground.v2', JSON.stringify({ funnySchemaVersion: 2 }))
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

  it('restores the actual prior state, reapplies appearance, and makes the restore reversible', () => {
    const store = createStore()
    save(store, { theme: 'night', accent: '#123456', bigText: true }, 'Look changed')
    applyTheme(store.state)
    expect(document.documentElement.getAttribute('data-theme')).toBe('night')
    expect(document.documentElement.style.fontSize).toBe('19px')

    const change = store.state.history[0]
    expect(change.undo).toEqual({ theme: 'day', accent: '#ffd93d', bigText: false })
    expect(undoEntry(store, change.id)).toBe(true)
    expect(store.state.theme).toBe('day')
    expect(store.state.accent).toBe('#ffd93d')
    expect(store.state.bigText).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('day')
    expect(document.documentElement.style.fontSize).toBe('16px')
    expect(document.body.style.fontSize).toBe('15px')
    expect(store.state.history.some((entry) => entry.id === change.id)).toBe(false)

    const restore = store.state.history[0]
    expect(restore.title).toBe('Put back: Look changed')
    expect(restore.undo).toEqual({ theme: 'night', accent: '#123456', bigText: true })
    expect(undoEntry(store, restore.id)).toBe(true)
    expect(store.state.theme).toBe('night')
    expect(store.state.accent).toBe('#123456')
    expect(document.documentElement.getAttribute('data-theme')).toBe('night')
    expect(document.documentElement.style.fontSize).toBe('19px')

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

  it('keeps authenticator secrets out of undo snapshots and their persisted history slice', () => {
    const store = createStore()
    store.setState({
      auth: [{ id: 'a1', label: 'First', secret: 'FIRSTSECRET2345' }],
      addA: 'Account',
      addB: 'SECONDSECRET2345',
    })

    save(
      store,
      {
        auth: store.state.auth.concat([{ id: 'a2', label: 'Second', secret: 'SECONDSECRET2345' }]),
        addA: '',
        addB: '',
      },
      'Added a code',
    )

    expect(store.state.history[0].undo).toBeUndefined()
    expect(store.state.history[0].body).toContain('credential')
    const persisted = JSON.parse(values.get('nodeterm-playground.v2'))
    expect(JSON.stringify(persisted.history)).not.toContain('FIRSTSECRET2345')
    expect(JSON.stringify(persisted.history)).not.toContain('SECONDSECRET2345')
    // Active records remain canonical and functional; only their hidden historical duplicates go.
    expect(persisted.auth.map((entry) => entry.secret)).toEqual([
      'FIRSTSECRET2345',
      'SECONDSECRET2345',
    ])
  })

  it('migrates legacy secret-bearing undo rows immediately without touching active authenticators', () => {
    values.delete('nodeterm-playground.v2')
    values.set('nodeterm-playground.v1', JSON.stringify({
      auth: [{ id: 'a1', label: 'Live', secret: 'LIVESECRET234567' }],
      history: [{
        id: 'legacy', title: 'Legacy', body: '', when: new Date().toISOString(), tag: 'change',
        undo: {
          auth: [{ id: 'old', label: 'Old', secret: 'OLDSECRET234567' }],
          locks: { look: 'HASH' },
          schoolPin: '1234',
          theme: 'night',
        },
      }],
    }))

    const store = createStore()
    expect(store.state.auth[0].secret).toBe('LIVESECRET234567')
    expect(store.state.history[0].undo).toEqual({ theme: 'night' })
    const rewritten = JSON.parse(values.get('nodeterm-playground.v2'))
    expect(JSON.stringify(rewritten.history)).not.toContain('OLDSECRET234567')
    expect(JSON.stringify(rewritten.history)).not.toContain('schoolPin')
    expect(rewritten.auth[0].secret).toBe('LIVESECRET234567')
  })

  it('projects all settings/history export formats without undo or authenticator secrets', () => {
    const store = createStore()
    store.state.auth = [{ id: 'a1', label: 'Live', secret: 'EXPORTSECRET2345' }]
    store.state.history = [{
      id: 'h1', title: 'Safe event', body: 'No credential here', when: new Date().toISOString(),
      tag: 'change', undo: { auth: [{ secret: 'HISTORYSECRET2345' }] },
    }]

    for (const dataset of ['settings', 'history']) {
      const rows = datasetRecords(store, dataset)
      for (const format of EXPORT_FORMATS) {
        const output = emit(rows, format.id)
        expect(output).not.toContain('EXPORTSECRET2345')
        expect(output).not.toContain('HISTORYSECRET2345')
      }
    }
  })

  it('carries canUndo through real HTML data and exposes the per-row restore action', () => {
    const store = createStore()
    save(store, { theme: 'night' }, 'Theme changed')
    const reversible = store.state.history[0]
    store.state.view = 'room'
    store.state.sec = 'history'
    // Register the history row contract exactly as main.js does, then send it through HTML parsing.
    const historyRoom = {
      getRows: (s) => s.history.map((h) => ({
        id: h.id, title: h.title, body: h.body, tag: h.tag, meta: '', right: '', canUndo: !!h.undo,
      })),
      emptyText: 'Nothing logged yet.',
    }
    registerListRoom('history', historyRoom)
    const root = document.createElement('div')
    root.innerHTML = render(store)
    const button = root.querySelector(`[data-id="${reversible.id}"]`)
    const payload = JSON.parse(button.dataset.menuExtra)
    expect(payload.canUndo).toBe(true)
    store.setState({ menuKind: 'row', menuExtra: payload }, { persist: false })
    const defs = menuDefs(store, {
      enterDoor() {}, toggleTheme() {}, goRoom() {}, copy() {}, speak() {}, togglePick() {}, removeRows() {},
    })
    expect(defs.map((item) => item.label)).toContain('Put this saved change back')
  })

  it('records authenticator deletion honestly without retaining the deleted secret', () => {
    const store = createStore()
    store.setState({ auth: [{ id: 'a1', label: 'Delete me', secret: 'DELETESECRET2345' }] })
    registerAuthenticator(store, {}, () => {}, () => {})
    const room = getRoom('auth')

    store.setState({
      sec: 'auth', menuKind: 'row',
      menuExtra: { id: 'a1', title: 'Delete me', body: 'Changes every 30 seconds.' },
    }, { persist: false })
    const menu = menuDefs(store, {
      enterDoor() {}, toggleTheme() {}, goRoom() {}, copy() {}, speak() {}, togglePick() {},
      removeRows() {},
    })
    menu.find((item) => item.label === 'Throw this one away').run()
    expect(store.state.confirm.body).toContain('TOTP secrets')
    expect(store.state.confirm.body).toContain('cannot be put back')

    room.remove(store, ['a1'])

    expect(store.state.auth).toEqual([])
    expect(store.state.history[0].title).toContain('Removed 1 authenticator')
    expect(store.state.history[0].undo).toBeUndefined()
    expect(store.state.history[0].body).toContain('cannot be put back')
    expect(JSON.stringify(JSON.parse(values.get('nodeterm-playground.v2')).history)).not.toContain(
      'DELETESECRET2345',
    )
    expect(room.removeWarning).toContain('cannot be put back')
  })

  it('records nickname and narrator-rate changes through their real feature bindings', () => {
    const store = createStore()
    const bindings = new Map()
    const registerBinding = (name, fn) => bindings.set(name, fn)
    const registerAction = () => {}
    const helpers = { save: (patch, note) => save(store, patch, note) }
    registerAboutYou(store, {}, registerAction, registerBinding)
    registerNarrator(store, {}, registerAction, registerBinding)

    bindings.get('about-nick')(store, 'you', 'Captain Socks', helpers)
    bindings.get('narrator-rate')(store, 'narrator', '5', helpers)

    expect(store.state.nick).toBe('Captain Socks')
    expect(store.state.rate).toBe(5)
    expect(store.state.history.slice(0, 2).map((entry) => entry.title)).toEqual([
      'Narrator speed set to 5',
      'Nickname changed',
    ])
  })

  it('persists deletion even when the last history row is removed', () => {
    const store = createStore()
    const ids = store.state.history.map((entry) => entry.id)

    removeHistoryEntries(store, ids)

    expect(store.state.history).toEqual([])
    expect(JSON.parse(values.get('nodeterm-playground.v2')).history).toEqual([])
    expect(createStore().state.history).toEqual([])
  })
})
