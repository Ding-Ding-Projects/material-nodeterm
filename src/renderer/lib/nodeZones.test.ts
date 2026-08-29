import { describe, it, expect } from 'vitest'
import { ZONES, ZONE_GUTTER_PX, ZONE_MARGIN_PX, zoneTargetRect } from './nodeZones'

// Zone snapping (issue #394 v1, ported): the viewport→flow subdivision the keyboard chords and
// the "Snap to zone" menu both use. All screen-px assertions run at zoom 1 / camera origin so
// flow equals screen; one case pins the zoom conversion.

const VP = { x: 0, y: 0, zoom: 1 }
const W = 1200
const H = 800
const M = ZONE_MARGIN_PX
const G = ZONE_GUTTER_PX

describe('zoneTargetRect', () => {
  it('left/right halves split the margin-inset area and share one gutter', () => {
    const left = zoneTargetRect(VP, W, H, 'left-half')!
    const right = zoneTargetRect(VP, W, H, 'right-half')!
    expect(left.x).toBe(M)
    expect(left.y).toBe(M)
    expect(left.height).toBe(H - 2 * M)
    expect(right.x + right.width).toBe(W - M)
    expect(right.x - (left.x + left.width)).toBeCloseTo(G)
    expect(left.width).toBeCloseTo(right.width)
  })

  it('quarters meet at gutters on both axes', () => {
    const tl = zoneTargetRect(VP, W, H, 'top-left')!
    const br = zoneTargetRect(VP, W, H, 'bottom-right')!
    expect(tl).toMatchObject({ x: M, y: M })
    expect(br.x + br.width).toBe(W - M)
    expect(br.y + br.height).toBe(H - M)
    expect(br.x - (tl.x + tl.width)).toBeCloseTo(G)
    expect(br.y - (tl.y + tl.height)).toBeCloseTo(G)
  })

  it('converts to flow coordinates like a fit-view (zoom + camera offset)', () => {
    const vp = { x: -100, y: 50, zoom: 0.5 }
    const left = zoneTargetRect(vp, W, H, 'left-half')!
    expect(left.x).toBeCloseTo((M + 100) / 0.5)
    expect(left.y).toBeCloseTo((M - 50) / 0.5)
    expect(left.width).toBeCloseTo((W - 2 * M - G) / 2 / 0.5)
  })

  it('refuses a zone smaller than a node header, per zone rather than per container', () => {
    expect(zoneTargetRect(VP, 0, 0, 'left-half')).toBeNull()
    // 280px wide: a HALF of the width comes out under the minimum…
    expect(zoneTargetRect(VP, 280, 800, 'left-half')).toBeNull()
    // …but a full-width zone in the same container still fits.
    expect(zoneTargetRect(VP, 280, 800, 'top-half')).not.toBeNull()
    expect(zoneTargetRect(VP, 1200, 800, 'nope' as never)).toBeNull()
  })

  it('refuses a degenerate zoom', () => {
    expect(zoneTargetRect({ x: 0, y: 0, zoom: 0 }, W, H, 'left-half')).toBeNull()
  })

  it('every declared zone answers on a normal container', () => {
    for (const z of ZONES) {
      const rect = zoneTargetRect(VP, W, H, z.id)
      expect(rect, z.id).not.toBeNull()
      expect(rect!.width).toBeGreaterThan(0)
      expect(rect!.height).toBeGreaterThan(0)
    }
  })
})
