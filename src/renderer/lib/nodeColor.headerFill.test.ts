import { describe, it, expect } from 'vitest'
import { nodeHeaderFillStyle, RAINBOW_COLOR } from './nodeColor'
import { contrastRatio, parseAnyColor } from './color/convert'

/**
 * `nodeHeaderFillStyle` is what makes a node's title bar carry its colour FULLY (a solid header
 * fill) instead of the thin `borderTopColor` outline it used to be limited to (reported 2026-08-20
 * against a collapsed node: a gold outline, everything else default-dark).
 *
 * These tests pin the two things that make a full-colour fill safe rather than merely colourful:
 * the computed foreground is readable against the fill it sits on, at the WCAG AA text floor
 * (~4.5:1), for the worst-case colours the infinite picker can produce — and the fill itself is
 * forced fully opaque so a translucent picked colour cannot quietly weaken that contrast.
 */

const AA_TEXT_FLOOR = 4.5
// A small allowance below the exact 4.5 floor for the crossover hues, where the better of the two
// poles (white/black) lands JUST under the textbook threshold by a few thousandths — the function's
// own doc comment explains why (the two candidate-pole contrast curves cross at ~4.56/4.60 against
// a mid-luminance background, not at a round number). Never widen this to hide a real regression;
// it exists only for float-precision slack at the crossover, not as slack for the general case.
const AA_TEXT_FLOOR_TOLERANCE = 0.05

function fgColor(style: { color?: string }): { r: number; g: number; b: number; a: number } {
  const rgba = style.color ? parseAnyColor(style.color) : null
  expect(rgba, `expected a parseable foreground colour, got ${style.color}`).toBeTruthy()
  return rgba!
}

describe('nodeHeaderFillStyle', () => {
  it('fills the header with the node colour at full opacity, even for a translucent input', () => {
    const result = nodeHeaderFillStyle('rgba(217, 119, 87, 0.3)')
    expect(result.filled).toBe(true)
    const bg = parseAnyColor(result.style.background!)
    expect(bg).toBeTruthy()
    expect(bg!.a).toBe(1)
  })

  it('picks white text on a near-black colour', () => {
    const result = nodeHeaderFillStyle('#050505')
    expect(result.style.color).toBeTruthy()
    // Near-black background: white must win, not the surface-container-derived on-surface token.
    expect(result.style.color).toMatch(/255,\s*255,\s*255/)
  })

  it('picks black text on a near-white colour', () => {
    const result = nodeHeaderFillStyle('#fafafa')
    expect(result.style.color).toMatch(/^rgba?\(\s*0,\s*0,\s*0/)
  })

  it('clears every AA text floor across a sweep of the node colour palette hues', () => {
    // Real node swatches span the whole wheel at moderate-to-high saturation and lightness — the
    // exact region where "just pick white" or "just pick black" fails hardest. Sweep it rather
    // than trust one or two hand-picked colours.
    const failures: string[] = []
    for (let hue = 0; hue < 360; hue += 15) {
      for (const lightness of [20, 35, 50, 65, 80]) {
        const color = `hsl(${hue}, 70%, ${lightness}%)`
        const result = nodeHeaderFillStyle(color)
        expect(result.filled, `${color} should be treated as a real fill`).toBe(true)
        const bg = parseAnyColor(result.style.background!)!
        const fg = fgColor(result.style)
        const ratio = contrastRatio(fg, bg)
        if (ratio < AA_TEXT_FLOOR - AA_TEXT_FLOOR_TOLERANCE) {
          failures.push(`${color} -> ratio ${ratio.toFixed(3)}`)
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('always chooses the pole with the higher contrast, never the fixed loser', () => {
    // Directly re-derive the "which pole wins" decision from the two candidate contrasts and
    // confirm the function actually returns the winner, rather than a colour that merely happens
    // to be readable. Guards against a future edit silently hardcoding one pole.
    const samples = ['#204060', '#e0b060', '#7a1030', '#30a080', '#111111', '#eeeeee']
    for (const color of samples) {
      const bg = parseAnyColor(color)!
      const white = { r: 255, g: 255, b: 255, a: 1 }
      const black = { r: 0, g: 0, b: 0, a: 1 }
      const wantWhite = contrastRatio(white, bg) >= contrastRatio(black, bg)
      const result = nodeHeaderFillStyle(color)
      const gotWhite = /255,\s*255,\s*255/.test(result.style.color ?? '')
      expect(gotWhite, `${color}: expected ${wantWhite ? 'white' : 'black'} to win`).toBe(wantWhite)
    }
  })

  it('degrades to nothing for the rainbow sentinel, never a computed fill', () => {
    const result = nodeHeaderFillStyle(RAINBOW_COLOR)
    expect(result.filled).toBe(false)
    expect(result.className).toBe('nt-rainbow')
    expect(result.style.background).toBeUndefined()
    expect(result.style.color).toBeUndefined()
  })

  it('degrades to nothing for an unset or unparsable colour', () => {
    expect(nodeHeaderFillStyle(undefined)).toEqual({ className: '', filled: false, style: {} })
    expect(nodeHeaderFillStyle('not-a-colour')).toEqual({
      className: '',
      filled: false,
      style: {}
    })
  })
})
