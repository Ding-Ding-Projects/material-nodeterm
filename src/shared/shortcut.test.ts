import { describe, expect, it } from 'vitest'
import {
  buildModifierChord,
  captureToShortcut,
  chordHeld,
  formatShortcut,
  isHoldChord,
  isModifierEventKey,
  matchesShortcut,
  parseShortcut,
  resolvedModifiers,
  serializeShortcut,
  shortcutKeyParts
} from './shortcut'

const event = (overrides: Partial<Parameters<typeof matchesShortcut>[0]> = {}) => ({
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  key: 'k',
  ...overrides
})

describe('shortcut parsing and canonical serialization', () => {
  it('parses canonical Control, named keys, punctuation, and hold chords', () => {
    expect(parseShortcut('Ctrl+Shift+D')).toEqual({
      cmd: false, ctrl: true, shift: true, alt: false, key: 'D'
    })
    expect(parseShortcut('Ctrl+Enter')).toEqual({
      cmd: false, ctrl: true, shift: false, alt: false, key: 'ENTER'
    })
    expect(parseShortcut('Ctrl+Alt')).toEqual({
      cmd: false, ctrl: true, shift: false, alt: true, key: null
    })
    expect(parseShortcut('Ctrl+Comma').key).toBe(',')
  })

  it('reads legacy Cmd and Command spellings without emitting them', () => {
    for (const raw of ['Cmd+K', 'Command+Shift+D', 'command+alt']) {
      const parsed = parseShortcut(raw)
      expect(parsed.cmd).toBe(true)
      expect(resolvedModifiers(parsed)).toEqual({ meta: false, ctrl: true, alt: parsed.alt, shift: parsed.shift })
      expect(serializeShortcut(parsed)).not.toMatch(/Cmd|Command/)
    }
    expect(serializeShortcut(parseShortcut('Cmd+Shift+D'))).toBe('Ctrl+Shift+D')
    expect(serializeShortcut(parseShortcut('Command+Return'))).toBe('Ctrl+Enter')
  })

  it('canonicalizes modifier order and collapses duplicate primary spellings', () => {
    expect(serializeShortcut(parseShortcut('shift+d+cmd'))).toBe('Ctrl+Shift+D')
    expect(serializeShortcut(parseShortcut('Cmd+Ctrl+T'))).toBe('Ctrl+T')
    expect(serializeShortcut(parseShortcut('Ctrl+Esc'))).toBe('Ctrl+Escape')
  })
})

describe('shortcut formatting', () => {
  it('always renders Control notation and never platform glyphs', () => {
    for (const raw of ['Ctrl+Shift+D', 'Cmd+Alt+F5', 'Command+Comma', 'Ctrl+Alt']) {
      expect(formatShortcut(raw)).toBe(formatShortcut(raw, true))
      expect(formatShortcut(raw)).toMatch(/^Ctrl|^Alt|^[A-Za-z]/)
      expect(formatShortcut(raw)).not.toMatch(/[⌘⌃⌥⇧]/)
    }
    expect(formatShortcut('Cmd+Shift+D')).toBe('Ctrl+Shift+D')
    expect(shortcutKeyParts('Cmd+Space')).toEqual(['Ctrl', 'Space'])
  })

  it('keeps named keys as one display part and does not add a hold key', () => {
    expect(shortcutKeyParts('Ctrl+Shift+F5')).toEqual(['Ctrl', 'Shift', 'F5'])
    expect(shortcutKeyParts('Ctrl+Alt')).toEqual(['Ctrl', 'Alt'])
  })
})

