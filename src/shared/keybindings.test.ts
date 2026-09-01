import { describe, expect, it } from 'vitest'
import {
  COMMAND_DEFINITIONS,
  COMMANDS_BY_ID,
  findKeybindingConflicts,
  findMainInterceptShadowing,
  getEffectiveBindings,
  bindingIdentity,
  isCommandId,
  MAIN_INTERCEPTED_COMMAND_IDS,
  normalizeBindingForCommand,
  normalizeTerminalShortcutPolicy,
  resolveCommandForKeyEvent,
  sanitizeKeybindingOverrides,
  conflictBucket
} from './keybindings'
import { parseShortcut } from './shortcut'
import type { ShortcutKeyEvent } from './shortcut'

const event = (key: string, overrides: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  metaKey: false,
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  key,
  ...overrides
})

const context = (overrides: Partial<{
  typing: boolean
  terminal: boolean
  kanbanOpen: boolean
  terminalFirst: boolean
}> = {}) => ({
  typing: false,
  terminal: false,
  kanbanOpen: false,
  terminalFirst: false,
  ...overrides
})

describe('registry invariants', () => {
  it('has unique ids and a map that covers every definition', () => {
    const ids = COMMAND_DEFINITIONS.map((def) => def.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(COMMANDS_BY_ID.get(id)?.id).toBe(id)
  })

  it('ships only canonical Control defaults', () => {
    for (const def of COMMAND_DEFINITIONS) {
      for (const binding of def.defaultBindings) {
        expect(binding).not.toMatch(/Cmd|Command|⌘/)
        const parsed = parseShortcut(binding)
        if (parsed.key !== null && !['Delete', 'Backspace'].includes(binding)) {
          expect(parsed.ctrl, def.id).toBe(true)
        }
      }
    }
  })

  it('keeps the command ids and main interception list explicit', () => {
    expect(isCommandId('node.close')).toBe(true)
    expect(isCommandId('not-a-command')).toBe(false)
    expect(MAIN_INTERCEPTED_COMMAND_IDS).toEqual(['node.close', 'node.toggleMarkdown'])
  })
})

describe('binding normalization and migration', () => {
  it('canonicalizes legacy Cmd and Command settings to Ctrl', () => {
    const def = COMMANDS_BY_ID.get('node.newTerminal')!
    expect(normalizeBindingForCommand(def, 'Cmd+Shift+Y')).toEqual({
      ok: true, value: 'Ctrl+Shift+Y'
    })
    expect(normalizeBindingForCommand(def, 'Command+Y')).toEqual({
      ok: true, value: 'Ctrl+Y'
    })
    expect(normalizeBindingForCommand(def, 'Cmd+Ctrl+Y')).toEqual({
      ok: false, error: 'Use only one Control modifier.'
    })
  })

  it('preserves hold, bare-key, and invalid-binding rules', () => {
    const dictation = COMMANDS_BY_ID.get('speech.dictation')!
    const terminal = COMMANDS_BY_ID.get('node.newTerminal')!
    const deleteCommand = COMMANDS_BY_ID.get('canvas.deleteSelection')!
    expect(normalizeBindingForCommand(dictation, 'Cmd+Alt')).toEqual({ ok: true, value: 'Ctrl+Alt' })
    expect(normalizeBindingForCommand(terminal, 'Cmd+Alt')).toEqual({
      ok: false, error: 'This command needs a key, not a modifier-only chord.'
    })
    expect(normalizeBindingForCommand(deleteCommand, 'Delete')).toEqual({ ok: true, value: 'Delete' })
    expect(normalizeBindingForCommand(terminal, 'Shift+T').ok).toBe(false)
    expect(normalizeBindingForCommand(terminal, '').ok).toBe(false)
  })

  it('sanitizes legacy arrays, removes conflicts, and preserves explicit disable', () => {
    expect(sanitizeKeybindingOverrides({ 'node.newTerminal': ['shift+cmd+y'] })).toEqual({
      overrides: { 'node.newTerminal': ['Ctrl+Shift+Y'] }, warnings: []
    })
    expect(sanitizeKeybindingOverrides({ 'canvas.undo': [] }).overrides).toEqual({ 'canvas.undo': [] })
    const conflict = sanitizeKeybindingOverrides({
      'canvas.fitAll': ['Cmd+P'],
      'canvas.groupSelection': ['Ctrl+P']
    })
    expect(conflict.overrides).toEqual({})
    expect(conflict.warnings.some((warning) => warning.includes('Conflicting shortcut Ctrl+P'))).toBe(true)
  })
})

describe('effective bindings and identities', () => {
  it('uses one Control default list and lets overrides replace or disable it', () => {
    expect(getEffectiveBindings('terminal.copySelection', {})).toEqual(['Ctrl+Insert'])
    expect(getEffectiveBindings('node.newTerminal', { 'node.newTerminal': ['Cmd+Shift+T'] }))
      .toEqual(['Cmd+Shift+T'])
    expect(getEffectiveBindings('canvas.undo', { 'canvas.undo': [] })).toEqual([])
  })

  it('gives legacy and canonical spellings the same Control identity', () => {
    expect(bindingIdentity('Cmd+K')).toBe(bindingIdentity('Ctrl+K'))
    expect(bindingIdentity('Cmd+Esc')).toBe(bindingIdentity('Ctrl+Escape'))
    expect(bindingIdentity('Ctrl+Alt')).not.toBe(bindingIdentity('Ctrl+Alt+K'))
  })

  it('keeps scope buckets intact', () => {
    expect(conflictBucket({ id: 'app.commandPalette', scope: 'app' })).toBe('global')
    expect(conflictBucket({ id: 'canvas.undo', scope: 'canvas' })).toBe('global')
    expect(conflictBucket({ id: 'terminal.find', scope: 'terminal' })).toBe('terminal')
    expect(conflictBucket({ id: 'scm.commit', scope: 'scm' })).toBe('scm')
    expect(conflictBucket(COMMANDS_BY_ID.get('speech.dictation')!)).toBe('dictation')
  })

  it('reports same-bucket conflicts and ignores different buckets', () => {
    expect(findKeybindingConflicts({ 'canvas.fitAll': ['Cmd+K'] })).toEqual([{
      binding: 'Ctrl+K', commandIds: ['app.commandPalette', 'canvas.fitAll']
    }])
    expect(findKeybindingConflicts({ 'canvas.fitAll': ['Ctrl+Enter'] })).toEqual([])
    expect(findKeybindingConflicts({}, { includeDefaults: true })).toEqual([])
  })
})

describe('Control command resolution', () => {
  it('resolves Control and rejects Meta-only input', () => {
    expect(resolveCommandForKeyEvent(event('k'), context(), {})).toBe('app.commandPalette')
    expect(resolveCommandForKeyEvent(event('k', { ctrlKey: false, metaKey: true }), context(), {})).toBeNull()
  })

  it('keeps typing, terminal, kanban, hold, and source-control rules', () => {
    expect(resolveCommandForKeyEvent(event('t'), context({ typing: true }), {})).toBeNull()
    expect(resolveCommandForKeyEvent(event('w'), context({ typing: true }), {})).toBe('node.close')
    expect(resolveCommandForKeyEvent(event('f'), context({ terminal: true }), {})).toBe('terminal.find')
    expect(resolveCommandForKeyEvent(event('f'), context(), {})).toBeNull()
    expect(resolveCommandForKeyEvent(event('z'), context({ kanbanOpen: true }), {})).toBeNull()
    expect(resolveCommandForKeyEvent(event('enter'), context(), {})).toBeNull()
  })

  it('applies terminal-first and never resolves the dedicated dictation row', () => {
    expect(resolveCommandForKeyEvent(event('k'), context({ terminal: true }), {})).toBe('app.commandPalette')
    expect(resolveCommandForKeyEvent(event('k'), context({ terminal: true, terminalFirst: true }), {})).toBeNull()
    expect(resolveCommandForKeyEvent(event('0'), context(), { 'speech.dictation': ['Cmd+0'] })).toBeNull()
  })
})

describe('main interception shadow detection', () => {
  it('finds Control remaps that shadow other command surfaces', () => {
    expect(findMainInterceptShadowing('node.close', 'Cmd+F', {})).toEqual(['terminal.find'])
    expect(findMainInterceptShadowing('node.close', 'Ctrl+Enter', {})).toEqual(['scm.commit'])
    expect(findMainInterceptShadowing('canvas.undo', 'Ctrl+F', {})).toEqual([])
  })
})

describe('terminal policy normalization', () => {
  it('defaults unknown values to app-first', () => {
    expect(normalizeTerminalShortcutPolicy('terminal-first')).toBe('terminal-first')
    expect(normalizeTerminalShortcutPolicy('app-first')).toBe('app-first')
    expect(normalizeTerminalShortcutPolicy('unknown')).toBe('app-first')
  })
})
