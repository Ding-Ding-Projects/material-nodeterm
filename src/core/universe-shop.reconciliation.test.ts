import { describe, expect, it } from 'vitest'
import {
  MAX_MULTIVERSE_DEPTH,
  UniverseShopCoordinator,
  createShopAtUniverseCreation,
  createSpecialUniverseCanvas,
  repairUniverseShops,
  shopMutationDecision,
  shopNodeIdForCanvas
} from './universe-shop'
import type { PortableCanvasProjectionV3 } from './portable-canvas-projection'

const projection = (overrides: Partial<PortableCanvasProjectionV3> = {}): PortableCanvasProjectionV3 => ({
  format: 'nodeterm-portable-project',
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
})

describe('universe Shop contract', () => {
  it('creates one immutable Shop for a special child and none at root', () => {
    const created = createShopAtUniverseCreation({ id: 'mv', scope: 'multiverse', depth: 1 }, [], 'evt-shop')
    expect(created.refused).toBe(false)
    expect(created.node?.id).toBe('shop-mv')
    const repaired = repairUniverseShops(projection())
    expect(repaired.projection.canvases.find((canvas) => canvas.id === 'mv')?.nodeIds).toEqual(['shop-mv'])
    expect(repaired.projection.canvases.find((canvas) => canvas.id === 'root')?.nodeIds).toEqual([])
  })

  it('refuses malformed depth and preserves ordinary nodes on identity collision', () => {
    expect(createSpecialUniverseCanvas({ id: 'mv', scope: 'multiverse', parentCanvasId: 'root', depth: MAX_MULTIVERSE_DEPTH + 1, title: 'MV', order: 1 })).toMatchObject({ refused: true, shop: null })
    expect(shopNodeIdForCanvas('mv', ['shop-mv'])).toBe('shop-mv-592e130a')
  })

  it('keeps Shop mutations refused and creation retries idempotent', () => {
    expect(shopMutationDecision({ nodeId: 'shop-mv', kind: 'delete' })?.allowed).toBe(false)
    const coordinator = new UniverseShopCoordinator()
    const input = { id: 'mv', scope: 'multiverse' as const, parentCanvasId: 'root', depth: 1, title: 'MV', order: 1 }
    const first = coordinator.createUniverseCanvas(input, [], 'evt-1')
    const retry = coordinator.createUniverseCanvas(input, first.shop ? [first.shop] : [], 'evt-1')
    expect(first.refused).toBe(false)
    expect(retry.refused).toBe(false)
    expect(retry.shop?.id).toBe(first.shop?.id)
  })

})
