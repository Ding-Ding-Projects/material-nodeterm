/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  askConfirm,
  confirmRun,
  menuDefs,
  notify,
  openMenu,
  registerListRoom,
  save,
  toast,
  toggleLock,
} from './engine.js'
import {
  authoredPart,
  factPart,
  openSecretCheckDialog,
  ownedText,
  setInputDialogValue,
  submitInputDialog,
} from './input-dialog.js'
import { render } from './render.js'
import { createStore } from './store.js'
import { registerAdhdModes } from '../features/adhd-modes.js'
import { registerAppearance } from '../features/appearance.js'
import { registerNarrator } from '../features/narrator.js'
import { registerSchoolMode } from '../features/school-mode.js'
import { shapeCopy } from '../shared/i18n.js'

function storageFixture() {
  const values = new Map()
  return {
    values,
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    removeItem: vi.fn((key) => values.delete(key)),
  }
}

function featureHarness(store) {
  const actions = new Map()
  const bindings = new Map()
  const speak = vi.fn()
  const helpers = {
    save: (patch, note, ownership) => save(store, patch, note, ownership),
    toast: (icon, title, body, sub, ownership) => toast(store, icon, title, body, sub, undefined, ownership),
    notify: (title, body, tag, ownership) => notify(store, title, body, tag, ownership),
    speak,
    applyTheme: vi.fn(),
    download: vi.fn(),
  }
  return {
    actions,
    bindings,
    speak,
    helpers,
    registerAction: (name, fn) => actions.set(name, fn),
    registerBinding: (name, fn) => bindings.set(name, fn),
  }
}

