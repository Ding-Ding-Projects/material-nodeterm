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
  shortcutKeyParts
} from './shortcut'

describe('parseShortcut', () => {
  it('parses the default combo', () => {
    expect(parseShortcut('Ctrl+Shift+D')).toEqual({ cmd: true, shift: true, alt: false, key: 'D' })
  })

  it('parses a combo without Shift/Alt', () => {
    expect(parseShortcut('Ctrl+D')).toEqual({ cmd: true, shift: false, alt: false, key: 'D' })
  })

  it('parses Alt', () => {
    expect(parseShortcut('Ctrl+Alt+D')).toEqual({ cmd: true, shift: false, alt: true, key: 'D' })
  })

  it('parses a named key (F-key)', () => {
    expect(parseShortcut('Ctrl+F5')).toEqual({ cmd: true, shift: false, alt: false, key: 'F5' })
  })

  it('parses a named key (Space)', () => {
    expect(parseShortcut('Ctrl+Shift+Space')).toEqual({
      cmd: true,
      shift: true,
      alt: false,
      key: 'SPACE'
    })
  })

  it('is tolerant of stray whitespace', () => {
    expect(parseShortcut(' Ctrl + Shift + D ')).toEqual({
      cmd: true,
      shift: true,
      alt: false,
      key: 'D'
    })
  })

  it('parses a modifier-only chord (no trailing key) — the v3 hold-to-talk shape', () => {
    expect(parseShortcut('Ctrl+Alt')).toEqual({ cmd: true, alt: true, shift: false, key: null })
  })

  it('parses a modifier-only chord with all three modifiers', () => {
    expect(parseShortcut('Ctrl+Alt+Shift')).toEqual({
      cmd: true,
      alt: true,
      shift: true,
      key: null
    })
  })
})

// settings.json is forever: every pre-rewire install stores its shortcuts (defaults AND rebinds)
// in the old `Cmd+…` notation. Dropping the alias would kill all of that user's hotkeys on
// upgrade with no error anywhere — the whole reason `cmd`/`command` stay parseable.
describe('legacy "Cmd" alias (pre-rewire settings.json compat)', () => {
  it('parses identically to the canonical Ctrl token', () => {
    for (const [legacy, canonical] of [
      ['Cmd+K', 'Ctrl+K'],
      ['Cmd+Shift+D', 'Ctrl+Shift+D'],
      ['Cmd+Alt', 'Ctrl+Alt'],
      ['Command+Enter', 'Ctrl+Enter']
    ] as const) {
      expect(parseShortcut(legacy)).toEqual(parseShortcut(canonical))
    }
  })

  it('a stored legacy combo still matches a Ctrl keydown on Windows/Linux', () => {
    expect(
      matchesShortcut(
        { metaKey: false, ctrlKey: true, shiftKey: false, altKey: false, key: 'm' },
        'Cmd+M',
        false
      )
    ).toBe(true)
  })

  it('a stored legacy combo still renders canonical Ctrl badges', () => {
    expect(formatShortcut('Cmd+Shift+D', false)).toBe('Ctrl+Shift+D')
  })
})

