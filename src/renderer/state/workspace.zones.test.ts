import { describe, it, expect } from 'vitest'
import { placeNodeInRect, type CanvasNode } from './workspace'

// Zone snap (issue #394 v1, ported): placeNodeInRect is the plain-placement core the keyboard
// chords and the "Snap to zone" menu both call once zoneTargetRect has resolved a rect.

const RECT = { x: 1000, y: 2000, width: 1600, height: 900 }

const term = (
  id: string,
  position = { x: 0, y: 0 },
  size = { width: 320, height: 240 },
  extra: Partial<CanvasNode> = {}
): CanvasNode =>
  ({
    id,
    type: 'terminal',
    position,
    width: size.width,
    height: size.height,
    data: { title: id, color: '#fff', group: null },
    ...extra
  }) as CanvasNode

const group = (id: string, position = { x: 0, y: 0 }): CanvasNode =>
  ({
    id,
    type: 'group',
    position,
    width: 600,
    height: 400,
    data: { title: id, color: '#fff', group: null }
  }) as CanvasNode

describe('placeNodeInRect (zone snap, issue #394 v1)', () => {
  it('places a top-level node at the rect', () => {
    const next = placeNodeInRect([term('a', { x: 40, y: 60 })], 'a', RECT)
    const a = next.find((n) => n.id === 'a')!
    expect(a.position).toEqual({ x: 1000, y: 2000 })
    expect(a.width).toBe(1600)
    expect(a.height).toBe(900)
  })

  it('drops the stale measured size so a re-measure race cannot persist the old dimensions', () => {
    const withMeasured = { ...term('a'), measured: { width: 320, height: 240 } } as CanvasNode
    const next = placeNodeInRect([withMeasured], 'a', RECT)
    expect(next[0].measured).toBeUndefined()
  })

  it('re-fits the frame around a grouped node, absolute rect honoured', () => {
    const g = group('g', { x: 100, y: 100 })
    const child = term('a', { x: 50, y: 80 }, { width: 320, height: 240 }, { parentId: 'g', extent: 'parent' })
    const next = placeNodeInRect([g, child], 'a', RECT)
    const a = next.find((n) => n.id === 'a')!
    const frame = next.find((n) => n.id === 'g')!
    expect(frame.position.x + a.position.x).toBeCloseTo(RECT.x)
    expect(frame.position.y + a.position.y).toBeCloseTo(RECT.y)
    expect((frame.width as number)!).toBeGreaterThanOrEqual(RECT.width)
  })

  it('refuses group frames, collapsed nodes and unknown ids', () => {
    const collapsed = term('c', { x: 0, y: 0 })
    collapsed.data = { ...collapsed.data, collapsed: true }
    expect(placeNodeInRect([group('g', { x: 0, y: 0 })], 'g', RECT)[0].width).toBe(600)
    expect(placeNodeInRect([collapsed], 'c', RECT)[0].width).toBe(320)
    expect(placeNodeInRect([term('a', { x: 1, y: 2 })], 'nope', RECT)).toEqual([term('a', { x: 1, y: 2 })])
  })
})
