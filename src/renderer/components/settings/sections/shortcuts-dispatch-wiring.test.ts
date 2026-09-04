// @vitest-environment jsdom
//
// The rebind contract: a shortcut changed in Settings -> Shortcuts must apply IMMEDIATELY —
// the next keypress, without a listener re-run or reload. That lives in the dispatch sites,
// which must read the LIVE settings store on every keydown instead of closing over a copy
// (the feature commit's own convention: `useSettings.getState().settings.shortcuts` inside the
// handler). Canvas is a monolith with no render harness, so like canvas-wiring.test.tsx this
// pins the call sites by source read — the only thing between a one-character deletion back to
// a hardcoded combo and a silent regression where rebinds stop working.
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const read = (rel: string): string => fs.readFileSync(path.join(__dirname, rel), 'utf8')

/** Collapse runs of whitespace so a formatter wrapping a call across lines cannot silently
 *  disarm a needle. The needle still has to name the exact identifiers and argument list — this
 *  only removes the layout, never a token. */
const flat = (src: string): string => src.replace(/\s+/g, ' ')

const CANVAS = read('../../../canvas/Canvas.tsx')
const TERMINAL_NODE = read('../../../nodes/TerminalNode.tsx')
const SOURCE_CONTROL = read('../../SourceControlPanel.tsx')
const MAIN = read('../../../../main/index.ts')

describe('shortcut dispatch sites read the LIVE settings store (rebind applies immediately)', () => {
  it('Canvas reads the live map inside every keydown handler, keyed off the registry', () => {
    // Canvas owns one listener and resolves the live settings map inside the shared dispatcher.
    // The handler registry is the source of truth for configurable app actions; copy remains a
    // deliberately registry-less gesture and is checked separately below.
    expect(CANVAS).toContain('dispatchGlobalKeydown(e, deps)')
    expect(CANVAS).toContain('globalKeyDeps.current = {')
    for (const [action, id] of [
      ['commandPalette', 'app.commandPalette'],
      ['settings', 'app.settings'],
      ['shortcutsPanel', 'app.shortcutsPanel'],
      ['undo', 'canvas.undo'],
      ['redo', 'canvas.redo'],
      ['newTerminal', 'node.newTerminal'],
      ['newAgent', 'node.newAgent'],
      ['toggleExplorer', 'panel.explorer'],
      ['toggleSourceControl', 'panel.sourceControl'],
      ['toggleViewMode', 'view.kanbanToggle'],
      ['toggleSessionsPin', 'panel.sessions']
    ]) {
      expect(CANVAS, `Canvas dispatches ${action}`).toContain(`'${id}':`)
    }
    expect(CANVAS).toContain('copy: copyGesture')
  })

  it('TerminalNode find-bar reads the live map and dispatches findInTerminal', () => {
    expect(TERMINAL_NODE).toContain("effectiveBindings('terminal.find')")
    expect(TERMINAL_NODE).toContain('matchesShortcut(e, s, isMac)')
  })

  it('SourceControlPanel commit reads the live map and dispatches commitStaged', () => {
    expect(flat(SOURCE_CONTROL)).toContain(
      'const commitShortcut = useSettings.getState().settings.shortcuts.commitStaged'
    )
    expect(SOURCE_CONTROL).toContain('matchesShortcut(e, commitShortcut, isMac)')
  })

  it('main-process markdown/close intercepts read the settings store live', () => {
    // Main has no zustand; it reads the persisted settings store on every before-input-event.
    // Windows-only delivery: `resolveInterceptBindings` takes the overrides ALONE — the mac flag
    // it used to carry is gone, so a needle still demanding it would fail on correct code.
    expect(flat(MAIN)).toContain('resolveInterceptBindings(settingsStore.get().keybindings)')
    // Lazy read plus recompute on save is the whole "live" claim; pin both halves, not just one.
    expect(flat(MAIN)).toContain('interceptBindings = resolveInterceptBindings(s.keybindings)')
    expect(MAIN).toContain('installKeydownIntercepts(')
    expect(MAIN).toContain('currentInterceptBindings,')
    const intercept = read('../../../../main/keydown-intercept.ts')
    expect(flat(intercept)).toContain(
      'bindings.toggleMarkdown.some((binding) => matchesShortcut(event, binding))'
    )
    expect(flat(intercept)).toContain(
      'bindings.closeNode.some((binding) => matchesShortcut(event, binding))'
    )
  })
})
