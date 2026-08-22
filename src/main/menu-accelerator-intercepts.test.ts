import { describe, expect, it } from 'vitest'
import { matchesShortcut, type ShortcutKeyEvent } from '../shared/shortcut'
import { DEFAULT_SHORTCUTS } from '../shared/shortcuts'

/**
 * Behavioral pins for the configurable `before-input-event` accelerator steals in `index.ts`
 * (Ctrl+M → markdown toggle, Ctrl+W → close node), whose platform argument collapsed to a
 * pinned `false` when the mac desktop build was deleted: the main process only exists in the
 * desktop app (Windows delivery + Linux dev), never on a Mac.
 *
 * A file by this name once asserted SOURCE TEXT of that handler and stayed green while the bare
 * `0` key was swallowed app-wide — red on the fix, green on the break (see CONTRIBUTING.md,
 * "Never pin behaviour by reading source text"). It must not go back to reading source.
 * `index.ts` imports `electron` at module top, so the handler is not importable here; what IS
 * testable is the exact pure decision it delegates to — `matchesShortcut` with the shipped
 * registry defaults and the pinned `isMac=false` — pressed with real event shapes. The fixed
 * Ctrl+0 zoom steal (physical-code matched, not registry-configurable) is pressed for real in
 * `keydown-intercept.test.ts`.
 */

/** A keydown with every flag off, overridable per case — the same structural shape `index.ts`
 *  projects Electron's `Input` into before calling `matchesShortcut`. */
function evt(overrides: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: '', ...overrides }
}

describe('main-process accelerator steals (platform argument pinned false)', () => {
  it('Ctrl+M matches the shipped toggleMarkdown default', () => {
    expect(matchesShortcut(evt({ ctrlKey: true, key: 'm' }), DEFAULT_SHORTCUTS.toggleMarkdown, false)).toBe(true)
  })

  it('Ctrl+W matches the shipped closeNode default', () => {
    expect(matchesShortcut(evt({ ctrlKey: true, key: 'w' }), DEFAULT_SHORTCUTS.closeNode, false)).toBe(true)
  })

  it('bare M / W (no modifier) never steal — the user is typing', () => {
    expect(matchesShortcut(evt({ key: 'm' }), DEFAULT_SHORTCUTS.toggleMarkdown, false)).toBe(false)
    expect(matchesShortcut(evt({ key: 'w' }), DEFAULT_SHORTCUTS.closeNode, false)).toBe(false)
  })

  it('the Windows key (metaKey) must NOT stand in for Ctrl', () => {
    // Mutation guard for the pin: with the platform argument flipped back to a truthy sniff,
    // matchesShortcut reads metaKey as the primary modifier and BOTH of these go green — i.e.
    // Win+M would start toggling markdown views while Ctrl+M fell through to the menu.
    expect(matchesShortcut(evt({ metaKey: true, key: 'm' }), DEFAULT_SHORTCUTS.toggleMarkdown, false)).toBe(false)
    expect(matchesShortcut(evt({ metaKey: true, key: 'w' }), DEFAULT_SHORTCUTS.closeNode, false)).toBe(false)
  })

  it('a pre-rewire settings.json storing legacy "Cmd+M" still steals on Ctrl+M', () => {
    // settings.shortcuts is user data and is forever: upgraded installs feed the handler the old
    // notation, and the legacy alias is what keeps their rebinds and defaults alive.
    expect(matchesShortcut(evt({ ctrlKey: true, key: 'm' }), 'Cmd+M', false)).toBe(true)
    expect(matchesShortcut(evt({ ctrlKey: true, key: 'w' }), 'Cmd+W', false)).toBe(true)
  })
})
