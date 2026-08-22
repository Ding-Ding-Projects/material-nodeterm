import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MaterialSymbol } from './MaterialSymbol'
import { MATERIAL_SYMBOLS } from './materialSymbols.generated'

describe('MaterialSymbol', () => {
  it('renders the bundled codepoint character for a known glyph name, decoratively by default', () => {
    const html = renderToStaticMarkup(<MaterialSymbol name="settings" />)
    expect(html).toContain(MATERIAL_SYMBOLS.settings)
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('role="img"')
  })

  it('exposes an accessible name and role="img" when a label is given', () => {
    const html = renderToStaticMarkup(<MaterialSymbol name="close" label="Close" />)
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Close"')
    expect(html).not.toContain('aria-hidden')
  })

  it('sets the FILL variable axis to 1 only when fill is true, and adds the msrf class', () => {
    const outlined = renderToStaticMarkup(<MaterialSymbol name="lock" />)
    const filled = renderToStaticMarkup(<MaterialSymbol name="lock" fill />)
    expect(outlined).toContain("&#x27;FILL&#x27; 0")
    expect(outlined).not.toContain('msrf')
    expect(filled).toContain("&#x27;FILL&#x27; 1")
    expect(filled).toContain('msrf')
  })

  it('clamps size/weight into the font\'s declared opsz/wght ranges', () => {
    const tiny = renderToStaticMarkup(<MaterialSymbol name="add" size={4} weight={10} />)
    const huge = renderToStaticMarkup(<MaterialSymbol name="add" size={999} weight={9999} />)
    expect(tiny).toContain("&#x27;opsz&#x27; 20")
    expect(tiny).toContain("&#x27;wght&#x27; 100")
    expect(huge).toContain("&#x27;opsz&#x27; 48")
    expect(huge).toContain("&#x27;wght&#x27; 700")
  })

  it('renders every one of the 92 bundled glyph names without throwing', () => {
    for (const name of Object.keys(MATERIAL_SYMBOLS) as (keyof typeof MATERIAL_SYMBOLS)[]) {
      expect(() => renderToStaticMarkup(<MaterialSymbol name={name} />)).not.toThrow()
    }
    expect(Object.keys(MATERIAL_SYMBOLS)).toHaveLength(92)
  })
})
