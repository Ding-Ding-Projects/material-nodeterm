import { describe, expect, it } from 'vitest'
import {
  conflictBucket,
  DEFAULT_SHORTCUTS,
  findShortcutConflicts,
  resolveShortcutAction,
  shortcutGroups,
  shortcutLabel,
  SHORTCUT_DEFS
} from './shortcuts'
import { formatShortcut, parseShortcut, shortcutKeyParts, captureToShortcut, matchesShortcut } from './shortcut'

describe('shortcuts registry', () => {
  it('every def has a parseable, primary-modified default', () => {
    for (const d of SHORTCUT_DEFS) {
      const p = parseShortcut(d.default)
      // These are hotkeys, not dictation hold-chords — a trailing key is mandatory.
      expect(p.key, `${d.id} default ${d.default} has a trailing key`).not.toBeNull()
      expect(p.cmd, `${d.id} default uses the primary modifier`).toBe(true)
    }
  })

  it('every default is spelled in canonical Cmd notation', () => {
    for (const d of SHORTCUT_DEFS) {
      expect(d.default, `${d.id} default is canonical`).toMatch(/^Cmd\+/)
    }
  })

  it('defaults map matches the registry, one entry per action', () => {
    expect(Object.keys(DEFAULT_SHORTCUTS).sort()).toEqual(
      SHORTCUT_DEFS.map((d) => d.id).sort()
    )
    for (const d of SHORTCUT_DEFS) expect(DEFAULT_SHORTCUTS[d.id]).toBe(d.default)
  })

  it('defaults have no duplicates (they are the shipped hotkeys)', () => {
    expect(findShortcutConflicts(DEFAULT_SHORTCUTS)).toEqual([])
  })

  it('groups every def exactly once, in display order', () => {
    const groups = shortcutGroups()
    const flat = groups.flatMap((g) => g.defs)
    expect(flat).toHaveLength(SHORTCUT_DEFS.length)
    expect(new Set(flat.map((d) => d.id)).size).toBe(SHORTCUT_DEFS.length)
    expect(groups.map((g) => g.title)).toEqual([
      'General',
      'Canvas',
      'Terminal',
      'Source Control'
    ])
  })

  it('shortcutLabel falls back to the id for unknown actions', () => {
    expect(shortcutLabel('commandPalette')).toBe('Command palette')
    expect(shortcutLabel('does-not-exist' as never)).toBe('does-not-exist')
  })

  it('findShortcutConflicts pairs duplicates (incl. 3-way)', () => {
    const conflicts = findShortcutConflicts({
      ...DEFAULT_SHORTCUTS,
      commandPalette: 'Ctrl+K',
      settings: 'Ctrl+K',
      undo: 'Ctrl+K'
    })
    // The three-way clash yields three pairs, all involving Ctrl+K.
    expect(conflicts).toHaveLength(3)
    const pairs = conflicts.map(([a, b]) => [a, b].sort().join(','))
    expect(pairs).toEqual(['commandPalette,settings', 'commandPalette,undo', 'settings,undo'])
  })

  it('findShortcutConflicts sees through mixed legacy/canonical notation', () => {
    // A pre-rewire settings.json keeps `Cmd+K` for an untouched action while a fresh rebind
    // stores `Ctrl+K` — one chord, two spellings. Raw-string grouping (the mutant) reports no
    // conflict, and both actions then fight over a single keydown with no warning in Settings.
    const conflicts = findShortcutConflicts({
      ...DEFAULT_SHORTCUTS,
      commandPalette: 'Cmd+K',
      settings: 'Command+K'
    })
    const pairs = conflicts.map(([a, b]) => [a, b].sort().join(','))
    expect(pairs).toContain('commandPalette,settings')
  })

  // Cross-platform: the whole feature keys off the shared engine's platform abstraction
  // (`Cmd` = ⌘/metaKey on macOS, Ctrl/ctrlKey elsewhere). Every SHIPPED default must survive
  // the full parse -> format -> match/capture cycle on BOTH branches, so a Windows or macOS
  // user gets the same behaviour and the settings capture field renders the right badge.
  // (The generic engine is already tested on both branches in shortcut.test.ts; this pins the
  // exact defaults — including the punctuation keys like `Ctrl+,` — on both.)
  for (const isMac of [true, false]) {
    describe(`defaults on ${isMac ? 'macOS (⌘/meta)' : 'Windows/Linux (Ctrl)'}`, () => {
      it('parse -> format round-trips every default to a renderable badge', () => {
        for (const d of SHORTCUT_DEFS) {
          const parsed = parseShortcut(d.default)
          // The formatted badge must contain the key token, however the modifier renders.
          const badge = formatShortcut(d.default, isMac)
          expect(badge, `${d.id}: ${d.default} formats on ${isMac}`).toContain(
            shortcutKeyParts(d.default, isMac).at(-1) ?? ''
          )
          // Non-empty and never collapses to a bare modifier on either platform.
          expect(badge.length).toBeGreaterThan(0)
          // `Cmd` must always render as the platform primary modifier (⌘ on mac, Ctrl off).
          if (parsed.cmd) {
            expect(badge).toContain(isMac ? '⌘' : 'Ctrl')
          }
        }
      })

      it('a keydown with the platform primary modifier matches every default', () => {
        for (const d of SHORTCUT_DEFS) {
          const parsed = parseShortcut(d.default)
          const evt = {
            metaKey: isMac && parsed.cmd,
            ctrlKey: !isMac && parsed.cmd,
            shiftKey: parsed.shift,
            altKey: parsed.alt,
            key: parsed.key ?? ''
          }
          expect(
            matchesShortcut(evt, d.default, isMac),
            `${d.id}: ${d.default} matches on ${isMac ? 'macOS' : 'Win/Linux'}`
          ).toBe(true)
        }
      })

      it('captureToShortcut accepts every default (primary modifier + key)', () => {
        for (const d of SHORTCUT_DEFS) {
          const parsed = parseShortcut(d.default)
          const captured = captureToShortcut(
            {
              metaKey: isMac,
              ctrlKey: !isMac,
              shiftKey: parsed.shift,
              altKey: parsed.alt,
              key: parsed.key ?? ''
            },
            isMac
          )
          // Same modifiers + key as the default, modulo canonical casing (e.g. 'Ctrl+Enter').
          expect(captured, `${d.id}: ${d.default} is capturable on ${isMac}`).not.toBeNull()
          if (captured) expect(parseShortcut(captured)).toEqual(parsed)
        }
      })
    })
  }
})
describe('conflictBucket + scoped conflict detection', () => {
  it('app and canvas share the global bucket; terminal and scm are their own', () => {
    expect(conflictBucket('app')).toBe('global')
    expect(conflictBucket('canvas')).toBe('global')
    expect(conflictBucket('terminal')).toBe('terminal')
    expect(conflictBucket('scm')).toBe('scm')
  })

  it('a shared chord across buckets is NOT reported (different focus contexts never collide)', () => {
    // findInTerminal (terminal bucket) rebound onto commitStaged's chord (scm bucket) — neither
    // action's dispatch surface can ever see the other's keydown, so this must be silent.
    const map = { ...DEFAULT_SHORTCUTS, findInTerminal: 'Ctrl+Enter' }
    const pairs = findShortcutConflicts(map).map(([a, b]) => [a, b].sort().join(','))
    expect(pairs).not.toContain('commitStaged,findInTerminal')
  })

  it('a shared chord within the SAME bucket is still reported', () => {
    // toggleExplorer (app) and undo (canvas) are both in the 'global' bucket.
    const map = { ...DEFAULT_SHORTCUTS, toggleExplorer: DEFAULT_SHORTCUTS.undo }
    const pairs = findShortcutConflicts(map).map(([a, b]) => [a, b].sort().join(','))
    expect(pairs).toContain('toggleExplorer,undo')
  })

  it('every def declares a scope', () => {
    for (const d of SHORTCUT_DEFS) {
      expect(['app', 'canvas', 'terminal', 'scm']).toContain(d.scope)
    }
  })
})

