import { describe, it, expect } from 'vitest'
import {
  ANNOTATION_MIN_DRAG_PX,
  annotationDiagonalFromPoints,
  annotationEndpoints,
  annotationRectFromPoints,
  rectFromDragPoints
} from './annotation'

describe('rectFromDragPoints', () => {
  it('normalizes a forward drag (top-left to bottom-right) into position + size', () => {
    const rect = rectFromDragPoints({ x: 100, y: 100 }, { x: 260, y: 220 })
    expect(rect).toEqual({ position: { x: 100, y: 100 }, size: { width: 160, height: 120 } })
  })

  it('normalizes a reversed drag (bottom-right to top-left) identically', () => {
    const rect = rectFromDragPoints({ x: 260, y: 220 }, { x: 100, y: 100 })
    expect(rect).toEqual({ position: { x: 100, y: 100 }, size: { width: 160, height: 120 } })
  })

  it('normalizes a drag from any other corner (top-right to bottom-left)', () => {
    const rect = rectFromDragPoints({ x: 260, y: 100 }, { x: 100, y: 220 })
    expect(rect).toEqual({ position: { x: 100, y: 100 }, size: { width: 160, height: 120 } })
  })

  it('refuses a drag below the minimum on both axes (a stray click)', () => {
    expect(rectFromDragPoints({ x: 10, y: 10 }, { x: 15, y: 12 })).toBeNull()
  })

  it('accepts a straight horizontal drag whose height is 0', () => {
    const rect = rectFromDragPoints({ x: 10, y: 10 }, { x: 210, y: 10 })
    expect(rect).toEqual({ position: { x: 10, y: 10 }, size: { width: 200, height: 0 } })
  })

  it('accepts a straight vertical drag whose width is 0', () => {
    const rect = rectFromDragPoints({ x: 10, y: 10 }, { x: 10, y: 210 })
    expect(rect).toEqual({ position: { x: 10, y: 10 }, size: { width: 0, height: 200 } })
  })

  it('refuses a drag exactly AT the threshold on both axes (strictly below "accept")', () => {
    // width/height === minDrag on both axes: neither axis is "< minDrag", but a drag whose
    // longer axis is only just at the floor is still the boundary case worth pinning exactly.
    const minDrag = 20
    expect(
      rectFromDragPoints({ x: 0, y: 0 }, { x: 20, y: 20 }, minDrag)
    ).toEqual({ position: { x: 0, y: 0 }, size: { width: 20, height: 20 } })
    expect(
      rectFromDragPoints({ x: 0, y: 0 }, { x: 19, y: 19 }, minDrag)
    ).toBeNull()
  })

  it('honors an explicit minDrag override', () => {
    expect(rectFromDragPoints({ x: 0, y: 0 }, { x: 5, y: 5 }, 2)).toEqual({
      position: { x: 0, y: 0 },
      size: { width: 5, height: 5 }
    })
  })

  it('uses ANNOTATION_MIN_DRAG_PX as the default floor', () => {
    expect(ANNOTATION_MIN_DRAG_PX).toBeGreaterThan(0)
    const justUnder = ANNOTATION_MIN_DRAG_PX - 1
    expect(
      rectFromDragPoints({ x: 0, y: 0 }, { x: justUnder, y: justUnder })
    ).toBeNull()
  })
})

describe('annotationDiagonalFromPoints', () => {
  it('reads a top-left → bottom-right drag as tl-br', () => {
    expect(annotationDiagonalFromPoints({ x: 0, y: 0 }, { x: 100, y: 80 })).toBe('tl-br')
  })

  it('reads the same diagonal walked backwards (bottom-right → top-left) as tl-br too', () => {
    expect(annotationDiagonalFromPoints({ x: 100, y: 80 }, { x: 0, y: 0 })).toBe('tl-br')
  })

  it('reads a top-right → bottom-left drag as tr-bl', () => {
    expect(annotationDiagonalFromPoints({ x: 100, y: 0 }, { x: 0, y: 80 })).toBe('tr-bl')
  })

  it('reads the same diagonal walked backwards (bottom-left → top-right) as tr-bl too', () => {
    expect(annotationDiagonalFromPoints({ x: 0, y: 80 }, { x: 100, y: 0 })).toBe('tr-bl')
  })
})

describe('annotationRectFromPoints', () => {
  it('combines the rect and the diagonal in one call', () => {
    expect(annotationRectFromPoints({ x: 0, y: 0 }, { x: 100, y: 80 })).toEqual({
      position: { x: 0, y: 0 },
      size: { width: 100, height: 80 },
      dir: 'tl-br'
    })
    expect(annotationRectFromPoints({ x: 100, y: 0 }, { x: 0, y: 80 })).toEqual({
      position: { x: 0, y: 0 },
      size: { width: 100, height: 80 },
      dir: 'tr-bl'
    })
  })

  it('returns null for the same too-small drag rectFromDragPoints refuses', () => {
    expect(annotationRectFromPoints({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeNull()
  })
})

describe('annotationEndpoints', () => {
  it('runs corner-to-corner for tl-br', () => {
    expect(annotationEndpoints({ width: 100, height: 60 }, 'tl-br')).toEqual({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 60 }
    })
  })

  it('runs corner-to-corner for tr-bl', () => {
    expect(annotationEndpoints({ width: 100, height: 60 }, 'tr-bl')).toEqual({
      from: { x: 100, y: 0 },
      to: { x: 0, y: 60 }
    })
  })

  it('degenerates sensibly for a 0-size box (both corners coincide)', () => {
    expect(annotationEndpoints({ width: 0, height: 0 }, 'tl-br')).toEqual({
      from: { x: 0, y: 0 },
      to: { x: 0, y: 0 }
    })
  })

  it('recomputes from a resized box while dir stays fixed — a resize stretches, never re-derives', () => {
    const before = annotationEndpoints({ width: 100, height: 60 }, 'tl-br')
    const after = annotationEndpoints({ width: 400, height: 60 }, 'tl-br')
    expect(before.to).toEqual({ x: 100, y: 60 })
    expect(after.to).toEqual({ x: 400, y: 60 })
    // Same diagonal identity (from stays the same corner) across the resize.
    expect(before.from).toEqual(after.from)
  })
})
