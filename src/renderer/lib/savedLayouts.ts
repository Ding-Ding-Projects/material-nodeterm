import type { CanvasNodeState, PortableSavedCanvasLayout, SavedCanvasLayoutNode } from '@shared/types'

/** Bounds shared by the editor, file boundary, and portable projection. */
export const SAVED_LAYOUT_LIMITS = {
  maxLayouts: 256,
  maxNodesPerLayout: 20_000,
  maxNameLength: 160,
  maxIdLength: 128,
  coordinate: 100_000,
  minWidth: 1,
  minHeight: 1,
  maxWidth: 5_000,
  maxHeight: 4_000
} as const

const finiteBounded = (value: unknown, limit = SAVED_LAYOUT_LIMITS.coordinate): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit

function safeNode(node: SavedCanvasLayoutNode): SavedCanvasLayoutNode | null {
  if (!node || typeof node.id !== 'string' || !node.id.trim() || node.id.length > SAVED_LAYOUT_LIMITS.maxIdLength) return null
  if (!finiteBounded(node.position?.x) || !finiteBounded(node.position?.y)) return null
  if (!finiteBounded(node.size?.width, SAVED_LAYOUT_LIMITS.maxWidth) || !finiteBounded(node.size?.height, SAVED_LAYOUT_LIMITS.maxHeight)) return null
  if (node.size.width < SAVED_LAYOUT_LIMITS.minWidth || node.size.height < SAVED_LAYOUT_LIMITS.minHeight) return null
  if (node.parentId !== undefined && (typeof node.parentId !== 'string' || node.parentId.length > SAVED_LAYOUT_LIMITS.maxIdLength)) return null
  if (node.collapsed !== undefined && typeof node.collapsed !== 'boolean') return null
  return {
    id: node.id,
    position: { x: node.position.x, y: node.position.y },
    size: { width: node.size.width, height: node.size.height },
    ...(node.parentId !== undefined ? { parentId: node.parentId } : {}),
    ...(node.collapsed !== undefined ? { collapsed: node.collapsed } : {})
  }
}

/** Remove malformed rows without making a valid neighbouring layout disappear. */
export function normalizeSavedLayouts(value: unknown): PortableSavedCanvasLayout[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: PortableSavedCanvasLayout[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue
    const layout = candidate as PortableSavedCanvasLayout
    if (layout.version !== 1 || typeof layout.id !== 'string' || !layout.id.trim() || layout.id.length > SAVED_LAYOUT_LIMITS.maxIdLength || seen.has(layout.id)) continue
    if (typeof layout.name !== 'string' || !layout.name.trim() || layout.name.length > SAVED_LAYOUT_LIMITS.maxNameLength || typeof layout.createdAt !== 'string' || !Array.isArray(layout.nodes) || layout.nodes.length === 0 || layout.nodes.length > SAVED_LAYOUT_LIMITS.maxNodesPerLayout) continue
    const nodes = layout.nodes.map(safeNode).filter((node): node is SavedCanvasLayoutNode => node !== null)
    const nodeIds = new Set(nodes.map((node) => node.id))
    if (nodes.length !== layout.nodes.length || nodeIds.size !== nodes.length) continue
    seen.add(layout.id)
    result.push({ version: 1, id: layout.id, name: layout.name.trim(), createdAt: layout.createdAt, nodes })
    if (result.length >= SAVED_LAYOUT_LIMITS.maxLayouts) break
  }
  return result
}