describe('Control-only matching', () => {
  it('matches canonical and legacy strings only with ctrlKey', () => {
    expect(matchesShortcut(event({ ctrlKey: true }), 'Ctrl+K')).toBe(true)
    expect(matchesShortcut(event({ ctrlKey: true }), 'Cmd+K')).toBe(true)
    expect(matchesShortcut(event({ metaKey: true }), 'Ctrl+K')).toBe(false)
    expect(matchesShortcut(event({ metaKey: true, ctrlKey: true }), 'Ctrl+K')).toBe(false)
  })

  it('requires the exact modifier set and key', () => {
    expect(matchesShortcut(event({ ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+K')).toBe(true)
    expect(matchesShortcut(event({ ctrlKey: true }), 'Ctrl+Shift+K')).toBe(false)
    expect(matchesShortcut(event({ ctrlKey: true, shiftKey: true, altKey: true }), 'Ctrl+Shift+K')).toBe(false)
    expect(matchesShortcut(event({ ctrlKey: true, key: 'x' }), 'Ctrl+K')).toBe(false)
    expect(matchesShortcut(event({ ctrlKey: true, key: 'F5' }), 'Ctrl+F5')).toBe(true)
    expect(matchesShortcut(event({ ctrlKey: true, key: ',' }), 'Cmd+Comma')).toBe(true)
  })

  it('never matches modifier-only chords through the keyed matcher', () => {
    expect(matchesShortcut(event({ ctrlKey: true, altKey: true }), 'Ctrl+Alt')).toBe(false)
    expect(isHoldChord('Ctrl+Alt')).toBe(true)
    expect(isHoldChord('Ctrl+Alt+K')).toBe(false)
  })
})

describe('hold chords', () => {
  it('requires Control and exact modifiers', () => {
    expect(chordHeld(event({ ctrlKey: true, altKey: true }), 'Ctrl+Alt')).toBe(true)
    expect(chordHeld(event({ metaKey: true, altKey: true }), 'Cmd+Alt')).toBe(false)
    expect(chordHeld(event({ ctrlKey: true }), 'Ctrl+Alt')).toBe(false)
    expect(chordHeld(event({ ctrlKey: true, altKey: true, shiftKey: true }), 'Ctrl+Alt')).toBe(false)
  })

  it('builds canonical hold strings and refuses the duplicate Control shape', () => {
    expect(buildModifierChord({ cmd: true, alt: true, shift: false })).toBe('Ctrl+Alt')
    expect(buildModifierChord({ cmd: true, alt: false, shift: true })).toBe('Ctrl+Shift')
    expect(buildModifierChord({ cmd: false, alt: true, shift: true })).toBeNull()
    expect(buildModifierChord({ cmd: true, ctrl: true, alt: false, shift: false })).toBeNull()
  })
})

describe('Control capture', () => {
  it('captures Ctrl plus a non-modifier key in canonical form', () => {
    const captured = captureToShortcut(event({ ctrlKey: true, shiftKey: true, key: 'd' }))
    expect(captured).toBe('Ctrl+Shift+D')
    expect(captured).not.toMatch(/Cmd|Command|⌘/)
    expect(matchesShortcut(event({ ctrlKey: true, shiftKey: true, key: 'd' }), captured!)).toBe(true)
  })

  it('refuses Meta, missing Control, and modifier-only keydowns', () => {
    expect(captureToShortcut(event({ metaKey: true, key: 'd' }))).toBeNull()
    expect(captureToShortcut(event({ key: 'd' }))).toBeNull()
    expect(captureToShortcut(event({ ctrlKey: true, key: 'Control' }))).toBeNull()
    expect(captureToShortcut(event({ ctrlKey: true, metaKey: true, key: 'd' }))).toBeNull()
  })
})

describe('modifier event classification and cache', () => {
  it('recognizes modifier key names and rejects regular keys', () => {
    expect(isModifierEventKey('Control')).toBe(true)
    expect(isModifierEventKey('Meta')).toBe(true)
    expect(isModifierEventKey('Shift')).toBe(true)
    expect(isModifierEventKey('Alt')).toBe(true)
    expect(isModifierEventKey('Escape')).toBe(false)
    expect(isModifierEventKey('K')).toBe(false)
  })

  it('memoizes frozen parsed values without changing the canonical result', () => {
    const first = parseShortcut('Cmd+Shift+D')
    expect(parseShortcut('Cmd+Shift+D')).toBe(first)
    expect(Object.isFrozen(first)).toBe(true)
    expect(serializeShortcut(first)).toBe('Ctrl+Shift+D')
  })
})
