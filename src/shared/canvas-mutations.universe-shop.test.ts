import { describe, expect, it } from 'vitest'
import { applyCanvasMutation, isCanvasMutation } from './canvas-mutations'
import type { CanvasNodeState } from './types'

const shop: CanvasNodeState = {
  id: 'shop-mv', kind: 'shop', position: { x: 0, y: 0 }, size: { width: 480, height: 420 },
  title: 'Shop', color: '#6750a4', group: null, nonDeletable: true, creationEventId: 'evt-shop'
}

describe('Shop mutation boundary', () => {
  it('refuses removing a Shop and duplicate creation events without touching ordinary nodes', () => {
    const remove = { op: 'remove' as const, id: shop.id }
    expect(applyCanvasMutation([shop], remove)).toEqual([shop])
    const ordinary: CanvasNodeState = { ...shop, id: 'sticky-1', kind: 'sticky', title: 'ordinary' }
    const upsert = { op: 'upsert' as const, node: { ...ordinary, id: 'sticky-2', creationEventId: 'evt-shop' } }
    expect(applyCanvasMutation([shop, ordinary], upsert)).toEqual([shop, ordinary])
  })

  it('rejects malformed event ids at the wire boundary', () => {
    expect(isCanvasMutation({ op: 'upsert', node: { ...shop, creationEventId: 'x\ninvalid' } })).toBe(false)
  })
})
