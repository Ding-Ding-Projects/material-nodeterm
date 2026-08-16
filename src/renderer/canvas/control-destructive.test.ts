import { describe, expect, it } from 'vitest'
import { DESTRUCTIVE_VERBS } from '@shared/control-verbs'
import { destructiveControlBlocked } from '../lib/controlDestructive'

describe('control destructive confirmation collision policy', () => {
  it.each([...DESTRUCTIVE_VERBS])('blocks %s while another confirmation owns the screen', (verb) => {
    expect(destructiveControlBlocked(verb, true)).toBe(true)
    expect(destructiveControlBlocked(verb, false)).toBe(false)
  })

  it('does not block a non-destructive verb merely because another dialog is open', () => {
    expect(destructiveControlBlocked('rename', true)).toBe(false)
  })
})
