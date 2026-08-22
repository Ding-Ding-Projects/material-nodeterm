import { afterEach, describe, expect, it, vi } from 'vitest'
import { hintLabel, isMacPlatform, isWindowsPlatform, keyLabel } from './platform-utils'

describe('hintLabel', () => {
  it('normalizes plain mac glyph chords to Ctrl notation', () => {
    expect(hintLabel('Save (⌘S)')).toBe('Save (Ctrl+S)')
    expect(hintLabel('⌘K')).toBe('Ctrl+K')
    expect(hintLabel('Settings (⌘,)')).toBe('Settings (Ctrl+,)')
    expect(hintLabel('⌘/')).toBe('Ctrl+/')
  })

  it('normalizes shift chords', () => {
    expect(hintLabel('Redo (⌘⇧Z)')).toBe('Redo (Ctrl+Shift+Z)')
    expect(hintLabel('Explorer (⌘⇧E)')).toBe('Explorer (Ctrl+Shift+E)')
  })

  it('keeps the return symbol and rewrites the modifier', () => {
    expect(hintLabel('Message (⌘↵ to commit)')).toBe('Message (Ctrl+↵ to commit)')
  })

  it('handles a bare ⌘ with no trailing key', () => {
    expect(hintLabel('no ⌘')).toBe('no Ctrl')
    expect(hintLabel('Zoom with a plain mouse wheel (no ⌘).')).toBe(
      'Zoom with a plain mouse wheel (no Ctrl).'
    )
  })

  it('passes already-canonical Ctrl notation through untouched', () => {
    // A migrated definition site must not be double-rewritten.
    expect(hintLabel('Save (Ctrl+S)')).toBe('Save (Ctrl+S)')
    expect(hintLabel('Redo (Ctrl+Shift+Z)')).toBe('Redo (Ctrl+Shift+Z)')
  })
})

describe('keyLabel', () => {
  it('maps mac badge tokens to canonical labels', () => {
    expect(keyLabel('⌘')).toBe('Ctrl')
    expect(keyLabel('⇧')).toBe('Shift')
    expect(keyLabel('K')).toBe('K')
    expect(keyLabel('Ctrl')).toBe('Ctrl')
  })

  it('ignores the legacy isMac argument — the mac display branch is deleted, not conditional', () => {
    // Mutation guard: reintroducing `if (isMac) return key` makes these red. The parameter only
    // exists so unmigrated two-argument call sites compile; it must never select mac notation.
    expect(keyLabel('⌘', true)).toBe('Ctrl')
    expect(keyLabel('⇧', true)).toBe('Shift')
  })
})

describe('isMacPlatform / isWindowsPlatform', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is false outside a DOM — no navigator means no Mac browser client', () => {
    // The pre-rewire fallback was TRUE (mac notation by default); that default is what painted
    // mac glyphs in every non-DOM context and must not come back.
    vi.stubGlobal('navigator', undefined)
    expect(isMacPlatform()).toBe(false)
    expect(isWindowsPlatform()).toBe(false)
  })

  it('answers from the real client navigator (Server Edition browser tab)', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: '' })
    expect(isMacPlatform()).toBe(true)
    expect(isWindowsPlatform()).toBe(false)
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: '' })
    expect(isMacPlatform()).toBe(false)
    expect(isWindowsPlatform()).toBe(true)
  })
})
