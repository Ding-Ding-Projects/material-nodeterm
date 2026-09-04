import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHORTCUTS,
  findShortcutConflicts,
  resolveShortcutAction,
  shortcutGroups,
  shortcutLabel,
  SHORTCUT_DEFS
} from './shortcuts'
import { captureToShortcut, formatShortcut, matchesShortcut, parseShortcut } from './shortcut'

const controlEvent = (key: string, modifiers: Partial<{
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}> = {}) => ({
  metaKey: false,
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  key,
  ...modifiers
})

describe('shortcuts registry', () => {
  it('ships one canonical Control default per keyed definition', () => {
    for (const def of SHORTCUT_DEFS) {
      const parsed = parseShortcut(def.default)
      if (def.default) expect(parsed.key, def.id).not.toBeNull()
      if (parsed.key !== null) expect(parsed.ctrl, def.id).toBe(true)
      expect(def.default, def.id).not.toMatch(/Cmd|Command|⌘/)
      expect(formatShortcut(def.default)).not.toMatch(/[⌘⌃⌥⇧]/)
    }
  })

  it('every default is spelled in canonical Ctrl notation, not the legacy Cmd alias', () => {
    // A `Cmd+…` default would still WORK (the alias parses), which is exactly why nothing else
    // would catch it: it silently reintroduces mac-first notation as the shipped source of truth.
    for (const d of SHORTCUT_DEFS) {
      expect(d.default, `${d.id} default is canonical`).toMatch(/^Ctrl\+/)
    }
  })

  it('keeps shipped defaults conflict-free and labels unknown ids safely', () => {
    expect(findShortcutConflicts(DEFAULT_SHORTCUTS)).toEqual([])
    expect(shortcutLabel('commandPalette')).toBe('Command palette')
    expect(shortcutLabel('unknown' as never)).toBe('unknown')
  })

  it('finds conflicts across legacy and canonical spellings in one bucket', () => {
    const conflicts = findShortcutConflicts({
      ...DEFAULT_SHORTCUTS,
      commandPalette: 'Cmd+K',
      settings: 'Ctrl+K'
    })
    expect(conflicts.map(([left, right]) => [left, right].sort().join(',')))
      .toContain('commandPalette,settings')
  })

  it('keeps separate scope buckets separate', () => {
    const conflicts = findShortcutConflicts({
      ...DEFAULT_SHORTCUTS,
      findInTerminal: 'Ctrl+Enter'
    })
    expect(conflicts.map(([left, right]) => [left, right].sort().join(',')))
      .not.toContain('commitStaged,findInTerminal')
  })
})

describe('resolveShortcutAction', () => {
  const context = { typing: false, terminal: false, kanbanOpen: false }
  const terminal = { typing: false, terminal: true, kanbanOpen: false }

  it('resolves Control events and refuses Meta-only events', () => {
    expect(resolveShortcutAction(controlEvent('k'), context, DEFAULT_SHORTCUTS)).toBe('commandPalette')
    expect(resolveShortcutAction(controlEvent('k', { ctrlKey: false, metaKey: true }), context, DEFAULT_SHORTCUTS))
      .toBeNull()
  })

  it('preserves typing and terminal scope rules', () => {
    expect(resolveShortcutAction(controlEvent('t'), { ...context, typing: true }, DEFAULT_SHORTCUTS)).toBeNull()
    expect(resolveShortcutAction(controlEvent('w'), { ...context, typing: true }, DEFAULT_SHORTCUTS)).toBe('closeNode')
    expect(resolveShortcutAction(controlEvent('f'), terminal, DEFAULT_SHORTCUTS)).toBe('findInTerminal')
    expect(resolveShortcutAction(controlEvent('f'), context, DEFAULT_SHORTCUTS)).toBeNull()
  })

  it('keeps the first registry definition deterministic and honors disabled bindings', () => {
    const remapped = { ...DEFAULT_SHORTCUTS, commandPalette: 'Ctrl+Z' }
    expect(resolveShortcutAction(controlEvent('z'), context, remapped)).toBe('commandPalette')
    expect(resolveShortcutAction(controlEvent('k'), context, { ...DEFAULT_SHORTCUTS, commandPalette: '' }))
      .toBeNull()
  })

  it('round-trips every keyed default through Control capture and matching', () => {
    for (const def of SHORTCUT_DEFS) {
      const parsed = parseShortcut(def.default)
      if (parsed.key === null || !parsed.ctrl) continue
      const captured = captureToShortcut(controlEvent(parsed.key, {
        shiftKey: parsed.shift,
        altKey: parsed.alt
      }))
      expect(captured, def.id).not.toBeNull()
      expect(matchesShortcut(controlEvent(parsed.key, {
        shiftKey: parsed.shift,
        altKey: parsed.alt
      }), captured!), def.id).toBe(true)
    }
  })
})
