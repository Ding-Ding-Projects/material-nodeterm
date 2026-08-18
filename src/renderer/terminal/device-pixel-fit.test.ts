import { describe, expect, it } from 'vitest'
import {
  RASTER_SCALE_MAX,
  RASTER_SCALE_STEP,
  devicePixelSnapOffset,
  isPixelExact,
  resampleFactor,
  terminalRasterScale
} from './device-pixel-fit'

/**
 * The dprs that actually decide this, not a tidy set. 1 and 2 are the mac world (integers, where
 * both defects hide); 1.25 and 1.5 are Windows at 125% and 150%, which is the delivery platform's
 * normal state and where the "text is a bit blurry" report came from. 1.5 is the dpr the
 * measurement in the module header was taken at.
 */
const DPRS = [1, 1.25, 1.5, 2] as const

/** Canvas zooms: the identity, React Flow's `minZoom`/`maxZoom` ends, and the fractional values a
 *  continuous wheel-zoom (`zoom * Math.exp(-d * 0.01)`) actually produces — never round numbers. */
const ZOOMS = [0.01, 0.37, 0.83, 0.9048, 1, 1.0725, 1.3, 1.618, 2] as const

describe('terminalRasterScale', () => {
  it('is the display dpr at zoom 1, on every dpr users have', () => {
    // The load-bearing base case: at zoom 1 the raster the app already produces IS correct, so
    // this rule must not move a single terminal that is currently crisp. A helper that returned
    // anything but the dpr here would re-rasterize every atlas on the canvas for nothing.
    for (const dpr of DPRS) expect(terminalRasterScale(dpr, 1)).toBeCloseTo(dpr, 10)
  })

  it('is pixel-exact at zoom 1 — the configuration a device check compares against', () => {
    for (const dpr of DPRS) expect(isPixelExact(dpr, 1, terminalRasterScale(dpr, 1))).toBe(true)
  })

  it('rises with zoom-in, quantized to whole steps rather than following the wheel', () => {
    // dpr 1.5 × 1.3 = 1.95, which is 7.8 steps. It must land on 8 steps (2.0) — ABOVE the ideal,
    // never on the 7.75 below it, because a raster coarser than the screen is the blur being
    // removed. The quantization is what keeps a wheel gesture from rebuilding every atlas per
    // event; the ceil is what keeps that saving from costing crispness.
    expect(terminalRasterScale(1.5, 1.3)).toBeCloseTo(2, 10)
    expect(terminalRasterScale(1, 1.0725)).toBeCloseTo(1.25, 10)
    expect(terminalRasterScale(1.25, 1.618)).toBeCloseTo(2.25, 10)
  })

  it('never drops below the display dpr when zoomed OUT', () => {
    // A zoomed-out terminal could be drawn from a coarser raster, and doing that would be a trap:
    // the rebuild would then land during the zoom-IN, while the user is looking at the text, and
    // minifying a dpr-resolution raster is exactly what the atlas mip chain and its gutters are
    // built for. So zoom < 1 must change nothing.
    for (const dpr of DPRS) {
      for (const zoom of ZOOMS.filter((z) => z < 1)) {
        expect(terminalRasterScale(dpr, zoom)).toBeCloseTo(dpr, 10)
      }
    }
  })

  it('never magnifies the raster, except where the memory ceiling deliberately says so', () => {
    // The property the whole module is for: one raster texel must cover at most one device pixel.
    // The single exception is the clamp, which is a stated trade (atlas memory is quadratic and is
    // paid per live GPU context, under the same cap `webgl-budget.ts` defends) — so the test
    // asserts the exception is reachable ONLY through the clamp, not that it never happens.
    for (const dpr of DPRS) {
      for (const zoom of ZOOMS) {
        const scale = terminalRasterScale(dpr, zoom)
        const factor = resampleFactor(dpr, zoom, scale)
        if (dpr * zoom <= RASTER_SCALE_MAX) expect(factor).toBeLessThanOrEqual(1 + 1e-9)
        else expect(scale).toBe(RASTER_SCALE_MAX)
      }
    }
  })

  it('is monotonic in zoom — a zoom-in never asks for a coarser raster', () => {
    // A non-monotonic rule would make a single smooth gesture rebuild atlases up AND back down,
    // which is the churn the step exists to bound.
    for (const dpr of DPRS) {
      let previous = 0
      for (const zoom of [...ZOOMS].sort((a, b) => a - b)) {
        const scale = terminalRasterScale(dpr, zoom)
        expect(scale).toBeGreaterThanOrEqual(previous - 1e-12)
        previous = scale
      }
    }
  })

  it('lands on the quantization grid or on the dpr floor, never between them', () => {
    for (const dpr of DPRS) {
      for (const zoom of ZOOMS) {
        const scale = terminalRasterScale(dpr, zoom)
        const onGrid = Math.abs(scale / RASTER_SCALE_STEP - Math.round(scale / RASTER_SCALE_STEP)) < 1e-9
        expect(onGrid || Math.abs(scale - dpr) < 1e-12).toBe(true)
      }
    }
  })

  it('clamps at the memory ceiling even when the ideal scale is far past it', () => {
    expect(terminalRasterScale(2, 2)).toBe(RASTER_SCALE_MAX)
    expect(terminalRasterScale(1.5, 2)).toBe(RASTER_SCALE_MAX)
    // The ceiling outranks the dpr floor on purpose: a hypothetical dpr-4 panel would otherwise
    // demand a 16× atlas per context. It costs that display some sharpness and nothing else.
    expect(terminalRasterScale(4, 1)).toBe(RASTER_SCALE_MAX)
  })

  it('answers a finite, usable scale for a browser that reported nonsense', () => {
    // A NaN scale does not make text soft — it blanks the raster. Unknown must degrade to "the
    // behaviour we already ship" (scale 1), never to NaN or 0.
    for (const bad of [NaN, 0, -1, Infinity, -Infinity]) {
      expect(terminalRasterScale(bad, 1)).toBe(1)
      expect(terminalRasterScale(1.5, bad)).toBeCloseTo(1.5, 10)
      expect(Number.isFinite(terminalRasterScale(bad, bad))).toBe(true)
    }
  })
})

