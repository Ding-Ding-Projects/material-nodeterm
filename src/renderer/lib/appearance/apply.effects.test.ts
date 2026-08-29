import { describe, expect, it } from 'vitest'
import { styleToCssProperties } from './apply'

describe('compositing and transform', () => {
  it('emits nothing when no effect property is set', () => {
    const out = styleToCssProperties({ fontSizePx: 13 })
    for (const k of ['opacity', 'mix-blend-mode', 'filter', 'backdrop-filter', 'transform', 'transform-origin']) {
      expect(out[k]).toBeUndefined()
    }
  })

  it('composes the filter stack in a fixed order', () => {
    const out = styleToCssProperties({
      filterBlurPx: 2,
      filterBrightness: 1.2,
      filterSaturate: 0.5,
      filterHueRotateDeg: 90
    })
    // blur is written last regardless of the order the caller set the fields in
    expect(out.filter).toBe('brightness(1.2) saturate(0.5) hue-rotate(90deg) blur(2px)')
  })

  it('composes transform as translate, rotate, scale, skew', () => {
    const out = styleToCssProperties({
      skewXDeg: 5,
      scaleX: 2,
      rotateDeg: 45,
      translateXPx: 10
    })
    expect(out.transform).toBe('translate(10px, 0px) rotate(45deg) scale(2, 1) skew(5deg, 0deg)')
  })

  it('omits a normal blend mode rather than writing the default', () => {
    expect(styleToCssProperties({ blendMode: 'normal' })['mix-blend-mode']).toBeUndefined()
    expect(styleToCssProperties({ blendMode: 'multiply' })['mix-blend-mode']).toBe('multiply')
  })

  it('keeps zero as a real value, not an unset one', () => {
    // 0 is falsy; a `if (style.opacity)` guard would silently drop a fully transparent element.
    expect(styleToCssProperties({ opacity: 0 }).opacity).toBe('0')
    expect(styleToCssProperties({ filterGrayscale: 0 }).filter).toBe('grayscale(0)')
  })
})
