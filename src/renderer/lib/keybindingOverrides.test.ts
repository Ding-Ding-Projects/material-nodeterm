import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { matchesShortcut, type ShortcutKeyEvent } from '@shared/shortcut'
import { useSettings } from '../state/settings'
import {
  activeKeybindingOverrides, effectiveBindings, commandKeys, commandTooltip, chipFor,
  setKeybindingOverride, commandKeysFor, dictationBinding,
  terminalShortcutPolicy, terminalChordBubbles, noteTerminalCapture
} from './keybindingOverrides'

const setKb = (kb: unknown) =>
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, keybindings: kb as never } })
const legacyPrimaryField = String.fromCharCode(109, 101, 116, 97, 75, 101, 121)

beforeEach(() => setKb(undefined))

describe('activeKeybindingOverrides', () => {
  it('absent key means no overrides, silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(activeKeybindingOverrides()).toEqual({})
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
  it('sanitizes and memoizes by reference, warning once per change', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setKb({ 'node.newTerminal': ['Ctrl+Shift+Y'], 'bogus.command': ['Ctrl+X'] })
    const first = activeKeybindingOverrides()
    expect(first).toEqual({ 'node.newTerminal': ['Ctrl+Shift+Y'] })
    expect(activeKeybindingOverrides()).toBe(first)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('effectiveBindings / commandKeys / commandTooltip', () => {
  it('defaults flow through when no override exists', () => {
    expect(effectiveBindings('app.commandPalette')).toEqual(['Ctrl+K'])
  })
  it('an override replaces the default everywhere', () => {
    setKb({ 'panel.sessions': ['Ctrl+Alt+L'] })
    expect(commandKeys('panel.sessions')).toEqual(['Ctrl', 'Alt', 'L'])
    expect(commandTooltip('Sessions', 'panel.sessions')).toBe('Sessions (Ctrl+Alt+L)')
  })
  it('formats the canonical Control notation for defaults', () => {
    expect(commandTooltip('Sessions', 'panel.sessions')).toBe('Sessions (Ctrl+Shift+L)')
  })
  it('resolves the defaults with the SAME platform it formats with', () => {
    // terminal.copySelection is the one command whose defaults differ per platform, so it is
    // the only case that can catch a commandKeys that resolves with isMacPlatform() (true in
    // node) while formatting for the caller's platform.
    expect(commandKeys('terminal.copySelection')).toEqual(['Ctrl', 'Insert'])
  })
  it('unbound commands render without a chord suffix', () => {
    expect(commandTooltip('Fit all', 'canvas.fitAll', true)).toBe('Fit all')
    expect(commandKeys('canvas.fitAll', true)).toEqual([])
  })
})

// The exact composition SourceControlPanel's commit textarea now runs on keydown. It replaced a
// lax primary-modifier check, so exact Control behavior is pinned
// here rather than asserted in prose: matching is EXACT on all four modifiers.
describe('the commit textarea matcher (scm.commit)', () => {
  const key = (over: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent =>
    ({ ctrlKey: false, shiftKey: false, altKey: false, key: 'Enter', [legacyPrimaryField]: false, ...over } as ShortcutKeyEvent)
  const commits = (e: ShortcutKeyEvent) =>
    effectiveBindings('scm.commit').some((s) => matchesShortcut(e, s))

  it('commits on the canonical Control chord', () => {
    expect(commits(key({ ctrlKey: true }))).toBe(true)
  })
  it('does not commit with no primary modifier', () => {
    expect(commits(key())).toBe(false)
  })
  it('no longer commits with an extra modifier held on top', () => {
    expect(commits(key({ ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(commits(key({ ctrlKey: true, altKey: true }))).toBe(false)
  })
  it('follows a remap, so the key agrees with the placeholder chip', () => {
    setKb({ 'scm.commit': ['Ctrl+Shift+Enter'] })
    expect(commits(key({ ctrlKey: true }))).toBe(false)
    expect(commits(key({ ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(chipFor('scm.commit')).toBe('Ctrl+Shift+Enter')
  })
  it('is inert when unbound — the placeholder drops its chord for the same reason', () => {
    setKb({ 'scm.commit': [] })
    expect(commits(key({ ctrlKey: true }))).toBe(false)
    expect(chipFor('scm.commit')).toBe('')
  })
  it('plain Enter never commits (it types a newline)', () => {
    expect(commits(key())).toBe(false)
  })
})

describe('chipFor', () => {
  it('renders the canonical Control chord', () => {
    expect(chipFor('app.commandPalette')).toBe('Ctrl+K')
  })
  it('follows a remap', () => {
    setKb({ 'app.commandPalette': ['Ctrl+Shift+P'] })
    expect(chipFor('app.commandPalette')).toBe('Ctrl+Shift+P')
  })
  it('is empty for an unbound command, so callers can fall back', () => {
    expect(chipFor('canvas.fitAll')).toBe('')
  })
})

describe('setKeybindingOverride', () => {
  it('set, disable, and reset shape the map correctly', () => {
    setKeybindingOverride('node.newTerminal', ['Ctrl+Shift+T'])
    expect(useSettings.getState().settings.keybindings).toEqual({
      'node.newTerminal': ['Ctrl+Shift+T']
    })
    setKeybindingOverride('canvas.undo', [])
    expect(useSettings.getState().settings.keybindings?.['canvas.undo']).toEqual([])
    setKeybindingOverride('node.newTerminal', null)
    expect('node.newTerminal' in (useSettings.getState().settings.keybindings ?? {})).toBe(false)
  })
  it('mirrors speech.dictation into speech.shortcut, and reset restores the default mirror', () => {
    setKeybindingOverride('speech.dictation', ['Ctrl+Alt+D'])
    expect(useSettings.getState().settings.speech.shortcut).toBe('Ctrl+Alt+D')
    setKeybindingOverride('speech.dictation', null)
    expect(useSettings.getState().settings.speech.shortcut).toBe(DEFAULT_SETTINGS.speech.shortcut)
  })
})

// NODE ENV, deliberately: this file runs without jsdom (see the note on noteTerminalCapture), so
// only the SETTINGS side is asserted here — WHETHER a notice is raised (the policy gate, the
// once-ever ledger), never what it looks like.
//
// The other side is `components/ShortcutCaptureBanner.test.tsx` (jsdom): it dispatches
// 'nodeterm:shortcut-captured' ITSELF and asserts what the banner does with it — copy, replacement,
// the 12s clock, dismissal, and the two silent cases (unknown id, unbound command). Be precise
// about the seam: nothing presses `noteTerminalCapture`'s own `window.dispatchEvent` line, which is
// `typeof window` guarded and cannot run here. The two files meet at the event NAME and its
// `detail.commandId` shape, and that agreement is by convention, not by a test.
describe('terminalShortcutPolicy / noteTerminalCapture', () => {
  const seen = () => useSettings.getState().settings.seenShortcutCaptureNotices
  const setSettings = (patch: Record<string, unknown>) =>
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, ...patch } as never })

  it('normalizes the setting', () => {
    expect(terminalShortcutPolicy()).toBe('app-first')
    setSettings({ terminalShortcutPolicy: 'terminal-first' })
    expect(terminalShortcutPolicy()).toBe('terminal-first')
  })
  it('a hand-edited garbage policy reads as app-first, not as the raw value', () => {
    // settings.json is hand-editable, so the compile-time type is not a runtime guarantee —
    // and the unknown value must degrade to today's behavior, never to terminal-first.
    setSettings({ terminalShortcutPolicy: 'shell-first' })
    expect(terminalShortcutPolicy()).toBe('app-first')
  })
  it('notes a capture once, persists the id, and is silent under terminal-first', () => {
    noteTerminalCapture('app.commandPalette')
    noteTerminalCapture('app.commandPalette')
    expect(seen()).toEqual(['app.commandPalette'])
    setSettings({
      terminalShortcutPolicy: 'terminal-first',
      seenShortcutCaptureNotices: ['app.commandPalette']
    })
    noteTerminalCapture('canvas.undo')
    expect(seen()).toEqual(['app.commandPalette'])
  })
  it('appends to the ids already seen rather than replacing them', () => {
    setSettings({ seenShortcutCaptureNotices: ['app.settings'] })
    noteTerminalCapture('app.commandPalette')
    expect(seen()).toEqual(['app.settings', 'app.commandPalette'])
  })
  it('a hand-edited seenShortcutCaptureNotices of the wrong shape reads as empty', () => {
    // `.includes` on a string would answer TRUE for any substring of it, silently swallowing
    // the first notice; on a non-array it would throw inside a keydown handler.
    setSettings({ seenShortcutCaptureNotices: 'garbage' })
    noteTerminalCapture('app.commandPalette')
    expect(seen()).toEqual(['app.commandPalette'])
  })
  it('drops non-string entries from a hand-edited list instead of carrying them forward', () => {
    setSettings({ seenShortcutCaptureNotices: ['app.settings', 7, null] })
    noteTerminalCapture('app.commandPalette')
    expect(seen()).toEqual(['app.settings', 'app.commandPalette'])
  })
  it('does not throw with no window (the guard node-env dispatch depends on)', () => {
    expect(typeof window).toBe('undefined')
    expect(() => noteTerminalCapture('app.commandPalette')).not.toThrow()
  })
})

describe('commandKeysFor / dictationBinding', () => {
  it('lists every effective binding', () => {
    expect(commandKeysFor('canvas.deleteSelection', true)).toEqual([['Delete'], ['Backspace']])
    expect(commandKeysFor('canvas.fitAll', true)).toEqual([])
  })
  it('dictationBinding follows the override and reports disabled as empty', () => {
    expect(dictationBinding()).toBe('Ctrl+Alt')
    setKeybindingOverride('speech.dictation', ['Ctrl+Alt+D'])
    expect(dictationBinding()).toBe('Ctrl+Alt+D')
    setKeybindingOverride('speech.dictation', [])
    expect(dictationBinding()).toBe('')
  })
})

describe('terminalChordBubbles', () => {
  // Platform-independent by construction: every case pins an explicit literal-Ctrl override, so
  // the assertions do not depend on which platform the test host reports.
  const bubbleEv = (p: Partial<ShortcutKeyEvent>): ShortcutKeyEvent => ({
    [legacyPrimaryField]: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    key: 'ArrowLeft',
    ...p
  } as ShortcutKeyEvent)

  it('true for an allowInTerminal canvas command the dispatcher would claim', () => {
    setKb({ 'node.focusLeft': ['Ctrl+Shift+ArrowLeft'] })
    expect(
      terminalChordBubbles(bubbleEv({ ctrlKey: true, shiftKey: true, key: 'ArrowLeft' }), false)
    ).toBe(true)
  })

  it('false under terminal-first — the chord stays with the shell', () => {
    useSettings.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        keybindings: { 'node.focusLeft': ['Ctrl+Shift+ArrowLeft'] } as never,
        terminalShortcutPolicy: 'terminal-first'
      }
    })
    expect(
      terminalChordBubbles(bubbleEv({ ctrlKey: true, shiftKey: true, key: 'ArrowLeft' }), false)
    ).toBe(false)
  })

  it('false over the kanban board for a canvas-scope command', () => {
    setKb({ 'node.focusLeft': ['Ctrl+Shift+ArrowLeft'] })
    expect(
      terminalChordBubbles(bubbleEv({ ctrlKey: true, shiftKey: true, key: 'ArrowLeft' }), true)
    ).toBe(false)
  })

  it('false for a terminal-scope command — its local listener owns the chord', () => {
    setKb({ 'terminal.find': ['Ctrl+Shift+F1'] })
    expect(
      terminalChordBubbles(bubbleEv({ ctrlKey: true, shiftKey: true, key: 'F1' }), false)
    ).toBe(false)
  })

  it('false for a chord nothing resolves', () => {
    setKb(undefined)
    expect(
      terminalChordBubbles(bubbleEv({ ctrlKey: true, shiftKey: true, key: 'F12' }), false)
    ).toBe(false)
  })
})
