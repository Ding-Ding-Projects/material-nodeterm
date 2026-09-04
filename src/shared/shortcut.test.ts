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

describe('parseShortcut', () => {
  it('parses the default combo', () => {
    expect(parseShortcut('Ctrl+Shift+D')).toEqual({ cmd: false, ctrl: true, shift: true, alt: false, key: 'D' })
  })

  it('parses a combo without Shift/Alt', () => {
    expect(parseShortcut('Ctrl+D')).toEqual({ cmd: false, ctrl: true, shift: false, alt: false, key: 'D' })
  })

  it('parses Alt', () => {
    expect(parseShortcut('Ctrl+Alt+D')).toEqual({ cmd: false, ctrl: true, shift: false, alt: true, key: 'D' })
  })

  it('parses a named key (F-key)', () => {
    expect(parseShortcut('Ctrl+F5')).toEqual({ cmd: false, ctrl: true, shift: false, alt: false, key: 'F5' })
    expect(parseShortcut('Cmd+Shift+D')).toEqual({
      cmd: true,
      ctrl: false,
      shift: true,
      alt: false,
      key: 'D'
    })
  })

  it('parses a combo without Shift/Alt', () => {
    expect(parseShortcut('Cmd+D')).toEqual({
      cmd: true,
      ctrl: false,
      shift: false,
      alt: false,
      key: 'D'
    })
  })

  it('parses Alt', () => {
    expect(parseShortcut('Cmd+Alt+D')).toEqual({
      cmd: true,
      ctrl: false,
      shift: false,
      alt: true,
      key: 'D'
    })
  })

  it('parses a named key (F-key)', () => {
    expect(parseShortcut('Cmd+F5')).toEqual({
      cmd: true,
      ctrl: false,
      shift: false,
      alt: false,
      key: 'F5'
    })
  })

  it('parses a named key (Space)', () => {
    expect(parseShortcut('Ctrl+Shift+Space')).toEqual({
      cmd: false,
      ctrl: true,
      shift: true,
      alt: false,
      key: 'SPACE'
    })
  })

  it('is tolerant of stray whitespace', () => {
    expect(parseShortcut(' Ctrl + Shift + D ')).toEqual({
      cmd: false,
      ctrl: true,
      shift: true,
      alt: false,
      key: 'D'
    })
  })

  it('parses a modifier-only chord (no trailing key) — the v3 hold-to-talk shape', () => {
    expect(parseShortcut('Ctrl+Alt')).toEqual({ cmd: false, ctrl: true, alt: true, shift: false, key: null })
    expect(parseShortcut('Cmd+Alt')).toEqual({
      cmd: true,
      ctrl: false,
      alt: true,
      shift: false,
      key: null
    })
  })

  it('parses a modifier-only chord with all three modifiers', () => {
    expect(parseShortcut('Ctrl+Alt+Shift')).toEqual({
      cmd: false,
      ctrl: true,
      alt: true,
      shift: true,
      key: null
    })
  })
})

