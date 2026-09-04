import { describe, expect, it } from 'vitest'
import type { CanvasNode } from './workspace'
import { NodeCreationCoordinator, collisionFreePosition } from './nodeCreationCoordinator'

function node(id: string, x = 0, y = 0): CanvasNode {
  return { id, type: 'sticky', position: { x, y }, width: 240, height: 200, data: { title: id, color: '#fff', group: null } }
}

describe('node creation coordinator contract', () => {
  it('reuses one event for concurrent retries and stamps the generated id', () => {
    const coordinator = new NodeCreationCoordinator()
    const first = coordinator.append([], { entry: { id: 'sticky', nodeKind: 'sticky', category: 'canvas', label: 'Sticky', description: 'note', keywords: [], documentationPath: 'docs/features/canvas/node-kinds.md', safeDefaults: {}, dependencies: [], availability: () => ({ available: true }) }, creationEventId: 'evt-1', center: { x: 0, y: 0 } }, (_entry, index, center) => node(`sticky-${index}`, center.x, center.y))
    const retry = coordinator.append(first.nodes, { entry: first.result.node ? { id: 'sticky', nodeKind: 'sticky', category: 'canvas', label: 'Sticky', description: 'note', keywords: [], documentationPath: 'docs/features/canvas/node-kinds.md', safeDefaults: {}, dependencies: [], availability: () => ({ available: true }) } : ({} as never), creationEventId: 'evt-1', center: { x: 0, y: 0 } }, (_entry, index, center) => node(`sticky-${index}`, center.x, center.y))
    expect(first.result.node?.data.creationEventId).toBe('evt-1')
    expect(retry.result.duplicate).toBe(true)
    expect(retry.nodes).toHaveLength(1)
  })

  it('refuses malformed event ids and uses a bounded sibling-only collision search', () => {
    const coordinator = new NodeCreationCoordinator()
    const bad = coordinator.append([], { entry: {} as never, creationEventId: `x${'a'.repeat(300)}` }, () => node('bad'))
    expect(bad.result.error).toContain('invalid')
    const occupied = [node('a', 0, 0)]
    expect(collisionFreePosition(occupied, node('b'), { x: 0, y: 0 })).not.toEqual({ x: 0, y: 0 })
    const invalidDepth = coordinator.append([], { entry: {} as never, creationEventId: 'evt-depth', universeCanvasId: 'mv', universeScope: 'multiverse', universeDepth: 9 }, () => node('depth'))
    expect(invalidDepth.result.error).toContain('universe scope')
  })
})
