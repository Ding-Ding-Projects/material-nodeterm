import { describe, expect, it } from 'vitest'
import { IPC } from '../shared/ipc'
import {
  closeStandsDownInTerminal,
  installKeydownIntercepts,
  keydownIntercept,
  menuItemIdsToSuspend,
  menuStandsDown,
  navigationClearsRecording,
  policyStandsDown,
  resolveInterceptBindings,
  type KeydownInterceptInput,
  type KeydownInterceptTarget
} from './keydown-intercept'

const input = (overrides: Partial<KeydownInterceptInput> = {}): KeydownInterceptInput => ({
  type: 'keyDown',
  key: 'k',
  code: 'KeyK',
  meta: false,
  control: true,
  shift: false,
  alt: false,
  isAutoRepeat: false,
  ...overrides
})

const bindings = (overrides: unknown = undefined) => resolveInterceptBindings(overrides)

describe('Windows Control-only interception', () => {
  it('forwards Ctrl+M and Ctrl+W to renderer actions', () => {
    expect(keydownIntercept(input({ key: 'm', code: 'KeyM' }), bindings())).toEqual({
      action: 'toggle-markdown'
    })
    expect(keydownIntercept(input({ key: 'w', code: 'KeyW' }), bindings())).toEqual({
      action: 'close-node'
    })
  })

  it('claims Ctrl+0 once and drops auto-repeat while retaining ownership', () => {
    expect(keydownIntercept(input({ key: '0', code: 'Digit0' }), bindings())).toEqual({
      action: 'zoom-actual-size'
    })
    expect(keydownIntercept(input({ key: '0', code: 'Digit0', isAutoRepeat: true }), bindings())).toEqual({
      action: null
    })
  })

  it('refuses Meta-only and mixed Meta plus Control input', () => {
    expect(keydownIntercept(input({ meta: true, control: false, key: 'm', code: 'KeyM' }), bindings()))
      .toBeNull()
    expect(keydownIntercept(input({ meta: true, control: true, key: 'm', code: 'KeyM' }), bindings()))
      .toBeNull()
  })

  it('requires exact modifiers and keeps ordinary typing untouched', () => {
    expect(keydownIntercept(input({ control: false, key: 'm', code: 'KeyM' }), bindings())).toBeNull()
    expect(keydownIntercept(input({ shift: true, key: 'm', code: 'KeyM' }), bindings())).toBeNull()
    expect(keydownIntercept(input({ alt: true, key: 'm', code: 'KeyM' }), bindings())).toBeNull()
    expect(keydownIntercept(input({ control: false, key: '0', code: 'Digit0' }), bindings())).toBeNull()
  })

  it('keeps legacy remaps working while resolving them as Control', () => {
    const remapped = bindings({ 'node.close': ['Command+Shift+K'] })
    expect(keydownIntercept(input({ key: 'K', code: 'KeyK', shift: true }), remapped)).toEqual({
      action: 'close-node'
    })
  })
})

describe('native interception installation', () => {
  function install(
    getBindings = () => bindings(),
    isRecording = () => false,
    isStoodDown = () => false,
    isCloseSuspended = () => false
  ) {
    let listener: ((event: { preventDefault(): void }, value: KeydownInterceptInput) => void) | undefined
    const prevented: string[] = []
    const sent: string[] = []
    const win: KeydownInterceptTarget = {
      webContents: {
        on: (_event, next) => { listener = next },
        send: (channel) => { sent.push(channel) }
      }
    }
    installKeydownIntercepts(win, getBindings, isRecording, isStoodDown, isCloseSuspended)
    return {
      fire(value: KeydownInterceptInput) {
        listener?.({ preventDefault: () => prevented.push(value.code) }, value)
      },
      prevented,
      sent
    }
  }

  it('prevents and forwards only the claimed Control actions', () => {
    const seam = install()
    seam.fire(input({ key: 'm', code: 'KeyM' }))
    seam.fire(input({ key: 'w', code: 'KeyW' }))
    seam.fire(input({ key: 'x', code: 'KeyX' }))
    expect(seam.prevented).toEqual(['KeyM', 'KeyW'])
    expect(seam.sent).toEqual([IPC.appToggleMarkdown, IPC.appCloseNode])
  })

  it('stands down before preventDefault for recording and terminal-first policy', () => {
    const recording = install(() => bindings(), () => true)
    recording.fire(input({ key: 'm', code: 'KeyM' }))
    expect(recording.prevented).toEqual([])
    expect(recording.sent).toEqual([])

    const terminal = install(() => bindings(), () => false, () => true)
    terminal.fire(input({ key: 'w', code: 'KeyW' }))
    expect(terminal.prevented).toEqual([])
    expect(terminal.sent).toEqual([])
  })

  it('stands down Ctrl+W for a focused terminal without affecting other actions', () => {
    const seam = install(() => bindings(), () => false, () => false, () => true)
    seam.fire(input({ key: 'w', code: 'KeyW' }))
    seam.fire(input({ key: 'm', code: 'KeyM' }))
    expect(seam.prevented).toEqual(['KeyM'])
    expect(seam.sent).toEqual([IPC.appToggleMarkdown])
  })
})

describe('terminal policy and menu suspension', () => {
  it('keeps the terminal-first truth table', () => {
    expect(policyStandsDown('terminal-first', true)).toBe(true)
    expect(policyStandsDown('terminal-first', false)).toBe(false)
    expect(policyStandsDown('app-first', true)).toBe(false)
    expect(menuStandsDown(true, 'app-first', false)).toBe(true)
    expect(menuStandsDown(false, 'terminal-first', true)).toBe(true)
  })

  it('suspends all four native accelerator items under the one supported desktop', () => {
    expect(menuItemIdsToSuspend()).toEqual([
      'window-minimize', 'view-kanban-toggle', 'app-settings', 'window-close'
    ])
    expect(closeStandsDownInTerminal(true)).toBe(true)
    expect(closeStandsDownInTerminal(false)).toBe(false)
  })

  it('clears recording only for a real main-frame navigation', () => {
    expect(navigationClearsRecording({ isMainFrame: true, isSameDocument: false })).toBe(true)
    expect(navigationClearsRecording({ isMainFrame: true, isSameDocument: true })).toBe(false)
    expect(navigationClearsRecording({ isMainFrame: false, isSameDocument: false })).toBe(false)
  })
})
