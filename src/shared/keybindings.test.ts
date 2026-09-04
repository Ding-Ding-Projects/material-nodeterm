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

describe('registry invariants', () => {
  it('has unique ids and a map that covers them all', () => {
    const ids = COMMAND_DEFINITIONS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(COMMANDS_BY_ID.size).toBe(ids.length)
    for (const d of COMMAND_DEFINITIONS) expect(COMMANDS_BY_ID.get(d.id)).toBe(d)
  })

  it('every default binding parses, and keyed defaults carry a key', () => {
    for (const d of COMMAND_DEFINITIONS) {
      for (const s of [...d.defaultBindings.darwin, ...d.defaultBindings.other]) {
        const p = parseShortcut(s)
        if (d.allowHoldChord) continue
        expect(p.key, `${d.id}: ${s}`).not.toBeNull()
      }
    }
  })

  it('pins the defaults that PR 2 will wire (behavior contract)', () => {
    expect(COMMANDS_BY_ID.get('app.commandPalette')?.defaultBindings.darwin).toEqual(['Cmd+K'])
    expect(COMMANDS_BY_ID.get('node.close')?.defaultBindings.other).toEqual(['Cmd+W'])
    expect(COMMANDS_BY_ID.get('canvas.redo')?.defaultBindings.other).toEqual(['Cmd+Shift+Z', 'Cmd+Y'])
    expect(COMMANDS_BY_ID.get('terminal.copySelection')?.defaultBindings.other).toEqual([
      'Cmd+Shift+C', 'Ctrl+Insert'
    ])
    expect(COMMANDS_BY_ID.get('canvas.deleteSelection')?.defaultBindings.other).toEqual(['Delete', 'Backspace'])
    expect(COMMANDS_BY_ID.get('speech.dictation')?.defaultBindings.darwin).toEqual(['Cmd+Alt'])
    expect(COMMANDS_BY_ID.get('canvas.fitAll')?.defaultBindings.darwin).toEqual([])
  })

  it('reopen-last-closed defaults to Cmd+Shift+T and works in a terminal', () => {
    const def = COMMANDS_BY_ID.get('app.reopenLastClosed')
    expect(def?.defaultBindings.darwin).toEqual(['Cmd+Shift+T'])
    expect(def?.defaultBindings.other).toEqual(['Cmd+Shift+T'])
    expect(def?.allowInTerminal).toBe(true)
  })

  it('pins the WHOLE table — every row PR 2 will dispatch on, in source order', () => {
    // Source order is contractual (first match wins in the resolver), so the array order is
    // asserted too. A dropped flag — allowInTerminal above all — reds this test.
    const table = COMMAND_DEFINITIONS.map((d) => {
      const row: Record<string, unknown> = {
        id: d.id,
        title: d.title,
        group: d.group,
        scope: d.scope,
        darwin: d.defaultBindings.darwin,
        other: d.defaultBindings.other
      }
      if (d.allowWhileTyping !== undefined) row.allowWhileTyping = d.allowWhileTyping
      if (d.allowInTerminal !== undefined) row.allowInTerminal = d.allowInTerminal
      if (d.allowBareKey !== undefined) row.allowBareKey = d.allowBareKey
      if (d.allowHoldChord !== undefined) row.allowHoldChord = d.allowHoldChord
      return row
    })
    expect(table).toEqual([
      { id: 'app.commandPalette', title: 'Command palette', group: 'General', scope: 'app',
        darwin: ['Cmd+K'], other: ['Cmd+K'], allowInTerminal: true },
      { id: 'app.settings', title: 'Open settings', group: 'General', scope: 'app',
        darwin: ['Cmd+Comma'], other: ['Cmd+Comma'], allowInTerminal: true },
      { id: 'app.shortcutsPanel', title: 'Keyboard shortcuts panel', group: 'General', scope: 'app',
        darwin: ['Cmd+Slash'], other: ['Cmd+Slash'], allowInTerminal: true },
      { id: 'view.kanbanToggle', title: 'Toggle kanban board', group: 'General', scope: 'app',
        darwin: ['Cmd+Shift+B'], other: ['Cmd+Shift+B'], allowInTerminal: true },
      { id: 'view.focusMode', title: 'Toggle focus mode', group: 'General', scope: 'canvas',
        darwin: ['Cmd+Shift+F'], other: ['Cmd+Shift+F'], allowInTerminal: true },
      { id: 'panel.explorer', title: 'Toggle explorer panel', group: 'General', scope: 'app',
        darwin: ['Cmd+Shift+E'], other: ['Cmd+Shift+E'], allowInTerminal: true },
      { id: 'panel.sourceControl', title: 'Toggle source control panel', group: 'General',
        scope: 'app', darwin: ['Cmd+Shift+G'], other: ['Cmd+Shift+G'], allowInTerminal: true },
      { id: 'panel.sessions', title: 'Pin sessions sidebar', group: 'General', scope: 'app',
        darwin: ['Cmd+Shift+L'], other: ['Cmd+Shift+L'], allowInTerminal: true },
      { id: 'app.reopenLastClosed', title: 'Reopen last closed', group: 'General', scope: 'app',
        darwin: ['Cmd+Shift+T'], other: ['Cmd+Shift+T'], allowInTerminal: true },
      { id: 'canvas.undo', title: 'Undo', group: 'Canvas', scope: 'canvas',
        darwin: ['Cmd+Z'], other: ['Cmd+Z'] },
      { id: 'canvas.redo', title: 'Redo', group: 'Canvas', scope: 'canvas',
        darwin: ['Cmd+Shift+Z'], other: ['Cmd+Shift+Z', 'Cmd+Y'] },
      { id: 'canvas.goBack', title: 'Go back', group: 'Canvas', scope: 'canvas',
        darwin: ['Cmd+['], other: ['Cmd+['] },
      { id: 'canvas.goForward', title: 'Go forward', group: 'Canvas', scope: 'canvas',
        darwin: ['Cmd+]'], other: ['Cmd+]'] },
      { id: 'canvas.deleteSelection', title: 'Delete selection', group: 'Canvas', scope: 'canvas',
        darwin: ['Delete', 'Backspace'], other: ['Delete', 'Backspace'], allowBareKey: true },
      { id: 'canvas.fitAll', title: 'Fit all nodes in view', group: 'Canvas', scope: 'canvas',
        darwin: [], other: [] },
      { id: 'canvas.tidy', title: 'Tidy canvas', group: 'Canvas', scope: 'canvas',
        darwin: ['Cmd+Shift+A'], other: ['Cmd+Shift+A'] },
      { id: 'canvas.groupSelection', title: 'Group selection', group: 'Canvas', scope: 'canvas',
        darwin: [], other: [] },
      { id: 'node.newTerminal', title: 'New terminal node', group: 'Nodes', scope: 'canvas',
        darwin: ['Cmd+T'], other: ['Cmd+T'] },
      { id: 'node.newAgent', title: 'New agent node', group: 'Nodes', scope: 'canvas',
        darwin: ['Cmd+Shift+C'], other: ['Cmd+Shift+C'] },
      // The per-agent + per-node-kind creates: pool only, no default chord on either platform.
      { id: 'node.newAgent.claude', title: 'New Claude Code node', group: 'Nodes', scope: 'canvas',
        darwin: [], other: [] },
      { id: 'node.newAgent.codex', title: 'New Codex node', group: 'Nodes', scope: 'canvas',
        darwin: [], other: [] },
      { id: 'node.newAgent.gemini', title: 'New Gemini node', group: 'Nodes', scope: 'canvas',
        darwin: [], other: [] },
      { id: 'node.newAgent.opencode', title: 'New opencode node', group: 'Nodes', scope: 'canvas',
        darwin: [], other: [] },
      { id: 'node.newAgent.grok', title: 'New Grok node', group: 'Nodes', scope: 'canvas',
        darwin: [], other: [] },
      { id: 'node.newAgent.copilot', title: 'New GitHub Copilot node', group: 'Nodes',
        scope: 'canvas', darwin: [], other: [] },
      { id: 'node.newAgent.devin', title: 'New Devin node', group: 'Nodes',
        scope: 'canvas', darwin: [], other: [] },
      { id: 'node.newSticky', title: 'New sticky note', group: 'Nodes', scope: 'canvas',
        darwin: [], other: [] },
      { id: 'node.newBrowser', title: 'New browser node', group: 'Nodes', scope: 'canvas',
        darwin: [], other: [] },
      { id: 'node.newWebView', title: 'New web view node', group: 'Nodes', scope: 'canvas',
        darwin: [], other: [] },
      { id: 'node.newDino', title: 'New dino node', group: 'Nodes', scope: 'canvas',
        darwin: [], other: [] },
      { id: 'node.newFile', title: 'New file…', group: 'Nodes', scope: 'canvas',
        darwin: [], other: [] },
      { id: 'node.focusLeft', title: 'Focus node to the left', group: 'Nodes', scope: 'canvas',
        darwin: ['Cmd+ArrowLeft'], other: ['Ctrl+Shift+ArrowLeft'], allowInTerminal: true },
      { id: 'node.focusRight', title: 'Focus node to the right', group: 'Nodes', scope: 'canvas',
        darwin: ['Cmd+ArrowRight'], other: ['Ctrl+Shift+ArrowRight'], allowInTerminal: true },
      { id: 'node.focusUp', title: 'Focus node above', group: 'Nodes', scope: 'canvas',
        darwin: ['Cmd+ArrowUp'], other: ['Ctrl+Shift+ArrowUp'], allowInTerminal: true },
      { id: 'node.focusDown', title: 'Focus node below', group: 'Nodes', scope: 'canvas',
        darwin: ['Cmd+ArrowDown'], other: ['Ctrl+Shift+ArrowDown'], allowInTerminal: true },
      { id: 'node.maximize', title: 'Maximize / restore node', group: 'Nodes', scope: 'canvas',
        darwin: ['Cmd+Shift+Enter'], other: ['Cmd+Shift+Enter'], allowInTerminal: true },
      { id: 'node.zoneLeft', title: 'Snap node to left half', group: 'Nodes', scope: 'canvas',
        darwin: ['Ctrl+Alt+ArrowLeft'], other: [], allowInTerminal: true },
      { id: 'node.zoneRight', title: 'Snap node to right half', group: 'Nodes', scope: 'canvas',
        darwin: ['Ctrl+Alt+ArrowRight'], other: [], allowInTerminal: true },
      { id: 'node.zoneUp', title: 'Snap node to top half', group: 'Nodes', scope: 'canvas',
        darwin: ['Ctrl+Alt+ArrowUp'], other: [], allowInTerminal: true },
      { id: 'node.zoneDown', title: 'Snap node to bottom half', group: 'Nodes', scope: 'canvas',
        darwin: ['Ctrl+Alt+ArrowDown'], other: [], allowInTerminal: true },
      { id: 'node.close', title: 'Close node / window', group: 'Nodes', scope: 'app',
        darwin: ['Cmd+W'], other: ['Cmd+W'], allowInTerminal: true, allowWhileTyping: true },
      { id: 'node.toggleMarkdown', title: 'Toggle markdown view', group: 'Nodes', scope: 'app',
        darwin: ['Cmd+M'], other: ['Cmd+M'], allowInTerminal: true, allowWhileTyping: true },
      { id: 'terminal.find', title: 'Find in terminal', group: 'Terminal', scope: 'terminal',
        darwin: ['Cmd+F'], other: ['Cmd+F'] },
      { id: 'terminal.copySelection', title: 'Copy terminal selection', group: 'Terminal',
        scope: 'terminal', darwin: ['Cmd+C'], other: ['Cmd+Shift+C', 'Ctrl+Insert'] },
      { id: 'scm.commit', title: 'Commit', group: 'Source Control', scope: 'scm',
        darwin: ['Cmd+Enter'], other: ['Cmd+Enter'], allowWhileTyping: true },
      { id: 'speech.dictation', title: 'Dictate', group: 'Speech', scope: 'app',
        darwin: ['Cmd+Alt'], other: ['Cmd+Alt'],
        allowHoldChord: true, allowInTerminal: true, allowWhileTyping: true }
    ])
  })

  it('isCommandId accepts known ids and rejects unknowns', () => {
    expect(isCommandId('node.newTerminal')).toBe(true)
    expect(isCommandId('node.selfDestruct')).toBe(false)
  })

  // Parity with the agent registry, both directions. The union is spelled statically (so the
  // CommandId type stays literal), which means nothing but this test notices when builtin agent
  // #7 lands: it reds here until `node.newAgent.<id>` exists, and it reds again if a command
  // outlives the agent it creates.
  it('has one create command per builtin agent, titled from AGENT_CONFIG', () => {
    const perAgent = COMMAND_DEFINITIONS.map((d) => d.id).filter((id) =>
      id.startsWith('node.newAgent.')
    )
    expect([...perAgent].sort()).toEqual(
      BUILTIN_AGENT_IDS.map((a) => `node.newAgent.${a}`).sort()
    )
    for (const agentId of BUILTIN_AGENT_IDS) {
      const d = COMMANDS_BY_ID.get(`node.newAgent.${agentId}` as CommandId)
      expect(d?.title).toBe(`New ${AGENT_CONFIG[agentId].label} node`)
      expect(d?.group).toBe('Nodes')
      expect(d?.scope).toBe('canvas')
    }
  })

  // Every command this PR added ships with NO default chord — the pool grows, the out-of-box
  // key map does not. A default sneaking in here would shadow an existing binding or steal a
  // key from the terminal for a user who never asked for the command.
  it('ships the new create commands unbound on both platforms', () => {
    const added: readonly string[] = [
      ...BUILTIN_AGENT_IDS.map((a) => `node.newAgent.${a}`),
      'node.newSticky',
      'node.newBrowser',
      'node.newWebView',
      'node.newDino',
      'node.newFile'
    ]
    expect(added).toHaveLength(12)
    for (const id of added) {
      const d = COMMANDS_BY_ID.get(id as CommandId)
      expect(d, id).toBeDefined()
      expect(d!.defaultBindings.darwin, id).toEqual([])
      expect(d!.defaultBindings.other, id).toEqual([])
      expect(getEffectiveBindings(id as CommandId, {}, true), id).toEqual([])
      expect(getEffectiveBindings(id as CommandId, {}, false), id).toEqual([])
    }
  })
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
