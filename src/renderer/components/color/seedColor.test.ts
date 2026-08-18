import { describe, expect, it } from 'vitest'
import { seedColor } from './seedColor'

describe('seedColor decides what a colour picker opens on', () => {
  it('seeds from the colour a single target is actually wearing', () => {
    expect(seedColor(['#0a84ff'])).toBe('#0a84ff')
  })

  it('seeds from an agreed colour across a whole selection', () => {
    expect(seedColor(['#0a84ff', '#0a84ff', '#0a84ff'])).toBe('#0a84ff')
  })

  it('omits the seed when the selection disagrees, rather than announcing one member as the truth', () => {
    // The failure this prevents: the picker opens on node A's blue, and the user's first drag
    // moves ALL selected nodes to a shade of blue — including the four that were green.
    expect(seedColor(['#0a84ff', '#32d74b'])).toBeUndefined()
  })

  it('does not treat two spellings of one colour as a disagreement', () => {
    // Discriminating fixture: identical colour, different case. A strict `!==` comparison throws
    // away a seed we really do have.
    expect(seedColor(['#0A84FF', '#0a84ff'])).toBe('#0A84FF')
    expect(seedColor([' #0a84ff ', '#0a84ff'])).toBe(' #0a84ff ')
  })

  it('omits the seed when a target has no colour at all', () => {
    expect(seedColor([undefined])).toBeUndefined()
    expect(seedColor([null])).toBeUndefined()
    expect(seedColor(['#0a84ff', undefined])).toBeUndefined()
    expect(seedColor([undefined, '#0a84ff'])).toBeUndefined()
    expect(seedColor(['   '])).toBeUndefined()
  })

  it('omits the seed for an empty selection', () => {
    expect(seedColor([])).toBeUndefined()
  })
})