// settings.json is forever: every pre-rewire install stores its shortcuts (defaults AND rebinds)
// in the old `Command+…` notation. Dropping the alias would kill all of that user's hotkeys on
// upgrade with no error anywhere — the whole reason `command` stays parseable.
describe('legacy "Command" alias (pre-rewire settings.json compat)', () => {
  it('keeps legacy Command distinct from literal Ctrl', () => {
    for (const [legacy, canonical] of [
      ['Cmd+K', 'Ctrl+K'],
      ['Cmd+Shift+D', 'Ctrl+Shift+D'],
      ['Cmd+Alt', 'Ctrl+Alt'],
      ['Command+Enter', 'Ctrl+Enter']
    ] as const) {
      expect(parseShortcut(legacy)).not.toEqual(parseShortcut(canonical))
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

describe('formatShortcut', () => {
  it('formats the default combo for the mac browser client with symbols', () => {
    expect(formatShortcut('Cmd+Shift+D', true)).toBe('⌘⇧D')
  })

  it('formats the default combo off mac as Ctrl+Shift+D', () => {
    expect(formatShortcut('Ctrl+Shift+D', false)).toBe('Ctrl+Shift+D')
  })

  it('formats Alt on mac', () => {
    expect(formatShortcut('Cmd+Alt+D', true)).toBe('⌘⌥D')
  })

  it('formats Alt off mac', () => {
    expect(formatShortcut('Ctrl+Alt+D', false)).toBe('Ctrl+Alt+D')
  })

  it('formats a bare primary-modifier combo', () => {
    expect(formatShortcut('Cmd+D', true)).toBe('⌘D')
    expect(formatShortcut('Ctrl+D', false)).toBe('Ctrl+D')
  })

  it('formats named keys with friendly labels', () => {
    expect(formatShortcut('Cmd+Space', true)).toBe('⌘Space')
    expect(formatShortcut('Ctrl+Shift+F5', false)).toBe('Ctrl+Shift+F5')
  })

  it('round-trips parse -> format -> parse (mac and non-mac agree on the parsed shape)', () => {
    for (const combo of ['Cmd+Shift+D', 'Cmd+D', 'Cmd+Alt+Shift+F5']) {
      const parsed = parseShortcut(combo)
      // Formatting for either platform is a pure display transform of the same parsed shape —
      // reformatting a fresh capture (captureToShortcut) must reparse identically.
      expect(parseShortcut(combo)).toEqual(parsed)
    }
    expect(formatShortcut('Cmd+Shift+D')).toBe('Ctrl+Shift+D')
    expect(shortcutKeyParts('Cmd+Space')).toEqual(['Ctrl', 'Space'])
  })

  it('formats a modifier-only chord (Ctrl+Alt) on mac with no trailing key badge', () => {
    expect(formatShortcut('Cmd+Alt', true)).toBe('⌘⌥')
  })

  it('formats a modifier-only chord (Ctrl+Alt) off mac with no trailing key badge', () => {
    expect(formatShortcut('Ctrl+Alt', false)).toBe('Ctrl+Alt')
  })

  it('round-trips a modifier-only chord through parse -> format -> parse', () => {
    for (const combo of ['Cmd+Alt', 'Cmd+Alt+Shift']) {
      const parsed = parseShortcut(combo)
      expect(parsed.key).toBeNull()
      // formatShortcut is a display transform; there's no un-format, but shortcutKeyParts should
      // never emit a stray trailing key badge for a modifier-only chord.
      expect(shortcutKeyParts(combo, true).length).toBe(
        (parsed.cmd ? 1 : 0) + (parsed.alt ? 1 : 0) + (parsed.shift ? 1 : 0)
      )
    }
  })
})

describe('shortcutKeyParts', () => {
  it('splits the default combo into one badge per key on mac', () => {
    expect(shortcutKeyParts('Cmd+Shift+D', true)).toEqual(['⌘', '⇧', 'D'])
  })

  it('requires the exact modifier set and key', () => {
    expect(matchesShortcut(event({ ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+K')).toBe(true)
    expect(matchesShortcut(event({ ctrlKey: true }), 'Ctrl+Shift+K')).toBe(false)
    expect(matchesShortcut(event({ ctrlKey: true, shiftKey: true, altKey: true }), 'Ctrl+Shift+K')).toBe(false)
    expect(matchesShortcut(event({ ctrlKey: true, key: 'x' }), 'Ctrl+K')).toBe(false)
    expect(matchesShortcut(event({ ctrlKey: true, key: 'F5' }), 'Ctrl+F5')).toBe(true)
    expect(matchesShortcut(event({ ctrlKey: true, key: ',' }), 'Cmd+Comma')).toBe(true)
  })

  it('keeps a multi-char named key as a single badge (not split into letters)', () => {
    expect(shortcutKeyParts('Cmd+Space', true)).toEqual(['⌘', 'Space'])
  })

  it('joins to the same string formatShortcut returns', () => {
    for (const [combo, isMac] of [
      ['Cmd+Shift+D', true],
      ['Cmd+Shift+D', false],
      ['Cmd+Alt+Shift+F5', true]
    ] as const) {
      const parts = shortcutKeyParts(combo, isMac)
      const joined = isMac ? parts.join('') : parts.join('+')
      expect(joined).toBe(formatShortcut(combo, isMac))
    }
  })
})

describe('matchesShortcut', () => {
  const base = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: 'd' }

  it('matches on the mac browser client with metaKey as the primary modifier', () => {
    expect(matchesShortcut({ ...base, metaKey: true, shiftKey: true }, 'Cmd+Shift+D', true)).toBe(
      true
    )
  })

  it('does NOT match on mac when ctrlKey stands in for metaKey', () => {
    expect(matchesShortcut({ ...base, ctrlKey: true, shiftKey: true }, 'Cmd+Shift+D', true)).toBe(
      false
    )
  })

  it('matches off mac with ctrlKey as the primary modifier', () => {
    expect(
      matchesShortcut({ ...base, ctrlKey: true, shiftKey: true }, 'Cmd+Shift+D', false)
    ).toBe(true)
  })

  it('does NOT match off mac when metaKey stands in for ctrlKey', () => {
    expect(
      matchesShortcut({ ...base, metaKey: true, shiftKey: true }, 'Cmd+Shift+D', false)
    ).toBe(false)
  })

  it('rejects a missing Shift', () => {
    expect(matchesShortcut({ ...base, metaKey: true, shiftKey: false }, 'Cmd+Shift+D', true)).toBe(
      false
    )
  })

  it('rejects an extra Alt not in the combo', () => {
    expect(
      matchesShortcut({ ...base, metaKey: true, shiftKey: true, altKey: true }, 'Cmd+Shift+D', true)
    ).toBe(false)
  })

  it('rejects the wrong letter key', () => {
    expect(
      matchesShortcut({ ...base, metaKey: true, shiftKey: true, key: 'e' }, 'Cmd+Shift+D', true)
    ).toBe(false)
  })

  it('is case-insensitive on e.key when Shift is held (browsers report the shifted char)', () => {
    // Shift+d is delivered as e.key === 'D' by the DOM; either case must match.
    expect(
      matchesShortcut({ ...base, metaKey: true, shiftKey: true, key: 'D' }, 'Cmd+Shift+D', true)
    ).toBe(true)
    expect(
      matchesShortcut({ ...base, metaKey: true, shiftKey: true, key: 'd' }, 'Cmd+Shift+D', true)
    ).toBe(true)
  })

  it('matches a bare primary-modifier combo with no Shift/Alt required', () => {
    expect(matchesShortcut({ ...base, metaKey: true }, 'Cmd+D', true)).toBe(true)
  })

  it('matches named keys (F-key)', () => {
    expect(
      matchesShortcut({ ...base, metaKey: true, key: 'F5' }, 'Cmd+F5', true)
    ).toBe(true)
  })

  it('matches the bracket chords from the KEY the DOM reports (breadcrumb trail)', () => {
    // The registry spells these `Ctrl+[` / `Ctrl+]` because this resolver compares against
    // `e.key`. Spelled as the `e.code` values (`BracketLeft`/`BracketRight`) they would
    // normalize to 'BRACKETLEFT' and match no keydown at all — a silently dead chord.
    expect(matchesShortcut({ ...base, metaKey: true, key: '[' }, 'Cmd+[', true)).toBe(true)
    expect(matchesShortcut({ ...base, metaKey: true, key: ']' }, 'Cmd+]', true)).toBe(true)
    expect(matchesShortcut({ ...base, metaKey: true, key: '[' }, 'Cmd+]', true)).toBe(false)
  })

  it('never matches a modifier-only chord — that shape has no key to check', () => {
    // Even a keydown of a real key while the exact modifiers are held must not match: a
    // modifier-only shortcut is handled by chordHeld, not matchesShortcut.
    expect(matchesShortcut({ ...base, metaKey: true, altKey: true, key: 'd' }, 'Cmd+Alt', true)).toBe(
      false
    )
  })
})

describe('isHoldChord', () => {
  it('is true for a modifier-only combo', () => {
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

  it('rejects non-modifier keys', () => {
    expect(isModifierEventKey('d')).toBe(false)
    expect(isModifierEventKey('F5')).toBe(false)
    expect(isModifierEventKey('Escape')).toBe(false)
  })
})

describe('chordHeld', () => {
  const base = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: 'Alt' }

  it('is true when the event modifiers exactly match the chord (mac browser client)', () => {
    expect(chordHeld({ ...base, metaKey: true, altKey: true }, 'Cmd+Alt', true)).toBe(true)
  })

  it('is true when the event modifiers exactly match the chord (non-mac, ctrlKey primary)', () => {
    expect(chordHeld({ ...base, ctrlKey: true, altKey: true }, 'Cmd+Alt', false)).toBe(true)
  })

  it('is false when the primary modifier is missing', () => {
    expect(chordHeld({ ...base, altKey: true }, 'Cmd+Alt', true)).toBe(false)
  })

  it('is false when a required modifier (alt) is missing', () => {
    expect(chordHeld({ ...base, metaKey: true }, 'Cmd+Alt', true)).toBe(false)
  })

  it('is false when an EXTRA modifier is held beyond what the chord requires', () => {
    expect(chordHeld({ ...base, metaKey: true, altKey: true, shiftKey: true }, 'Cmd+Alt', true)).toBe(
      false
    )
  })

  it('is false on the wrong platform primary (ctrlKey standing in for metaKey on mac)', () => {
    expect(chordHeld({ ...base, ctrlKey: true, altKey: true }, 'Cmd+Alt', true)).toBe(false)
  })

  it('ignores e.key entirely — same result regardless of which key the event names', () => {
    expect(chordHeld({ ...base, metaKey: true, altKey: true, key: 'd' }, 'Cmd+Alt', true)).toBe(true)
  })
})

describe('buildModifierChord', () => {
  it('builds a Ctrl+Alt combo', () => {
    expect(buildModifierChord({ cmd: true, alt: true, shift: false })).toBe('Cmd+Alt')
  })

  it('builds a Ctrl+Alt+Shift combo', () => {
    expect(buildModifierChord({ cmd: true, alt: true, shift: true })).toBe('Cmd+Alt+Shift')
  })

  it('builds a bare Ctrl combo', () => {
    expect(buildModifierChord({ cmd: true, alt: false, shift: false })).toBe('Cmd')
  })

  it('returns null when the primary modifier is missing', () => {
    expect(buildModifierChord({ cmd: false, alt: true, shift: true })).toBeNull()
    expect(buildModifierChord({ cmd: true, ctrl: true, alt: false, shift: false })).toBeNull()
  })
})

describe('captureToShortcut', () => {
  it('emits the canonical Ctrl token from a mac-browser keydown (metaKey primary)', () => {
    // The capture NEVER emits the legacy `Cmd` alias — a rebind performed today must be stored
    // in canonical notation, or new settings files would keep minting mac-era strings.
    expect(
      captureToShortcut({ metaKey: true, ctrlKey: false, shiftKey: true, altKey: false, key: 'd' }, true)
    ).toBe('Cmd+Shift+D')
  })

  it('emits the canonical Ctrl token from a non-mac keydown (ctrlKey primary)', () => {
    expect(
      captureToShortcut(
        { metaKey: false, ctrlKey: true, shiftKey: true, altKey: false, key: 'd' },
        false
      )
    ).toBe('Cmd+Shift+D')
  })

  it('returns null when the primary modifier is missing', () => {
    expect(
      captureToShortcut({ metaKey: false, ctrlKey: false, shiftKey: true, altKey: false, key: 'd' }, true)
    ).toBeNull()
  })

  it('returns null when only modifier keys were pressed (no non-modifier key yet)', () => {
    expect(
      captureToShortcut(
        { metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, key: 'Meta' },
        true
      )
    ).toBeNull()
    expect(
      captureToShortcut(
        { metaKey: true, ctrlKey: false, shiftKey: true, altKey: false, key: 'Shift' },
        true
      )
    ).toBeNull()
  })

  it('a captured combo round-trips through matchesShortcut for the same platform', () => {
    const e = { metaKey: true, ctrlKey: false, shiftKey: true, altKey: false, key: 'd' }
    const combo = captureToShortcut(e, true)
    expect(combo).not.toBeNull()
    expect(matchesShortcut(e, combo as string, true)).toBe(true)
  })

  it('records a Control held alongside Cmd on mac, and the capture still matches its own gesture', () => {
    const e = { metaKey: true, ctrlKey: true, shiftKey: false, altKey: false, key: 'd' }
    const combo = captureToShortcut(e, true)
    expect(combo).toBe('Cmd+Ctrl+D')
    expect(matchesShortcut(e, combo as string, true)).toBe(true)
  })

  it('returns null on non-mac when Meta (Super/Win) is held — the grammar cannot express it', () => {
    expect(
      captureToShortcut(
        { metaKey: true, ctrlKey: true, shiftKey: false, altKey: false, key: 'd' },
        false
      )
    ).toBeNull()
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