describe('resolveShortcutAction (pure dispatch core)', () => {
  const evtFor = (id: (typeof SHORTCUT_DEFS)[number]['id'], isMac: boolean) => {
    const p = parseShortcut(DEFAULT_SHORTCUTS[id])
    return {
      metaKey: isMac && p.cmd,
      ctrlKey: !isMac && p.cmd,
      shiftKey: p.shift,
      altKey: p.alt,
      key: p.key ?? ''
    }
  }
  const noCtx = { typing: false, terminal: false, kanbanOpen: false }

  it('resolves a plain app-scope action in the default (untyped, non-terminal) context', () => {
    expect(
      resolveShortcutAction(evtFor('commandPalette', false), noCtx, DEFAULT_SHORTCUTS, false)
    ).toBe('commandPalette')
  })

  it('blocks a canvas-scope action while typing (allowWhileTyping is unset)', () => {
    expect(
      resolveShortcutAction(
        evtFor('undo', false),
        { ...noCtx, typing: true },
        DEFAULT_SHORTCUTS,
        false
      )
    ).toBeNull()
  })

  it('still resolves an allowWhileTyping action (closeNode) while typing', () => {
    expect(
      resolveShortcutAction(
        evtFor('closeNode', false),
        { ...noCtx, typing: true },
        DEFAULT_SHORTCUTS,
        false
      )
    ).toBe('closeNode')
  })

  it('blocks a canvas-scope action while a terminal has focus', () => {
    expect(
      resolveShortcutAction(
        evtFor('newTerminal', false),
        { ...noCtx, terminal: true },
        DEFAULT_SHORTCUTS,
        false
      )
    ).toBeNull()
  })

  it('still resolves an allowInTerminal app-scope action while a terminal has focus', () => {
    expect(
      resolveShortcutAction(
        evtFor('commandPalette', false),
        { ...noCtx, terminal: true },
        DEFAULT_SHORTCUTS,
        false
      )
    ).toBe('commandPalette')
  })

  it('resolves a terminal-scope action only while a terminal has focus', () => {
    expect(
      resolveShortcutAction(
        evtFor('findInTerminal', false),
        { ...noCtx, terminal: true },
        DEFAULT_SHORTCUTS,
        false
      )
    ).toBe('findInTerminal')
    expect(
      resolveShortcutAction(evtFor('findInTerminal', false), noCtx, DEFAULT_SHORTCUTS, false)
    ).toBeNull()
  })

  it('blocks a canvas-scope action while the kanban board is open', () => {
    expect(
      resolveShortcutAction(
        evtFor('undo', false),
        { ...noCtx, kanbanOpen: true },
        DEFAULT_SHORTCUTS,
        false
      )
    ).toBeNull()
  })

  it('never resolves an scm-scope action (it dispatches from its own composer)', () => {
    expect(
      resolveShortcutAction(evtFor('commitStaged', false), noCtx, DEFAULT_SHORTCUTS, false)
    ).toBeNull()
  })

  it('returns null when no default matches the event', () => {
    const evt = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: 'x' }
    expect(resolveShortcutAction(evt, noCtx, DEFAULT_SHORTCUTS, false)).toBeNull()
  })
})
