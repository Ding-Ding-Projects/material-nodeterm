// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useRegexSearchField, type RegexSearchFieldState } from './useRegexSearchField'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Behavioral suite for the ONE search-field contract every regex-capable surface shares
 * (find bar, Explorer filter, command palette, settings search, FilterableMenu — see the hook's
 * own doc comment). The contract under test, from docs/regex-builder.md and the shared
 * instructions: plain text is the DEFAULT, regex is an explicit opt-in, and query / pattern /
 * flags / validation / mode synchronize BIDIRECTIONALLY — an invalid pattern is reported without
 * discarding what the user typed.
 *
 * The hook is driven through a real React render (it is a hook, not a pure function), and every
 * assertion reads the hook's own returned state — the same object `<AnchoredRegexBuilder>` binds
 * to, so the builder↔field sync test below exercises the exact write path the component uses.
 */

let host: HTMLElement
let root: Root
// Reassigned on every render by the harness — always read AFTER the `act()` that mutated state.
let field!: RegexSearchFieldState

function Harness({ initial }: { initial?: Parameters<typeof useRegexSearchField>[0] }): null {
  field = useRegexSearchField(initial)
  return null
}

function mount(initial?: Parameters<typeof useRegexSearchField>[0]): void {
  act(() => root.render(createElement(Harness, { initial })))
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('plain text is the default, and it matches LITERALLY', () => {
  it('starts in text mode and a query of a.b does NOT match axb', () => {
    mount()
    expect(field.mode).toBe('text')
    act(() => field.setValue('a.b'))
    expect(field.query).toBe('a.b')
    expect(field.value).toBe('a.b')
    expect(field.active).toBe(true)
    expect(field.test('before a.b after')).toBe(true)
    // The flagship assertion: a dot in plain-text mode is a dot, not a wildcard.
    expect(field.test('axb')).toBe(false)
    // Text mode is a case-insensitive substring match.
    expect(field.test('A.B')).toBe(true)
    expect(field.error).toBeNull()
  })

  it('an empty query matches everything — filtering never hides a list vacuously', () => {
    mount()
    expect(field.active).toBe(false)
    expect(field.test('anything at all')).toBe(true)
  })
})

describe('regex is an explicit opt-in', () => {
  it('flipping text→regex seeds the pattern ESCAPED, so the same literal text still matches', () => {
    mount()
    act(() => field.setValue('a.b'))
    act(() => field.setMode('regex'))
    expect(field.mode).toBe('regex')
    // escapeForRegex seeded the pattern from the query: the dot arrives escaped.
    expect(field.pattern).toBe('a\\.b')
    expect(field.value).toBe('a\\.b')
    expect(field.test('a.b')).toBe(true)
    expect(field.test('axb')).toBe(false)
  })

  it('editing the seeded pattern into a real regex makes the metacharacters live', () => {
    mount()
    act(() => field.setMode('regex'))
    act(() => field.setValue('a.b'))
    expect(field.test('axb')).toBe(true)
    expect(field.test('a b')).toBe(true)
    expect(field.test('ab')).toBe(false)
  })
})

describe('flags apply to the live match', () => {
  it('case-insensitivity is the shipped default flag, and clearing it is honored', () => {
    mount()
    act(() => field.setMode('regex'))
    act(() => field.setValue('ABC'))
    expect(field.flags).toBe('i')
    expect(field.test('abc')).toBe(true)
    act(() => field.setFlags(''))
    expect(field.test('abc')).toBe(false)
    expect(field.test('xABCx')).toBe(true)
  })

  it('dot-all: . crosses a newline only under the s flag', () => {
    mount({ mode: 'regex', pattern: 'a.b', flags: '' })
    expect(field.test('a\nb')).toBe(false)
    act(() => field.setFlags('s'))
    expect(field.test('a\nb')).toBe(true)
  })

  it('multiline: ^ matches at a line boundary only under the m flag', () => {
    mount({ mode: 'regex', pattern: '^world', flags: '' })
    expect(field.test('hello\nworld')).toBe(false)
    act(() => field.setFlags('m'))
    expect(field.test('hello\nworld')).toBe(true)
  })

  it('a g-flagged pattern gives the same verdict on every call — no lastIndex carry-over', () => {
    mount({ mode: 'regex', pattern: 'needle', flags: 'gi' })
    // A cached `g` regex retains lastIndex across .test() calls, making every OTHER call against
    // the same candidate return false. Four calls, not two, so an even-count accident cannot pass.
    const verdicts = [
      field.test('needle'),
      field.test('needle'),
      field.test('needle'),
      field.test('needle')
    ]
    expect(verdicts).toEqual([true, true, true, true])
  })
})

describe('unicode, zero-width and multibyte input behave sanely', () => {
  it('\\u{…} escapes work under the u flag and astral characters match', () => {
    mount({ mode: 'regex', pattern: '\\u{1F600}', flags: 'u' })
    expect(field.error).toBeNull()
    expect(field.test('smile \u{1F600} here')).toBe(true)
    expect(field.test('no smile')).toBe(false)
  })

  it('a zero-width lookahead filters correctly and repeated calls do not wedge', () => {
    mount({ mode: 'regex', pattern: '(?=x)', flags: 'g' })
    expect(field.test('axb')).toBe(true)
    // Zero-width + g is the classic lastIndex trap — the second identical call must agree.
    expect(field.test('axb')).toBe(true)
    expect(field.test('ab')).toBe(false)
  })

  it('a pattern that can match empty matches every candidate rather than erroring', () => {
    mount({ mode: 'regex', pattern: 'a*', flags: '' })
    expect(field.error).toBeNull()
    expect(field.test('zzz')).toBe(true)
  })
})

describe('an invalid pattern is reported WITHOUT discarding what the user typed', () => {
  it('keeps the broken source in the input, surfaces the error, and fails open', () => {
    mount()
    act(() => field.setMode('regex'))
    act(() => field.setValue('(unclosed'))
    // Nothing the user typed was thrown away.
    expect(field.pattern).toBe('(unclosed')
    expect(field.value).toBe('(unclosed')
    // The failure is REPORTED…
    expect(field.error).toBeTruthy()
    expect(typeof field.error).toBe('string')
    // …and the list is not hidden behind it: an uncompilable pattern matches everything.
    expect(field.test('anything at all')).toBe(true)
    // The user finishes typing and the field recovers in place — same editing session.
    act(() => field.setValue('(closed)'))
    expect(field.error).toBeNull()
    expect(field.test('closed')).toBe(true)
    expect(field.test('open')).toBe(false)
  })

  it('a catastrophic-looking pattern gets its own refusal message and also fails open', () => {
    mount({ mode: 'regex', pattern: '(a+)+', flags: '' })
    expect(field.pattern).toBe('(a+)+')
    expect(field.error).toMatch(/run away/i)
    expect(field.test('aaaa')).toBe(true)
  })

  it('a broken retained pattern reports NO error while the field is back in text mode', () => {
    mount({ mode: 'regex', pattern: '(broken', flags: 'i' })
    expect(field.error).toBeTruthy()
    act(() => field.setMode('text'))
    // Validation is a regex-mode fact; the text field must not wear a stale regex error.
    expect(field.error).toBeNull()
    // The seeded query is a LITERAL now.
    expect(field.test('x(brokeny')).toBe(true)
  })
})

describe('query, pattern, flags and mode synchronize bidirectionally', () => {
  it('mode flips are lossless in both directions and neither slot is discarded', () => {
    mount()
    act(() => field.setMode('regex'))
    act(() => field.setValue('foo+'))
    act(() => field.setMode('text'))
    expect(field.mode).toBe('text')
    // regex→text seeded the empty query from the pattern source…
    expect(field.query).toBe('foo+')
    expect(field.value).toBe('foo+')
    // …and it now matches as a LITERAL.
    expect(field.test('xfoo+y')).toBe(true)
    expect(field.test('fooo')).toBe(false)
    act(() => field.setMode('regex'))
    // The regex source was retained, not re-seeded/escaped from the query.
    expect(field.pattern).toBe('foo+')
    expect(field.test('fooo')).toBe(true)
  })

  it('a non-empty value in the destination mode is never overwritten by a flip', () => {
    mount({ query: 'typedText', pattern: 'typed.*Pattern' })
    act(() => field.setMode('regex'))
    expect(field.pattern).toBe('typed.*Pattern')
    act(() => field.setMode('text'))
    expect(field.query).toBe('typedText')
  })

  it("the builder's writes (setMode → setValue/setFlags) land in the same state the field reads", () => {
    mount()
    act(() => field.setValue('plain'))
    // Exactly what AnchoredRegexBuilder's trigger does on click…
    act(() => {
      if (field.mode !== 'regex') field.setMode('regex')
    })
    // …and what its RegexBuilder onChange does with the edited pattern + flags:
    act(() => field.setValue('pl.in'))
    act(() => field.setFlags('is'))
    expect(field.mode).toBe('regex')
    expect(field.pattern).toBe('pl.in')
    expect(field.flags).toBe('is')
    // The visible input shows the builder's pattern — one state, two writers, zero drift.
    expect(field.value).toBe('pl.in')
    expect(field.test('PLAIN')).toBe(true)
  })

  it('toggleMode round-trips, and reset clears both slots while keeping mode and flags', () => {
    mount()
    act(() => field.setValue('abc'))
    act(() => field.toggleMode())
    expect(field.mode).toBe('regex')
    act(() => field.toggleMode())
    expect(field.mode).toBe('text')
    act(() => field.setFlags('gu'))
    act(() => field.reset())
    expect(field.query).toBe('')
    expect(field.pattern).toBe('')
    expect(field.active).toBe(false)
    expect(field.mode).toBe('text')
    expect(field.flags).toBe('gu')
    expect(field.test('anything')).toBe(true)
  })
})
