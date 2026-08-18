import { describe, expect, it } from 'vitest'
import { parseAnyColor } from '@renderer/lib/color/convert'
import { alphaTint } from './tint'

/** A tint is only useful if a browser can parse it back — that is the whole defect being fixed. */
function isRenderable(css: string | undefined): boolean {
  return css != null && parseAnyColor(css) != null
}

describe('alphaTint produces a wash a browser can actually render', () => {
  it('washes a hex colour to the alpha the old hex suffix produced', () => {
    // 34/255 is the `22` suffix `${data.color}22` used to append.
    expect(alphaTint('#0a84ff', 34 / 255)).toBe('rgba(10, 132, 255, 0.133)')
  })

  it('washes a NON-hex colour instead of producing garbage', () => {
    // The discriminating case, and the reason this function exists: the picker's RGB/HSL/OKLCH
    // tabs all store non-hex text, and `"rgb(10, 132, 255)" + "22"` is not a colour — CSS drops
    // the declaration and the sticky note / group frame renders with no tint at all.
    expect(alphaTint('rgb(10, 132, 255)', 34 / 255)).toBe('rgba(10, 132, 255, 0.133)')
    expect(isRenderable(alphaTint('hsl(211, 100%, 52%)', 34 / 255))).toBe(true)
    expect(isRenderable(alphaTint('oklch(0.65 0.2 250)', 34 / 255))).toBe(true)
    expect(isRenderable(alphaTint('rebeccapurple', 34 / 255))).toBe(true)

    // Pinned against the naive implementation, which is silently wrong here.
    expect(isRenderable(`rgb(10, 132, 255)22`)).toBe(false)
  })

  it('never makes the wash more opaque than the colour it washes', () => {
    // A colour picked WITH alpha is already partly transparent; overwriting alpha instead of
    // multiplying it would make a 50%-transparent note MORE solid than the user chose.
    expect(alphaTint('rgba(0, 0, 0, 0.5)', 0.2)).toBe('rgba(0, 0, 0, 0.1)')
  })

  it('scales with the requested alpha rather than returning one fixed wash', () => {
    // Guards a mutant that ignores `alpha`: the two group-frame washes (bound vs unbound) differ
    // only by this argument, so a constant would make a bound worktree frame indistinguishable.
    expect(alphaTint('#ffffff', 28 / 255)).not.toBe(alphaTint('#ffffff', 15 / 255))
  })

  it('degrades to nothing — never to a wrong colour — for a value it cannot parse', () => {
    // Hand-edited .nodeterm/project.json is the realistic source. Returning the raw string would
    // paint the note SOLID in that colour; returning a preset would be a colour nobody chose.
    expect(alphaTint('not-a-colour', 0.2)).toBeUndefined()
    expect(alphaTint('', 0.2)).toBeUndefined()
    expect(alphaTint(undefined, 0.2)).toBeUndefined()
  })
})