function newLayoutId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ? `layout-${uuid}` : `layout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Capture only safe, portable geometry from the live canvas. */
export function createSavedLayout(nodes: readonly CanvasNodeState[], name: string, now = new Date().toISOString()): PortableSavedCanvasLayout | null {
  const cleanName = name.trim()
  if (!cleanName || cleanName.length > SAVED_LAYOUT_LIMITS.maxNameLength) return null
  const layoutNodes = nodes
    .filter((node) => node && !node.id.startsWith('subagent-') && !node.id.startsWith('loop-'))
    .map((node) => safeNode({
      id: node.id,
      position: node.position,
      size: node.size,
      ...(node.parentId !== undefined ? { parentId: node.parentId } : {}),
      ...(node.collapsed !== undefined ? { collapsed: node.collapsed } : {})
    }))
    .filter((node): node is SavedCanvasLayoutNode => node !== null)
  if (layoutNodes.length === 0) return null
  return { version: 1, id: newLayoutId(), name: cleanName, createdAt: now, nodes: layoutNodes }
}

export interface SavedLayoutApplyResult {
  nodes: CanvasNodeState[]
  appliedIds: string[]
  missingIds: string[]
  collisionPairs: Array<[string, string]>
}

function rootPosition(node: CanvasNodeState, nodes: readonly CanvasNodeState[]): { x: number; y: number } {
  const byId = new Map(nodes.map((item) => [item.id, item]))
  const seen = new Set<string>([node.id])
  let x = node.position.x
  let y = node.position.y
  let parentId = node.parentId
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    x += parent.position.x
    y += parent.position.y
    parentId = parent.parentId
  }
  return { x, y }
}

function rect(node: CanvasNodeState, nodes: readonly CanvasNodeState[]): { left: number; top: number; right: number; bottom: number } {
  const position = rootPosition(node, nodes)
  return { left: position.x, top: position.y, right: position.x + node.size.width, bottom: position.y + node.size.height }
}

function overlaps(a: CanvasNodeState, b: CanvasNodeState, nodes: readonly CanvasNodeState[]): boolean {
  const ar = rect(a, nodes); const br = rect(b, nodes)
  return ar.left < br.right && ar.right > br.left && ar.top < br.bottom && ar.bottom > br.top
}

function containsParent(ancestorId: string, node: CanvasNodeState, nodes: readonly CanvasNodeState[]): boolean {
  const byId = new Map(nodes.map((item) => [item.id, item]))
  const seen = new Set<string>()
  let parentId = node.parentId
  while (parentId && !seen.has(parentId)) {
    if (parentId === ancestorId) return true
    seen.add(parentId)
    parentId = byId.get(parentId)?.parentId
  }
  return false
}

/** Apply a saved arrangement while preserving all non-layout node data. */
export function applySavedLayout(nodes: readonly CanvasNodeState[], layout: PortableSavedCanvasLayout): SavedLayoutApplyResult {
  const normalized = normalizeSavedLayouts([layout])[0]
  if (!normalized) return { nodes: [...nodes], appliedIds: [], missingIds: layout.nodes.map((node) => node.id), collisionPairs: [] }
  const byId = new Map(normalized.nodes.map((node) => [node.id, node]))
  const appliedIds: string[] = []
  const missingIds: string[] = []
  const next = nodes.map((node) => {
    const saved = byId.get(node.id)
    if (!saved) return node
    appliedIds.push(node.id)
    return {
      ...node,
      position: saved.position,
      size: saved.size,
      parentId: saved.parentId,
      collapsed: saved.collapsed
    }
  })
  for (const saved of normalized.nodes) if (!nodes.some((node) => node.id === saved.id)) missingIds.push(saved.id)
  const collisionPairs: Array<[string, string]> = []
  const visible = next.filter((node) => !node.collapsed)
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      const nested = containsParent(visible[i].id, visible[j], next) || containsParent(visible[j].id, visible[i], next)
      if (!nested && visible[i].parentId !== visible[j].parentId && overlaps(visible[i], visible[j], next)) collisionPairs.push([visible[i].id, visible[j].id])
    }
  }
  return { nodes: next, appliedIds, missingIds, collisionPairs }
}

export function serializeSavedLayout(layout: PortableSavedCanvasLayout): string {
  const normalized = normalizeSavedLayouts([layout])[0]
  if (!normalized) throw new Error('Saved layout is invalid.')
  return `${JSON.stringify(normalized, null, 2)}\n`
}

export function parseSavedLayout(text: string): PortableSavedCanvasLayout {
  const parsed: unknown = JSON.parse(text)
  const layout = normalizeSavedLayouts([parsed])[0]
  if (!layout) throw new Error('Saved layout is invalid or empty.')
  return layout
}
