import type { CanvasNodeState, NodeKind } from './types'

/** The only child-canvas scope that may expose the AWS Shop. */
export const AWS_UNIVERSE_SCOPE = 'aws-universe' as const
export const AWS_SHOP_NODE_KIND = 'aws-shop' as const
export const AWS_SERVICE_NODE_KIND = 'aws-service' as const
export const AWS_SHOP_TITLE = 'AWS Shop'
export const AWS_SHOP_NODE_PREFIX = 'aws-shop-'

export type UniverseCanvasScope = 'root' | 'multiverse' | typeof AWS_UNIVERSE_SCOPE

export interface AwsShopRepair {
  canvasId: string
  action: 'created' | 'removed-duplicate' | 'removed-root-shop' | 'removed-non-aws-node' | 'normalized'
  nodeId?: string
  detail: string
}

export interface UniverseCanvasInput {
  id: string
  scope: UniverseCanvasScope
  parentCanvasId?: string
  nodeIds: string[]
}

export interface UniverseShopRepairResult {
  canvases: UniverseCanvasInput[]
  nodes: CanvasNodeState[]
  repairs: AwsShopRepair[]
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function stableUniverseToken(universeId: string): string {
  const readable = universeId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96) || 'universe'
  return `${readable}-${stableHash(universeId)}`
}

/** Deterministic identity for the one AWS Shop owned by a universe canvas. */
export function awsShopNodeId(universeId: string): string {
  return `${AWS_SHOP_NODE_PREFIX}${stableUniverseToken(universeId)}`
}

export function isUniverseScope(value: unknown): value is UniverseCanvasScope {
  return value === 'root' || value === 'multiverse' || value === AWS_UNIVERSE_SCOPE
}

export function isAwsNodeKind(kind: unknown): boolean {
  return kind === AWS_SHOP_NODE_KIND || kind === AWS_SERVICE_NODE_KIND
}

export function isAwsShopNode(node: { id: string; kind: unknown; awsUniverseId?: unknown }, universeId?: string): boolean {
  if (node.kind !== AWS_SHOP_NODE_KIND || typeof node.awsUniverseId !== 'string') return false
  return universeId === undefined
    ? node.id === awsShopNodeId(node.awsUniverseId)
    : node.awsUniverseId === universeId && node.id === awsShopNodeId(universeId)
}

export function isNonDeletableCanvasNode(node: Pick<CanvasNodeState, 'kind' | 'nonDeletable'>): boolean {
  return node.nonDeletable === true || node.kind === AWS_SHOP_NODE_KIND
}

export function createAwsShopNode(
  universeId: string,
  position: { x: number; y: number } = { x: 64, y: 64 }
): CanvasNodeState {
  if (typeof universeId !== 'string' || universeId.length === 0 || universeId.length > 256) throw new Error('AWS Universe identity is invalid.')
  return {
    id: awsShopNodeId(universeId),
    kind: AWS_SHOP_NODE_KIND,
    awsUniverseId: universeId,
    nonDeletable: true,
    position,
    size: { width: 560, height: 420 },
    title: AWS_SHOP_TITLE,
    color: '#6750A4',
    group: null,
    collapsed: false
  }
}

function canonicalShop(node: CanvasNodeState, universeId: string): CanvasNodeState {
  const canonical = createAwsShopNode(universeId, node.position)
  return {
    ...canonical,
    // The Shop's geometry is user layout, but its ownership and identity are not.
    size: node.size,
    color: node.color,
    collapsed: node.collapsed,
    position: node.position
  }
}

/**
 * Repair an imported or peer-provided child-canvas collection in memory.
 *
 * The repair is deterministic: root shops are removed, AWS canvases retain only AWS nodes,
 * duplicate or malformed shops collapse to the deterministic identity, and every child canvas
 * ends with exactly one canonical Shop. No provider call, credential lookup, process launch, or
 * filesystem write occurs here.
 */
