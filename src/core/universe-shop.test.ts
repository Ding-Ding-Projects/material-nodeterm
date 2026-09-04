import { describe, expect, it } from 'vitest'
import {
  MAX_MULTIVERSE_DEPTH,
  UniverseShopCoordinator,
  createShopAtUniverseCreation,
  createSpecialUniverseCanvas,
  UniverseCanvasStore,
  repairUniverseShops,
  shopMutationDecision,
  shopNodeIdForCanvas
} from './universe-shop'
import type { PortableCanvasProjectionV3 } from './portable-canvas-projection'

function projection(overrides: Partial<PortableCanvasProjectionV3> = {}): PortableCanvasProjectionV3 {
  return {
    format: 'nodeterm-project',
    schemaVersion: 3,
    project: { name: 'p', color: '#ffffff' },
    rootCanvasId: 'root',
    canvases: [
      { id: 'root', scope: 'root', title: 'Root', order: 0, nodeIds: [] },
      { id: 'mv', scope: 'multiverse', parentCanvasId: 'root', depth: 1, title: 'MV', order: 1, nodeIds: [] }
    ],
    nodes: [],
    relationships: [],
    ...overrides
  }
}

describe('universe Shop contract', () => {
  it('creates exactly one immutable Shop per special child and none at root', () => {
    const result = createShopAtUniverseCreation({ id: 'mv', scope: 'multiverse', depth: 1 }, [], 'evt-shop')
    expect(result.refused).toBe(false)
    expect(result.node?.id).toBe('shop-mv')
    expect(result.node?.creationEventId).toBe('evt-shop')
    const repaired = repairUniverseShops(projection())
    expect(repaired.projection.canvases.find((canvas) => canvas.id === 'mv')?.nodeIds).toEqual(['shop-mv'])
    expect(repaired.projection.canvases.find((canvas) => canvas.id === 'root')?.nodeIds).toEqual([])
    expect(repaired.projection.nodes.filter((node) => node.kind === 'shop')).toHaveLength(1)
  })

  it('refuses malformed scope/depth and preserves ordinary nodes on identity collision', () => {
    expect(createSpecialUniverseCanvas({ id: 'mv', scope: 'multiverse', parentCanvasId: 'root', depth: MAX_MULTIVERSE_DEPTH + 1, title: 'MV', order: 1 })).toMatchObject({ refused: true, shop: null })
    expect(shopNodeIdForCanvas('mv', ['shop-mv'])).toBe('shop-mv-592e130a')
    const ordinary = { id: 'shop-mv', kind: 'sticky', position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, title: 'ordinary', color: '#ffffff', group: null }
    const repaired = repairUniverseShops(projection({ nodes: [ordinary], canvases: [{ id: 'root', scope: 'root', title: 'Root', order: 0, nodeIds: [] }, { id: 'mv', scope: 'multiverse', parentCanvasId: 'root', depth: 1, title: 'MV', order: 1, nodeIds: ['shop-mv'] }] }))
    expect(repaired.projection.nodes.some((node) => node.title === 'ordinary')).toBe(true)
    expect(repaired.projection.nodes.some((node) => node.kind === 'shop' && node.id === 'shop-mv-592e130a')).toBe(true)
  })

  it('keeps Shop mutations refused and creation retries idempotent', () => {
    expect(shopMutationDecision({ nodeId: 'shop-mv', kind: 'delete' })?.allowed).toBe(false)
    expect(shopMutationDecision({ nodeId: 'shop-mv', kind: 'move' })?.allowed).toBe(false)
    const coordinator = new UniverseShopCoordinator()
    const first = coordinator.createAtUniverseCreation({ id: 'mv', scope: 'multiverse', depth: 1 }, [], 'evt-1')
    const retry = coordinator.createAtUniverseCreation({ id: 'mv', scope: 'multiverse', depth: 1 }, first.node ? [first.node] : [], 'evt-1')
    expect(first.refused).toBe(false)
    expect(retry.duplicate).toBe(true)
    const ordinary = { id: 'sticky-1', kind: 'sticky', position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, title: 'ordinary', color: '#ffffff', group: null, creationEventId: 'evt-ordinary' }
    expect(coordinator.createAtUniverseCreation({ id: 'aws', scope: 'aws-universe', depth: 1 }, [ordinary], 'evt-ordinary').duplicate).toBe(false)
  })

  it('applies the same owner checks to active and inactive peer paths', () => {
    const coordinator = new UniverseShopCoordinator()
    const valid = projection({
      canvases: [
        { id: 'root', scope: 'root', title: 'Root', order: 0, nodeIds: [] },
        { id: 'mv', scope: 'multiverse', parentCanvasId: 'root', depth: 1, title: 'MV', order: 1, nodeIds: ['shop-mv'] }
      ],
      nodes: [{ id: 'shop-mv', kind: 'shop', creationEventId: 'evt-shop', position: { x: 0, y: 0 }, size: { width: 480, height: 420 }, title: 'Shop', color: '#6750a4', group: null, universeCanvasId: 'mv', universeScope: 'multiverse', universeDepth: 1, nonDeletable: true }]
    })
    const refused = coordinator.applyPeer(valid, { eventId: 'peer-1', nodeId: 'shop-mv', operation: 'remove' })
    expect(refused.refused).toBe(true)
    const malformed = coordinator.applyPeer(valid, { eventId: 'peer-2', nodeId: 'shop-mv', operation: 'upsert', canvasId: 'mv', node: { kind: 'shop', id: 'shop-mv', universeCanvasId: 'other', universeScope: 'multiverse', universeDepth: 1, nonDeletable: true, creationEventId: 'evt-2' } })
    expect(malformed.refused).toBe(true)
  })

  it('atomically appends a child canvas and exactly one Shop to the owning collection', () => {
    const store = new UniverseCanvasStore({ canvases: [{ id: 'root', scope: 'root', title: 'Root', order: 0, nodeIds: [] }], nodes: [] })
    const created = store.createChild({ id: 'mv', scope: 'multiverse', parentCanvasId: 'root', title: 'MV', order: 1 }, 'evt-child')
    expect(created.refused).toBe(false)
    expect(store.canvas('mv')?.nodeIds).toEqual([created.shop?.id])
    expect(store.nodesForCanvas('mv')).toHaveLength(1)
    expect(store.nodesForCanvas('mv')[0].kind).toBe('shop')
    expect(store.deleteChild('mv')).toMatchObject({ removed: true, refused: false })
    expect(store.canvas('mv')).toBeUndefined()
  })
})