describe('resampleFactor / isPixelExact', () => {
  it('names the two measured defects as non-exact and says which way each goes', () => {
    // Zoom 0.83 at dpr 1.5 with a dpr-resolution raster: the raster is MINIFIED (factor < 1).
    // Measured cost on Windows/dpr 1.5: fully-on ink 0.552 -> 0.311.
    expect(resampleFactor(1.5, 0.83, 1.5)).toBeCloseTo(0.83, 10)
    expect(isPixelExact(1.5, 0.83, 1.5)).toBe(false)
    // Zoom 1.3: MAGNIFIED (factor > 1) unless the raster followed the zoom.
    expect(resampleFactor(1.5, 1.3, 1.5)).toBeCloseTo(1.3, 10)
    expect(isPixelExact(1.5, 1.3, terminalRasterScale(1.5, 1.3))).toBe(false)
    // ...and following it removes the magnification: 1.95 ideal against a 2.0 raster.
    expect(resampleFactor(1.5, 1.3, terminalRasterScale(1.5, 1.3))).toBeLessThanOrEqual(1)
  })

  it('does not call xterm’s own canvas rounding a defect', () => {
    // xterm sizes the WebGL canvas `round(deviceCanvas / dpr)` CSS px, so its backing store is off
    // 1:1 by ~6e-4 (measured: deviceRatio 1.00063 at dpr 1.5, 80 columns). That is real and it is
    // NOT what anyone reported — keeping the tolerance far below it stops a future reader from
    // "fixing" the wrong thing, while still refusing the 0.83 and 1.3 cases above.
    expect(isPixelExact(1.5, 1, 1.5 * 1.00063)).toBe(false)
    expect(resampleFactor(1.5, 1, 1.5 * 1.00063)).toBeGreaterThan(0.999)
  })

  it('treats an unreadable dpr/zoom/scale as 1 rather than dividing by zero', () => {
    expect(Number.isFinite(resampleFactor(NaN, 1, 1.5))).toBe(true)
    expect(resampleFactor(1.5, 1, 0)).toBeCloseTo(1.5, 10)
  })
})

describe('devicePixelSnapOffset', () => {
  it('puts an arbitrary pan on the device grid, on every dpr', () => {
    // THE DOMINANT TERM AT DEFAULT ZOOM. React Flow's viewport `translate(x, y)` carries arbitrary
    // fractions; at dpr 1.5 a CSS offset is device-aligned only on multiples of 2/3, which a pan
    // never is. Measured cost of a 0.37/0.61 px offset alone: fully-on ink 0.552 -> 0.335 (-39%),
    // with no change of zoom or font.
    for (const dpr of DPRS) {
      for (const coord of [0, 0.37, -0.61, 9.555, 123.4567, -1024.001, 1e6 + 0.5]) {
        const snapped = (coord + devicePixelSnapOffset(coord, dpr)) * dpr
        expect(Math.abs(snapped - Math.round(snapped))).toBeLessThan(1e-6)
      }
    }
  })

  it('never moves content by as much as a device pixel', () => {
    // The correction has to be invisible: half a device pixel is the most it can ever be, which is
    // the same trade `glyphgrid/camera.ts` already makes for the shared renderer's camera.
    for (const dpr of DPRS) {
      for (const coord of [0.37, -0.61, 9.555, 123.4567, 7.3333333, -0.0001]) {
        expect(Math.abs(devicePixelSnapOffset(coord, dpr))).toBeLessThanOrEqual(0.5 / dpr + 1e-12)
      }
    }
  })

  it('is a no-op for a coordinate that is already aligned', () => {
    // Integers on dpr 1/2, and the real grids: 0.8 steps at dpr 1.25, 2/3 steps at dpr 1.5.
    expect(devicePixelSnapOffset(42, 1)).toBe(0)
    expect(devicePixelSnapOffset(42.5, 2)).toBe(0)
    expect(Math.abs(devicePixelSnapOffset(4.8, 1.25))).toBeLessThan(1e-12)
    expect(Math.abs(devicePixelSnapOffset(4 / 3, 1.5))).toBeLessThan(1e-12)
  })

  it('snaps NOTHING when the dpr or the coordinate is unknown', () => {
    // Same policy as `snapPanToDevicePx`: a grid we cannot name is not a grid to round onto, and a
    // NaN offset added to a transform moves the whole canvas nowhere visible at all.
    for (const bad of [NaN, 0, -1, Infinity]) expect(devicePixelSnapOffset(10.3, bad)).toBe(0)
    expect(devicePixelSnapOffset(NaN, 1.5)).toBe(0)
  })
})
