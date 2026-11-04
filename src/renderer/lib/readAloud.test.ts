// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { READ_ALOUD_MAX, pickReadAloudText, readAloudTrack } from './readAloud'

describe('pickReadAloudText', () => {
  it('prefers the selection and collapses whitespace', () => {
    const p = document.createElement('p')
    p.textContent = 'focused'
    expect(pickReadAloudText('  hello \n world ', p)).toBe('hello world')
  })

  it('falls back to the focused element, never a password value', () => {
    const input = document.createElement('input')
    input.value = 'typed text'
    expect(pickReadAloudText('', input)).toBe('typed text')
    input.type = 'password'
    expect(pickReadAloudText('', input)).toBe('')
    const btn = document.createElement('button')
    btn.setAttribute('aria-label', 'Close panel')
    expect(pickReadAloudText('', btn)).toBe('Close panel')
    expect(pickReadAloudText('', document.body)).toBe('')
    expect(pickReadAloudText('', null)).toBe('')
  })

  it('caps long text at a word end', () => {
    const long = 'word '.repeat(2000)
    const out = pickReadAloudText(long, null)
    expect(out.length).toBeLessThanOrEqual(READ_ALOUD_MAX)
    expect(out.endsWith('word')).toBe(true)
  })
})

describe('readAloudTrack', () => {
  it('uses Cantonese for Han text only when Cantonese is allowed', () => {
    expect(readAloudTrack('早晨 everyone', true)).toBe('yue')
    expect(readAloudTrack('早晨', false)).toBe('en')
    expect(readAloudTrack('good morning', true)).toBe('en')
  })
})