describe('formatShortcut', () => {
  it('formats the default combo for the mac browser client with symbols', () => {
    expect(formatShortcut('Ctrl+Shift+D', true)).toBe('⌘⇧D')
  })

  it('formats the default combo off mac as Ctrl+Shift+D', () => {
    expect(formatShortcut('Ctrl+Shift+D', false)).toBe('Ctrl+Shift+D')
  })

  it('formats Alt on mac', () => {
    expect(formatShortcut('Ctrl+Alt+D', true)).toBe('⌘⌥D')
  })

  it('formats Alt off mac', () => {
    expect(formatShortcut('Ctrl+Alt+D', false)).toBe('Ctrl+Alt+D')
  })

  it('formats a bare primary-modifier combo', () => {
    expect(formatShortcut('Ctrl+D', true)).toBe('⌘D')
    expect(formatShortcut('Ctrl+D', false)).toBe('Ctrl+D')
  })

  it('formats named keys with friendly labels', () => {
    expect(formatShortcut('Ctrl+Space', true)).toBe('⌘Space')
    expect(formatShortcut('Ctrl+Shift+F5', false)).toBe('Ctrl+Shift+F5')
  })

  it('round-trips parse -> format -> parse (mac and non-mac agree on the parsed shape)', () => {
    for (const combo of ['Ctrl+Shift+D', 'Ctrl+D', 'Ctrl+Alt+Shift+F5']) {
      const parsed = parseShortcut(combo)
      // Formatting for either platform is a pure display transform of the same parsed shape —
      // reformatting a fresh capture (captureToShortcut) must reparse identically.
      expect(parseShortcut(combo)).toEqual(parsed)
    }
  })

  it('formats a modifier-only chord (Ctrl+Alt) on mac with no trailing key badge', () => {
    expect(formatShortcut('Ctrl+Alt', true)).toBe('⌘⌥')
  })

  it('formats a modifier-only chord (Ctrl+Alt) off mac with no trailing key badge', () => {
    expect(formatShortcut('Ctrl+Alt', false)).toBe('Ctrl+Alt')
  })

  it('round-trips a modifier-only chord through parse -> format -> parse', () => {
    for (const combo of ['Ctrl+Alt', 'Ctrl+Alt+Shift']) {
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
    expect(shortcutKeyParts('Ctrl+Shift+D', true)).toEqual(['⌘', '⇧', 'D'])
  })

  it('splits the default combo into one badge per key off mac', () => {
    expect(shortcutKeyParts('Ctrl+Shift+D', false)).toEqual(['Ctrl', 'Shift', 'D'])
  })

  it('keeps a multi-char named key as a single badge (not split into letters)', () => {
    expect(shortcutKeyParts('Ctrl+Space', true)).toEqual(['⌘', 'Space'])
  })

  it('joins to the same string formatShortcut returns', () => {
    for (const [combo, isMac] of [
      ['Ctrl+Shift+D', true],
      ['Ctrl+Shift+D', false],
      ['Ctrl+Alt+Shift+F5', true]
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
    expect(matchesShortcut({ ...base, metaKey: true, shiftKey: true }, 'Ctrl+Shift+D', true)).toBe(
      true
    )
  })

  it('does NOT match on mac when ctrlKey stands in for metaKey', () => {
    expect(matchesShortcut({ ...base, ctrlKey: true, shiftKey: true }, 'Ctrl+Shift+D', true)).toBe(
      false
    )
  })

  it('matches off mac with ctrlKey as the primary modifier', () => {
    expect(
      matchesShortcut({ ...base, ctrlKey: true, shiftKey: true }, 'Ctrl+Shift+D', false)
    ).toBe(true)
  })

  it('does NOT match off mac when metaKey stands in for ctrlKey', () => {
    expect(
      matchesShortcut({ ...base, metaKey: true, shiftKey: true }, 'Ctrl+Shift+D', false)
    ).toBe(false)
  })

  it('rejects a missing Shift', () => {
    expect(matchesShortcut({ ...base, metaKey: true, shiftKey: false }, 'Ctrl+Shift+D', true)).toBe(
      false
    )
  })

  it('rejects an extra Alt not in the combo', () => {
    expect(
      matchesShortcut({ ...base, metaKey: true, shiftKey: true, altKey: true }, 'Ctrl+Shift+D', true)
    ).toBe(false)
  })

  it('rejects the wrong letter key', () => {
    expect(
      matchesShortcut({ ...base, metaKey: true, shiftKey: true, key: 'e' }, 'Ctrl+Shift+D', true)
    ).toBe(false)
  })

  it('is case-insensitive on e.key when Shift is held (browsers report the shifted char)', () => {
    // Shift+d is delivered as e.key === 'D' by the DOM; either case must match.
    expect(
      matchesShortcut({ ...base, metaKey: true, shiftKey: true, key: 'D' }, 'Ctrl+Shift+D', true)
    ).toBe(true)
    expect(
      matchesShortcut({ ...base, metaKey: true, shiftKey: true, key: 'd' }, 'Ctrl+Shift+D', true)
    ).toBe(true)
  })

  it('matches a bare primary-modifier combo with no Shift/Alt required', () => {
    expect(matchesShortcut({ ...base, metaKey: true }, 'Ctrl+D', true)).toBe(true)
  })

  it('matches named keys (F-key)', () => {
    expect(
      matchesShortcut({ ...base, metaKey: true, key: 'F5' }, 'Ctrl+F5', true)
    ).toBe(true)
  })

  it('matches the bracket chords from the KEY the DOM reports (breadcrumb trail)', () => {
    // The registry spells these `Ctrl+[` / `Ctrl+]` because this resolver compares against
    // `e.key`. Spelled as the `e.code` values (`BracketLeft`/`BracketRight`) they would
    // normalize to 'BRACKETLEFT' and match no keydown at all — a silently dead chord.
    expect(matchesShortcut({ ...base, metaKey: true, key: '[' }, 'Ctrl+[', true)).toBe(true)
    expect(matchesShortcut({ ...base, metaKey: true, key: ']' }, 'Ctrl+]', true)).toBe(true)
    expect(matchesShortcut({ ...base, metaKey: true, key: '[' }, 'Ctrl+]', true)).toBe(false)
  })

  it('never matches a modifier-only chord — that shape has no key to check', () => {
    // Even a keydown of a real key while the exact modifiers are held must not match: a
    // modifier-only shortcut is handled by chordHeld, not matchesShortcut.
    expect(matchesShortcut({ ...base, metaKey: true, altKey: true, key: 'd' }, 'Ctrl+Alt', true)).toBe(
      false
    )
  })
})

describe('isHoldChord', () => {
  it('is true for a modifier-only combo', () => {
    expect(isHoldChord('Ctrl+Alt')).toBe(true)
    expect(isHoldChord('Ctrl+Alt+Shift')).toBe(true)
  })

  it('is false for a keyed combo', () => {
    expect(isHoldChord('Ctrl+Alt+D')).toBe(false)
    expect(isHoldChord('Ctrl+D')).toBe(false)
  })
})

describe('isModifierEventKey', () => {
  it('recognizes modifier key names, case-insensitively', () => {
    expect(isModifierEventKey('Meta')).toBe(true)
    expect(isModifierEventKey('CONTROL')).toBe(true)
    expect(isModifierEventKey('alt')).toBe(true)
    expect(isModifierEventKey('Shift')).toBe(true)
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
    expect(chordHeld({ ...base, metaKey: true, altKey: true }, 'Ctrl+Alt', true)).toBe(true)
  })

  it('is true when the event modifiers exactly match the chord (non-mac, ctrlKey primary)', () => {
    expect(chordHeld({ ...base, ctrlKey: true, altKey: true }, 'Ctrl+Alt', false)).toBe(true)
  })

  it('is false when the primary modifier is missing', () => {
    expect(chordHeld({ ...base, altKey: true }, 'Ctrl+Alt', true)).toBe(false)
  })

  it('is false when a required modifier (alt) is missing', () => {
    expect(chordHeld({ ...base, metaKey: true }, 'Ctrl+Alt', true)).toBe(false)
  })

  it('is false when an EXTRA modifier is held beyond what the chord requires', () => {
    expect(chordHeld({ ...base, metaKey: true, altKey: true, shiftKey: true }, 'Ctrl+Alt', true)).toBe(
      false
    )
  })

  it('is false on the wrong platform primary (ctrlKey standing in for metaKey on mac)', () => {
    expect(chordHeld({ ...base, ctrlKey: true, altKey: true }, 'Ctrl+Alt', true)).toBe(false)
  })

  it('ignores e.key entirely — same result regardless of which key the event names', () => {
    expect(chordHeld({ ...base, metaKey: true, altKey: true, key: 'd' }, 'Ctrl+Alt', true)).toBe(true)
  })
})

describe('buildModifierChord', () => {
  it('builds a Ctrl+Alt combo', () => {
    expect(buildModifierChord({ cmd: true, alt: true, shift: false })).toBe('Ctrl+Alt')
  })

  it('builds a Ctrl+Alt+Shift combo', () => {
    expect(buildModifierChord({ cmd: true, alt: true, shift: true })).toBe('Ctrl+Alt+Shift')
  })

  it('builds a bare Ctrl combo', () => {
    expect(buildModifierChord({ cmd: true, alt: false, shift: false })).toBe('Ctrl')
  })

  it('returns null when the primary modifier is missing', () => {
    expect(buildModifierChord({ cmd: false, alt: true, shift: true })).toBeNull()
  })

  it('round-trips through parseShortcut', () => {
    const combo = buildModifierChord({ cmd: true, alt: true, shift: false })
    expect(combo).not.toBeNull()
    expect(parseShortcut(combo as string)).toEqual({ cmd: true, alt: true, shift: false, key: null })
    expect(isHoldChord(combo as string)).toBe(true)
  })
})

describe('captureToShortcut', () => {
  it('emits the canonical Ctrl token from a mac-browser keydown (metaKey primary)', () => {
    // The capture NEVER emits the legacy `Cmd` alias — a rebind performed today must be stored
    // in canonical notation, or new settings files would keep minting mac-era strings.
    expect(
      captureToShortcut({ metaKey: true, ctrlKey: false, shiftKey: true, altKey: false, key: 'd' }, true)
    ).toBe('Ctrl+Shift+D')
  })

  it('emits the canonical Ctrl token from a non-mac keydown (ctrlKey primary)', () => {
    expect(
      captureToShortcut(
        { metaKey: false, ctrlKey: true, shiftKey: true, altKey: false, key: 'd' },
        false
      )
    ).toBe('Ctrl+Shift+D')
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
})
