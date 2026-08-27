import type { CanvasNodeState, SavedCanvasLayout, Viewport } from '@shared/types'

/** Convert the live canvas into a portable, id-addressed layout snapshot. */
export function captureSavedLayout(
  nodes: readonly CanvasNodeState[],
  viewport: Viewport,
  input: Pick<SavedCanvasLayout, 'id' | 'name' | 'createdAt'> & Partial<Pick<SavedCanvasLayout, 'updatedAt'>>
): SavedCanvasLayout {
  return {
    id: input.id,
    name: input.name,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
    nodes: nodes.map((node) => ({
      id: node.id,
      position: { x: node.position.x, y: node.position.y },
      size: { width: node.size.width, height: node.size.height },
      ...(node.parentId ? { parentId: node.parentId } : {}),
      ...(node.collapsed !== undefined ? { collapsed: node.collapsed } : {})
    }))
  }
}

/** Apply a saved layout without creating or deleting nodes. Missing ids are returned for notice UI. */
export function applySavedLayout(
  nodes: readonly CanvasNodeState[],
  layout: Pick<SavedCanvasLayout, 'nodes'>
): { nodes: CanvasNodeState[]; missingNodeIds: string[]; changed: boolean } {
  const byId = new Map(layout.nodes.map((entry) => [entry.id, entry]))
  const missingNodeIds = layout.nodes.filter((entry) => !nodes.some((node) => node.id === entry.id)).map((entry) => entry.id)
  let changed = false
  const next = nodes.map((node) => {
    const saved = byId.get(node.id)
    if (!saved) return node
    const width = saved.size.width
    const height = saved.size.height
    const parentId = saved.parentId
    const collapsed = saved.collapsed
    const same = node.position.x === saved.position.x && node.position.y === saved.position.y &&
      node.size.width === width && node.size.height === height && node.parentId === parentId &&
      node.collapsed === collapsed
    if (same) return node
    changed = true
    return {
      ...node,
      position: { x: saved.position.x, y: saved.position.y },
      size: { width, height },
      ...(parentId ? { parentId } : {}),
      ...(parentId ? {} : { parentId: undefined }),
      ...(collapsed !== undefined ? { collapsed } : {})
    }
  })
  return { nodes: next, missingNodeIds, changed }
}