export function repairUniverseShops(
  inputCanvases: readonly UniverseCanvasInput[],
  inputNodes: readonly CanvasNodeState[]
): UniverseShopRepairResult {
  const nodes = inputNodes.map((node) => ({ ...node }))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const repairs: AwsShopRepair[] = []
  const repairedCanvases: UniverseCanvasInput[] = []
  const retained = new Set<string>()

  for (const canvas of inputCanvases) {
    const canvasNodeIds = [...canvas.nodeIds]
    const shopNodes = canvasNodeIds
      .map((id) => byId.get(id))
      .filter((node): node is CanvasNodeState => !!node && node.kind === AWS_SHOP_NODE_KIND)

    if (canvas.scope === 'root') {
      for (const node of shopNodes) {
        byId.delete(node.id)
        repairs.push({ canvasId: canvas.id, action: 'removed-root-shop', nodeId: node.id, detail: 'The root canvas cannot own a Shop.' })
      }
      repairedCanvases.push({ ...canvas, nodeIds: [...new Set(canvasNodeIds.filter((id) => byId.has(id)))] })
      continue
    }

    const allowedIds = canvas.scope === AWS_UNIVERSE_SCOPE
      ? canvasNodeIds.filter((id) => {
          const node = byId.get(id)
          if (!node || isAwsNodeKind(node.kind)) return true
          repairs.push({ canvasId: canvas.id, action: 'removed-non-aws-node', nodeId: id, detail: 'AWS Universe canvases accept AWS nodes only.' })
          return false
        })
      : canvasNodeIds.filter((id) => byId.has(id))

    const uniqueAllowedIds = [...new Set(allowedIds)]
    const canonicalId = awsShopNodeId(canvas.id)
    const matching = uniqueAllowedIds.filter((id) => id === canonicalId)
    const candidate = matching.map((id) => byId.get(id)).find((node): node is CanvasNodeState => !!node && isAwsShopNode(node, canvas.id))
    const firstShop = shopNodes.find((node) => uniqueAllowedIds.includes(node.id))
    let shop: CanvasNodeState
    if (candidate) {
      shop = canonicalShop(candidate, canvas.id)
      if (JSON.stringify(shop) !== JSON.stringify(candidate)) repairs.push({ canvasId: canvas.id, action: 'normalized', nodeId: candidate.id, detail: 'The canonical Shop identity and ownership were restored.' })
    } else if (firstShop) {
      byId.delete(firstShop.id)
      shop = canonicalShop(firstShop, canvas.id)
      repairs.push({ canvasId: canvas.id, action: 'normalized', nodeId: firstShop.id, detail: 'A malformed Shop was replaced with the deterministic universe Shop.' })
    } else {
      shop = createAwsShopNode(canvas.id)
      repairs.push({ canvasId: canvas.id, action: 'created', nodeId: shop.id, detail: 'The child canvas had no Shop, so one was rebuilt.' })
    }
    byId.set(shop.id, shop)
    for (const node of shopNodes) {
      if (node.id !== shop.id) {
        byId.delete(node.id)
        repairs.push({ canvasId: canvas.id, action: 'removed-duplicate', nodeId: node.id, detail: 'A universe canvas owns one Shop only.' })
      }
    }
    const filtered = uniqueAllowedIds.filter((id) => byId.has(id) && id !== shop.id)
    repairedCanvases.push({ ...canvas, nodeIds: [...filtered, shop.id] })
    retained.add(shop.id)
  }

  const referenced = new Set(repairedCanvases.flatMap((canvas) => canvas.nodeIds))
  const repairedNodes = [...byId.values()].filter((node) => {
    if (node.kind !== AWS_SHOP_NODE_KIND) return true
    return retained.has(node.id)
  }).filter((node) => referenced.has(node.id))
  return { canvases: repairedCanvases, nodes: repairedNodes, repairs }
}

/** Validate a creation request before it reaches the renderer, core, import, or peer layer. */
export function canCreateInUniverse(scope: UniverseCanvasScope, kind: NodeKind | string): { ok: true } | { ok: false; reason: string } {
  if (scope !== AWS_UNIVERSE_SCOPE) return { ok: true }
  if (kind === AWS_SHOP_NODE_KIND) return { ok: false, reason: 'AWS Shop is created by the universe and cannot be duplicated.' }
  if (!isAwsNodeKind(kind)) return { ok: false, reason: 'AWS Universe accepts AWS catalog entries only.' }
  return { ok: true }
}