function rendered(store) {
  const root = document.createElement('div')
  root.innerHTML = render(store)
  return root
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('localStorage', storageFixture())
  vi.stubGlobal('prompt', vi.fn(() => { throw new Error('native prompt used') }))
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('site-owned input routes', () => {
  it('uses a bounded multiline dialog for JSON and never maps or logs the pasted payload', async () => {
    const store = createStore()
    const h = featureHarness(store)
    registerAppearance(store, {}, h.registerAction, h.registerBinding)
    store.state.vocabEntries = {
      'Load a saved look': 'Mapped look title',
      'Look JSON': 'Mapped JSON label',
      'night': 'WRONG THEME',
      'private-value': 'WRONG PAYLOAD',
    }

    h.bindings.get('appearance-theme')(store, 'look', 'night', h.helpers)
    expect(ownedText(store.state, store.state.history[0].titleParts, shapeCopy)).toBe('Theme set to night')
    expect(ownedText(store.state, store.state.history[0].titleParts, shapeCopy)).not.toContain('WRONG THEME')

    h.actions.get('appearance-import')(store, 'look', null, h.helpers)
    expect(globalThis.prompt).not.toHaveBeenCalled()
    expect(store.state.inputDialog.kind).toBe('json')
    expect(store.state.inputDialog.maxLength).toBe(65536)

    let root = rendered(store)
    expect(root.querySelector('[role="dialog"] h3').textContent).toBe('Mapped look title')
    expect(root.querySelector('label').textContent).toBe('Mapped JSON label')

    const json = '{"theme":"night","private":"private-value"}'
    setInputDialogValue(store, json)
    root = rendered(store)
    expect(root.querySelector('textarea').value).toBe(json)
    expect(root.textContent).not.toContain('WRONG PAYLOAD')

    await submitInputDialog(store)
    expect(store.state.theme).toBe('night')
    expect(JSON.stringify(store.state.history)).not.toContain(json)
    expect(JSON.stringify(store.state.history)).not.toContain('private-value')
    expect(store.state.inputDialogValue).toBe('')
  })

  it('keeps user-authored next-action text exact in the owned text dialog', async () => {
    const store = createStore()
    const h = featureHarness(store)
    registerAdhdModes(store, {}, h.registerAction, h.registerBinding)
    store.state.adhdOneThing = true
    store.state.adhdOneThingText = 'Call Provider-X at 10:30'
    store.state.vocabEntries = {
      'What is the one thing right now?': 'Mapped next-action label',
      'Provider-X': 'WRONG PROVIDER',
      '10:30': 'WRONG TIME',
    }

    h.actions.get('adhd-one-thing')(store, 'adhd', null, h.helpers)
    const root = rendered(store)
    expect(root.querySelector('label').textContent).toBe('Mapped next-action label')
    expect(root.querySelector('[role="dialog"] input').value).toBe('Call Provider-X at 10:30')
    expect(root.textContent).not.toContain('WRONG PROVIDER')

    setInputDialogValue(store, 'Email Provider-Y at 11:45')
    await submitInputDialog(store)
    expect(store.state.adhdOneThingText).toBe('Email Provider-Y at 11:45')
    expect(JSON.stringify(store.state.history)).not.toContain('Provider-Y')
  })
})

describe('secure input and School mode boundaries', () => {
  it('hashes toy-lock secrets, keeps target ids exact, and never records the raw password', async () => {
    const store = createStore()
    const target = 'settings:C:/Provider-X'
    const password = 'private-value-42'
    store.state.vocabEntries = {
      'Pick a password for this box': 'Mapped password title',
      [target]: 'WRONG TARGET',
      [password]: 'WRONG SECRET',
    }

    toggleLock(store, target)
    setInputDialogValue(store, password)
    const root = rendered(store)
    expect(root.querySelector('[role="dialog"] h3').textContent).toBe('Mapped password title')
    expect(root.querySelector('[role="dialog"] input').type).toBe('password')
    expect(root.querySelector('[role="dialog"] input').value).toBe(password)
    expect(root.textContent).not.toContain('WRONG SECRET')

    await submitInputDialog(store)
    expect(store.state.locks[target]).toBeTruthy()
    expect(store.state.locks[target]).not.toContain(password)
    expect(JSON.stringify(store.state.history)).not.toContain(password)
    expect(JSON.stringify(store.state.notes)).not.toContain(password)
    expect(store.state.notes[0].body).toContain(target)
    expect(store.state.notes[0].bodyParts.find((part) => part.kind === 'fact').text).toBe(target)
  })

  it('checks a door secret through the reusable secure route without native prompt use', async () => {
    const store = createStore()
    const accepted = vi.fn()
    const rejected = vi.fn()
    const password = 'door-secret'
    const expectedHashStore = createStore()
    toggleLock(expectedHashStore, 'door')
    setInputDialogValue(expectedHashStore, password)
    await submitInputDialog(expectedHashStore)

    openSecretCheckDialog(store, {
      id: 'door-unlock-home',
      title: 'This door is locked',
      label: 'Door password',
      expectedHash: expectedHashStore.state.locks.door,
      onAccepted: accepted,
      onRejected: rejected,
    })
    setInputDialogValue(store, password)
    await submitInputDialog(store)

    expect(accepted).toHaveBeenCalledOnce()
    expect(rejected).not.toHaveBeenCalled()
    expect(globalThis.prompt).not.toHaveBeenCalled()
    expect(JSON.stringify(store.state.history)).not.toContain(password)
  })

  it('suppresses mapped copy while School mode is on and restores it only after PIN verification', async () => {
    const store = createStore()
    const h = featureHarness(store)
    registerSchoolMode(store, {}, h.registerAction, h.registerBinding)
    const pin = '2468-private'
    store.state.vocabEntries = {
      'Turn ': 'Mapped turn ',
      'Enter the PIN that was set when this mode was turned on.': 'MAPPED LOCKED COPY',
      'Your own settings came straight back.': 'MAPPED RESTORED COPY',
      'School mode': 'WRONG MODE NAME',
      [pin]: 'WRONG PIN',
    }

    h.actions.get('school-toggle')(store, 'school', null, h.helpers)
    setInputDialogValue(store, pin)
    await submitInputDialog(store)
    expect(store.state.school).toBe(true)
    expect(store.state.schoolPin).not.toContain(pin)
    expect(JSON.stringify(store.state.history)).not.toContain(pin)

    h.actions.get('school-toggle')(store, 'school', null, h.helpers)
    let root = rendered(store)
    expect(root.textContent).toContain('Enter the PIN that was set when this mode was turned on.')
    expect(root.textContent).not.toContain('MAPPED LOCKED COPY')
    expect(root.textContent).not.toContain('WRONG MODE NAME')
    setInputDialogValue(store, pin)
    await submitInputDialog(store)

    expect(store.state.school).toBe(false)
    root = rendered(store)
    expect(root.textContent).toContain('MAPPED RESTORED COPY')
    expect(root.textContent).toContain('School mode off')
    expect(root.textContent).not.toContain('WRONG MODE NAME')
    expect(globalThis.prompt).not.toHaveBeenCalled()
  })
})

describe('typed visible, accessible, menu, confirmation, and speech copy', () => {
  it('maps authored confirmation fragments while counts, paths, and confirmation words stay exact', () => {
    const store = createStore()
    const run = vi.fn()
    store.state.vocabEntries = {
      'Throw ': 'Discard ',
      ' thing(s) away?': ' selected item(s)?',
      'This removes ': 'Removing ',
      '7': 'WRONG COUNT',
      'C:/Provider-X/item.json': 'WRONG PATH',
      'bye': 'WRONG WORD',
    }
    store.confirmPreviewCache = '• C:/Provider-X/item.json'
    askConfirm(store, 'Throw 7 thing(s) away?', 'This removes C:/Provider-X/item.json', 'bye', run, {
      titleParts: [authoredPart('Throw '), factPart(7), authoredPart(' thing(s) away?')],
      bodyParts: [authoredPart('This removes '), factPart('C:/Provider-X/item.json')],
    })

    let root = rendered(store)
    expect(root.querySelector('.confirm-dialog h3').textContent).toContain('Discard 7 selected item(s)?')
    expect(root.querySelector('.confirm-dialog p').textContent).toBe('Removing C:/Provider-X/item.json')
    expect(root.querySelector('.confirm-word').textContent).toBe('bye')
    expect(root.querySelector('.confirm-preview').textContent).toBe('• C:/Provider-X/item.json')
    expect(root.textContent).not.toContain('WRONG COUNT')
    expect(root.textContent).not.toContain('WRONG PATH')
    expect(root.textContent).not.toContain('WRONG WORD')

    store.state.confirmTyped = 'bye'
    root = rendered(store)
    expect(root.querySelector('[data-bind="confirmTyped"]').value).toBe('bye')
    confirmRun(store)
    expect(run).toHaveBeenCalledOnce()
  })

  it('keeps row facts exact while authored visible, accessible, menu, and spoken fragments map together', () => {
    const store = createStore()
    const row = {
      id: 'provider-row-7',
      title: 'Open C:/Provider-X/item.json',
      body: 'From Provider-X',
      titleParts: [authoredPart('Open '), factPart('C:/Provider-X/item.json')],
      bodyParts: [authoredPart('From '), factPart('Provider-X')],
      tag: 'schedule:19:00',
    }
    registerListRoom('notes', { getRows: () => [row], emptyText: 'Nothing here.' })
    store.state.view = 'room'
    store.state.sec = 'notes'
    store.state.vocabEntries = {
      'Open ': 'Launch ',
      'From ': 'Supplied by ',
      'C:/Provider-X/item.json': 'WRONG PATH',
      'Provider-X': 'WRONG PROVIDER',
      'schedule:19:00': 'WRONG SCHEDULE',
    }

    let root = rendered(store)
    const button = root.querySelector('.row-item')
    expect(button.querySelector('.row-item__title-text').textContent).toBe('Launch C:/Provider-X/item.json')
    expect(button.querySelector('.row-item__text').textContent).toBe('Supplied by Provider-X')
    expect(button.getAttribute('aria-label')).toContain('Launch C:/Provider-X/item.json')
    expect(button.getAttribute('aria-label')).toContain('schedule:19:00')
    expect(button.getAttribute('aria-label')).not.toContain('WRONG')

    const menuParts = JSON.parse(button.dataset.menuLabelParts)
    const payload = JSON.parse(button.dataset.menuExtra)
    expect(payload.id).toBe('provider-row-7')
    expect(payload.titleParts).toEqual(row.titleParts)
    openMenu(store, 10, 10, 'row', button.dataset.menuLabel, payload, menuParts)
    const speak = vi.fn()
    store.menuItemsCache = menuDefs(store, {
      enterDoor() {}, toggleTheme() {}, goRoom() {}, copy() {}, speak,
      togglePick() {}, removeRows() {},
    })
    root = rendered(store)
    expect(root.querySelector('.menu-panel__title').textContent).toContain('Launch C:/Provider-X/item.json')
    store.menuItemsCache.find((item) => item.label === 'Read it out loud').run()
    expect(ownedText(store.state, speak.mock.calls[0][0], shapeCopy)).toBe('Launch C:/Provider-X/item.json. Supplied by Provider-X')
  })

  it('maps mixed toast and notification authorship consistently with narration', () => {
    const store = createStore()
    const spoken = vi.fn()
    store.state.vocabEntries = {
      'Saved ': 'Stored ',
      ' went to your downloads.': ' is in downloads.',
      'Provider-X/file.json': 'WRONG FILE',
    }
    const titleParts = [authoredPart('Saved '), factPart('Provider-X/file.json')]
    const bodyParts = [factPart('Provider-X/file.json'), authoredPart(' went to your downloads.')]
    toast(store, '📦', 'Saved Provider-X/file.json', 'Provider-X/file.json went to your downloads.', '', spoken, { titleParts, bodyParts })
    notify(store, 'Saved Provider-X/file.json', 'Provider-X/file.json went to your downloads.', 'export', { titleParts, bodyParts })

    let root = rendered(store)
    expect(root.querySelector('.toast__title').textContent).toBe('Stored Provider-X/file.json')
    expect(root.querySelector('.toast__body').textContent).toBe('Provider-X/file.json is in downloads.')
    expect(root.textContent).not.toContain('WRONG FILE')
    expect(ownedText(store.state, spoken.mock.calls[0][0], shapeCopy)).toBe('Stored Provider-X/file.json. Provider-X/file.json is in downloads.')

    registerListRoom('notes', { getRows: (s) => s.notes.map((note) => ({ ...note, meta: '', right: '' })) })
    store.state.view = 'room'
    store.state.sec = 'notes'
    root = rendered(store)
    expect(root.querySelector('.row-item__title-text').textContent).toBe('Stored Provider-X/file.json')
    expect(root.querySelector('.row-item').getAttribute('aria-label')).toContain('Provider-X/file.json')
  })

  it('keeps current user and installed voice facts exact in narrator preview and settings', () => {
    const store = createStore()
    const h = featureHarness(store)
    registerNarrator(store, {}, h.registerAction, h.registerBinding)
    store.state.nick = 'Provider-X user'
    store.state.voices = [{ id: 'voice://provider-x', label: 'Provider-X Voice (en-CA)' }]
    store.state.vocabEntries = {
      'Hello ': 'Greetings ',
      'Provider-X user': 'WRONG USER',
      'Provider-X Voice (en-CA)': 'WRONG VOICE',
    }
    h.actions.get('narrator-try')(store, 'narrator', null, h.helpers)
    expect(ownedText(store.state, h.speak.mock.calls[0][0], shapeCopy)).toBe('Greetings Provider-X user. This is the nodeterm playground.')

    store.state.view = 'room'
    store.state.sec = 'settings'
    const root = rendered(store)
    expect(root.querySelector('option[value="voice://provider-x"]').textContent).toBe('Provider-X Voice (en-CA)')
    expect(root.textContent).not.toContain('WRONG USER')
    expect(root.textContent).not.toContain('WRONG VOICE')
  })
})
