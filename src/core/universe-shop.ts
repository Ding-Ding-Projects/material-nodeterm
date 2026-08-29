/**
 * Deterministic Shop ownership for special-universe canvases.
 *
 * This module is deliberately platform-free. It owns the invariant that a Multiverse or AWS
 * Universe child canvas has exactly one Shop node, while the root canvas has none. The renderer,
 * archive importer, hydration path, and peer path can all call the same pure functions, so a retry
 * cannot manufacture a second Shop and an imported malformed canvas cannot lose its repair record.
 */

import type {
  PortableCanvasNodeV3,
  PortableCanvasProjectionV3,
  PortableCanvasScope,
  PortableCanvasV3
} from './portable-canvas-projection'
import { PORTABLE_CANVAS_LIMITS } from './portable-canvas-projection'
import { isCreationEventId, isDeterministicShopNodeId, shopCanvasIdSuffix, NODE_CATALOG, type NodeCatalogAvailabilityContext, type NodeCatalogEntry } from '../shared/node-catalog'

export const SHOP_NODE_KIND = 'shop' as const
export const SHOP_TITLE = 'Shop'
export const SPECIAL_UNIVERSE_SCOPES = ['multiverse', 'aws-universe'] as const
export type SpecialUniverseScope = (typeof SPECIAL_UNIVERSE_SCOPES)[number]

/** The deepest permitted Multiverse canvas. AWS Universe children have no depth ceiling. */
export const MAX_MULTIVERSE_DEPTH = 8

export interface ShopRepairRecord {
  canvasId: string
  scope: PortableCanvasScope
  action: 'created' | 'deduplicated' | 'removed-from-invalid-scope' | 'normalized' | 'collision-refused'
  removedNodeIds: string[]
  nodeId: string | null
  reason: string
}

export interface UniverseShopRepairResult {
  projection: PortableCanvasProjectionV3
  repairs: ShopRepairRecord[]
}

export interface ShopCatalogEntry {
  id: string
  /** Localization keys owned by the unified Node Catalog. Shop never stores duplicate labels. */
  labelKey: string
  descriptionKey: string
  keywords: string[]
  scopes: readonly SpecialUniverseScope[]
  /** A portal is only offered while another Multiverse child can still be created. */
  maxDepthExclusive?: number
  docsPath: string
  nodeKind: string
  /** False when the catalog contract is known but its executor belongs to a later lane. */
  available?: boolean
  disabledReasonKey?: string
  availability?: (context: NodeCatalogAvailabilityContext) => { available: boolean; reason?: string }
  /** Renderer-resolved labels/descriptions for visible-copy search; never replaces stable keys. */
  searchText?: string
}

/** Dependency seam for the unified Node Catalog. The Shop implementation does not copy its labels or
 * factories. A later lane can adapt `NODE_CATALOG` to this source and supply real creation. */
export interface UniverseShopCatalogProvider {
  list(): readonly ShopCatalogEntry[]
  create?: (entry: ShopCatalogEntry, context: { canvasId: string; scope: SpecialUniverseScope; depth: number; creationEventId: string; placement?: { x: number; y: number }; projectId?: string }) => ShopCreationResult
}

export interface ShopCreationResult {
  status: 'created' | 'duplicate' | 'refused'
  nodeId?: string
  creationEventId: string
  reason?: string
}

/** Adapt the single shared catalog without copying provider labels or factory definitions. */
export function nodeCatalogShopProvider(
  create?: UniverseShopCatalogProvider['create']
): UniverseShopCatalogProvider {
  return {
    list: () => NODE_CATALOG.map((entry: NodeCatalogEntry) => ({
      id: entry.id,
      labelKey: `nodeCatalog.entry.${entry.id.replace(':', '.')}.label`,
      descriptionKey: `nodeCatalog.entry.${entry.id.replace(':', '.')}.description`,
      keywords: [...entry.keywords],
      scopes: (entry.scope === 'multiverse' ? ['multiverse'] : entry.scope === 'aws-universe' ? ['aws-universe'] : ['multiverse', 'aws-universe']) as readonly SpecialUniverseScope[],
      ...(entry.maxUniverseDepth !== undefined ? { maxDepthExclusive: entry.maxUniverseDepth + 1 } : {}),
      docsPath: entry.documentationPath,
      nodeKind: entry.nodeKind ?? entry.id,
      available: entry.status !== 'planned',
      availability: entry.availability,
      ...(entry.status === 'planned' ? { disabledReasonKey: 'nodeCatalog.plannedReason' } : {})
    })),
    ...(create ? { create } : {})
  }
}

export interface ShopCatalogOptions {
  scope: SpecialUniverseScope
  /** Root child depth is 1. Values below zero are treated as 1. */
  depth?: number
  catalog?: UniverseShopCatalogProvider | null
  projectId?: string
}

export interface ShopCatalogSearchOptions {
  mode?: 'text' | 'regex'
  flags?: string
}

export interface ShopCatalogSearchResult {
  entries: ShopCatalogEntry[]
  error: string | null
}

export type ShopMutationKind = 'delete' | 'duplicate' | 'move' | 'group' | 'undo-remove'

export interface ShopMutationRequest {
  nodeId: string
  kind: ShopMutationKind
  canvasId?: string
  nodeKind?: string
  nonDeletable?: boolean
}

export interface ShopMutationDecision {
  allowed: false
  code: 'shop-non-deletable' | 'shop-non-duplicable' | 'shop-scope-bound' | 'shop-undo-refused'
  reason: string
  nextAction: string
}

export interface ShopPeerEvent {
  eventId: string
  nodeId: string
  operation: 'upsert' | 'remove' | 'move' | 'group' | 'duplicate'
  canvasId?: string
  creationEventId?: string
  node?: Partial<PortableCanvasNodeV3>
}

export interface ShopPeerApplyResult {
  projection: PortableCanvasProjectionV3
  applied: boolean
  refused: boolean
  reason?: string
}

export interface LiveUniverseShopCreationResult {
  node: PortableCanvasNodeV3 | null
  creationEventId: string
  duplicate: boolean
  refused: boolean
  reason?: string
}

export interface LiveUniverseCanvasCreationResult {
  canvas: PortableCanvasV3 | null
  shop: PortableCanvasNodeV3 | null
  creationEventId: string
  refused: boolean
  reason?: string
}

export interface UniverseCanvasStoreState {
  canvases: PortableCanvasV3[]
  nodes: PortableCanvasNodeV3[]
}

export interface UniverseCanvasDeleteResult {
  removed: boolean
  refused: boolean
  reason?: string
}

/** In-memory lifecycle boundary for a project with child canvases. The caller persists the
 * returned state atomically, so a child and its Shop can never be published separately. */
export class UniverseCanvasStore {
  private state: UniverseCanvasStoreState

  constructor(initial: UniverseCanvasStoreState) {
    this.state = { canvases: initial.canvases.map((canvas) => ({ ...canvas, nodeIds: [...canvas.nodeIds] })), nodes: initial.nodes.map((node) => ({ ...node })) }
  }

  snapshot(): UniverseCanvasStoreState {
    return { canvases: this.state.canvases.map((canvas) => ({ ...canvas, nodeIds: [...canvas.nodeIds] })), nodes: this.state.nodes.map((node) => ({ ...node })) }
  }

  canvas(id: string): PortableCanvasV3 | undefined {
    const canvas = this.state.canvases.find((item) => item.id === id)
    return canvas ? { ...canvas, nodeIds: [...canvas.nodeIds] } : undefined
  }

  nodesForCanvas(id: string): PortableCanvasNodeV3[] {
    const canvas = this.state.canvases.find((item) => item.id === id)
    if (!canvas) return []
    const ids = new Set(canvas.nodeIds)
    return this.state.nodes.filter((node) => ids.has(node.id)).map((node) => ({ ...node }))
  }

  createChild(
    input: Omit<PortableCanvasV3, 'nodeIds' | 'depth'> & { scope: SpecialUniverseScope; depth?: number; nodeIds?: string[] },
    creationEventId = newUniverseCreationEventId()
  ): LiveUniverseCanvasCreationResult {
    if (!this.state.canvases.some((canvas) => canvas.id === input.parentCanvasId)) return { canvas: null, shop: null, creationEventId, refused: true, reason: 'The owning parent canvas does not exist.' }
    const depth = containingCanvasDepth(input.parentCanvasId!, this.state.canvases)
    const expectedDepth = depth === null ? null : depth + 1
    if (expectedDepth === null) return { canvas: null, shop: null, creationEventId, refused: true, reason: 'The child canvas depth does not match its live parent chain.' }
    const childDepth = input.depth ?? expectedDepth
    if (childDepth !== expectedDepth) return { canvas: null, shop: null, creationEventId, refused: true, reason: 'The child canvas depth does not match its live parent chain.' }
    const requestedIds = input.nodeIds ?? []
    if (requestedIds.some((id) => !this.state.nodes.some((node) => node.id === id))) return { canvas: null, shop: null, creationEventId, refused: true, reason: 'The child canvas references a node outside the owning project collection.' }
    const result = createSpecialUniverseCanvas({ ...input, depth: childDepth, nodeIds: requestedIds }, this.state.nodes, creationEventId)
    if (result.refused || !result.canvas || !result.shop) return result
    const next = { canvases: [...this.state.canvases, result.canvas], nodes: [...this.state.nodes, result.shop] }
    this.state = next
    return result
  }

  deleteChild(id: string): UniverseCanvasDeleteResult {
    const canvas = this.state.canvases.find((item) => item.id === id)
    if (!canvas) return { removed: false, refused: true, reason: 'The child canvas does not exist.' }
    if (canvas.scope === 'root') return { removed: false, refused: true, reason: 'The root canvas cannot be deleted.' }
    if (this.state.canvases.some((item) => item.parentCanvasId === id)) return { removed: false, refused: true, reason: 'A child canvas with descendants cannot be deleted.' }
    const memberIds = new Set(canvas.nodeIds)
    const nonShop = this.state.nodes.some((node) => memberIds.has(node.id) && !isShopNode(node))
    if (nonShop) return { removed: false, refused: true, reason: 'The child canvas contains user nodes and must be emptied before deletion.' }
    this.state = {
      canvases: this.state.canvases.filter((item) => item.id !== id),
      nodes: this.state.nodes.filter((node) => !memberIds.has(node.id))
    }
    return { removed: true, refused: false }
  }

  navigate(id: string): PortableCanvasV3 | undefined { return this.canvas(id) }
}

function isSpecialScope(scope: PortableCanvasScope): scope is SpecialUniverseScope {
  return (SPECIAL_UNIVERSE_SCOPES as readonly string[]).includes(scope)
}

function validCanvasId(canvasId: string): string {
  const value = String(canvasId).trim()
  if (!value || value.length > 256 || [...value].some((char) => char < ' ' || char === '\u007f')) {
    throw new Error('A universe canvas needs a bounded, visible identifier.')
  }
  return value
}

export class ShopIdentityCollisionError extends Error {
  readonly canvasId: string
  readonly displacedNodeIds: string[]

  constructor(canvasId: string, displacedNodeIds: string[]) {
    super(`The deterministic Shop id for canvas ${canvasId} collides with ordinary node ids.`)
    this.name = 'ShopIdentityCollisionError'
    this.canvasId = canvasId
    this.displacedNodeIds = [...displacedNodeIds]
  }
}

/** Small stable hash used only as a collision-safe id suffix, never as an authority token. */
/** Deterministic identity. An occupied base id gets a stable derived id; ordinary nodes are never overwritten. */
export function shopNodeIdForCanvas(canvasId: string, existingNodeIds: readonly string[] = []): string {
  const id = validCanvasId(canvasId)
  const occupied = new Set(existingNodeIds)
  const base = `shop-${id}`
  if (!occupied.has(base)) return base
  const derived = `shop-${id}-${shopCanvasIdSuffix(id)}`
  if (!occupied.has(derived)) return derived
  throw new ShopIdentityCollisionError(id, [base, derived])
}

export const deterministicShopNodeId = shopNodeIdForCanvas
export const shopIdForUniverse = shopNodeIdForCanvas

/** Immutable event key for a live catalog creation. Hydration and import deliberately do not call this. */
export function newUniverseCreationEventId(): string {
  const random = globalThis.crypto?.randomUUID?.()
  if (random) return random
  return `universe-create-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function isShopNode(node: Pick<PortableCanvasNodeV3, 'kind'> | { kind?: unknown } | null | undefined): boolean {
  return node?.kind === SHOP_NODE_KIND
}

function shopNode(
  canvasId: string,
  scope: SpecialUniverseScope,
  existingNodeIds: readonly string[] = [],
  depth?: number
): PortableCanvasNodeV3 {
  const id = shopNodeIdForCanvas(canvasId, existingNodeIds)
  return {
    id,
    kind: SHOP_NODE_KIND,
    position: { x: 48, y: 48 },
    size: { width: 480, height: 420 },
    title: SHOP_TITLE,
    color: '#6750a4',
    group: null,
    universeCanvasId: canvasId,
    universeScope: scope,
    ...(depth !== undefined ? { universeDepth: depth } : {}),
    nonDeletable: true,
    collapsed: false,
    tags: ['universe-shop', scope]
  }
}

function resolveShopIdForCanvas(canvasId: string, occupiedIds: readonly string[], existingShopIds: readonly string[]): string {
  const base = shopNodeIdForCanvas(canvasId)
  if (existingShopIds.includes(base)) return base
  const derived = shopNodeIdForCanvas(canvasId, [base])
  if (existingShopIds.includes(derived)) return derived
  return shopNodeIdForCanvas(canvasId, occupiedIds.filter((id) => !existingShopIds.includes(id)))
}

function containingCanvasDepth(canvasId: string, canvases: readonly PortableCanvasV3[]): number | null {
  const byId = new Map(canvases.map((canvas) => [canvas.id, canvas]))
  let current = byId.get(canvasId)
  let depth = 0
  const seen = new Set<string>()
  while (current) {
    if (seen.has(current.id)) return null
    seen.add(current.id)
    if (current.scope === 'root') return depth
    if (!current.parentCanvasId) return null
    current = byId.get(current.parentCanvasId)
    depth += 1
    if (depth > PORTABLE_CANVAS_LIMITS.maxCanvases) return depth
  }
  return null
}

function owningCanvasChainValid(canvas: PortableCanvasV3, canvases: readonly PortableCanvasV3[]): boolean {
  const byId = new Map(canvases.map((item) => [item.id, item]))
  let current = canvas
  const seen = new Set<string>()
  while (current.parentCanvasId !== undefined) {
    if (seen.has(current.id)) return false
    seen.add(current.id)
    const parent = byId.get(current.parentCanvasId)
    if (!parent) return false
    if (current.scope === 'aws-universe' && parent.scope !== 'root') return false
    if (current.scope === 'multiverse' && !['root', 'multiverse'].includes(parent.scope)) return false
    current = parent
  }
  return current.scope === 'root' && current.id === 'root'
}

function deterministicShopId(canvasId: string, id: string): boolean {
  return isDeterministicShopNodeId(canvasId, id)
}

function ownedShopMetadataValid(node: PortableCanvasNodeV3, canvas: PortableCanvasV3, depth: number): boolean {
  return isShopNode(node) && deterministicShopId(canvas.id, node.id) && node.universeCanvasId === canvas.id && node.universeScope === canvas.scope && node.universeDepth === depth && node.group === null && node.nonDeletable === true && (node.creationEventId === undefined || isCreationEventId(node.creationEventId))
}

export function createUniverseShopNode(
  canvas: Pick<PortableCanvasV3, 'id' | 'scope' | 'depth'>,
  options: { existingNodeIds?: readonly string[]; creationEventId?: string } = {}
): PortableCanvasNodeV3 {
  if (!isSpecialScope(canvas.scope)) throw new Error('Only Multiverse and AWS Universe canvases own a Shop.')
  if (typeof canvas.depth !== 'number' || !Number.isInteger(canvas.depth) || canvas.depth < 1 || (canvas.scope === 'multiverse' && canvas.depth > MAX_MULTIVERSE_DEPTH)) throw new Error('A special-universe Shop needs a valid persisted canvas depth.')
  const node = shopNode(canvas.id, canvas.scope, options.existingNodeIds, canvas.depth)
  return options.creationEventId ? { ...node, creationEventId: options.creationEventId } : node
}

export const createShopNode = createUniverseShopNode

/** Live child-canvas creation path. It mints one event, allocates a collision-safe id, and never
 * overwrites an ordinary node. Hydration/import use repairUniverseShops instead and mint nothing. */
export function createShopAtUniverseCreation(
  canvas: Pick<PortableCanvasV3, 'id' | 'scope' | 'depth'>,
  existingNodes: readonly PortableCanvasNodeV3[] = [],
  creationEventId = newUniverseCreationEventId()
): LiveUniverseShopCreationResult {
  if (!isCreationEventId(creationEventId)) return { node: null, creationEventId: String(creationEventId), duplicate: false, refused: true, reason: 'A Shop creation event id is invalid or exceeds its bound.' }
  if (!isSpecialScope(canvas.scope)) {
    return { node: null, creationEventId, duplicate: false, refused: true, reason: 'Only a special-universe child canvas may own a Shop.' }
  }
  if (existingNodes.some((node) => isShopNode(node) && node.universeCanvasId === canvas.id && node.creationEventId === creationEventId)) {
    const existing = existingNodes.find((node) => isShopNode(node) && node.universeCanvasId === canvas.id && node.creationEventId === creationEventId) ?? null
    return { node: existing, creationEventId, duplicate: true, refused: false }
  }
  const ownedShop = existingNodes.find((node) => isShopNode(node) && node.universeCanvasId === canvas.id)
  if (ownedShop) {
    if (!deterministicShopId(canvas.id, ownedShop.id) || ownedShop.universeScope !== canvas.scope || ownedShop.universeDepth !== canvas.depth || ownedShop.group !== null || ownedShop.nonDeletable !== true || (ownedShop.creationEventId !== undefined && !isCreationEventId(ownedShop.creationEventId))) {
      return { node: null, creationEventId, duplicate: false, refused: true, reason: 'Shop creation was refused because an existing owned Shop has invalid identity or scope metadata.' }
    }
    return { node: ownedShop, creationEventId: ownedShop.creationEventId ?? creationEventId, duplicate: true, refused: false }
  }
  const baseId = shopNodeIdForCanvas(canvas.id)
  const derivedId = shopNodeIdForCanvas(canvas.id, [baseId])
  const existingShop = existingNodes.find(
    (node) =>
      isShopNode(node) &&
      node.universeCanvasId === canvas.id &&
      (node.id === baseId || node.id === derivedId)
  )
  if (existingShop) {
    const normalized = {
      ...existingShop,
      kind: SHOP_NODE_KIND,
      title: SHOP_TITLE,
      group: null,
      universeCanvasId: canvas.id,
      universeScope: canvas.scope,
      universeDepth: canvas.depth,
      nonDeletable: true,
      creationEventId: existingShop.creationEventId ?? creationEventId
    }
    return { node: normalized, creationEventId: normalized.creationEventId, duplicate: true, refused: false }
  }
  try {
    const node = createUniverseShopNode(canvas, { existingNodeIds: existingNodes.map((item) => item.id), creationEventId })
    return { node, creationEventId, duplicate: false, refused: false }
  } catch (error) {
    return { node: null, creationEventId, duplicate: false, refused: true, reason: error instanceof Error ? error.message : 'Shop creation was refused.' }
  }
}

/**
 * The live special-universe constructor. Portal/AWS lanes call this when they append a child
 * canvas, so Shop creation is part of the same operation rather than a later projection repair.
 */
export function createSpecialUniverseCanvas(
  input: Omit<PortableCanvasV3, 'nodeIds' | 'scope'> & {
    scope: SpecialUniverseScope
    nodeIds?: string[]
  },
  existingNodes: readonly PortableCanvasNodeV3[] = [],
  creationEventId = newUniverseCreationEventId()
): LiveUniverseCanvasCreationResult {
  if (!input.parentCanvasId || typeof input.depth !== 'number' || !Number.isInteger(input.depth) || input.depth < 1 || (input.scope === 'multiverse' && input.depth > MAX_MULTIVERSE_DEPTH)) {
    return { canvas: null, shop: null, creationEventId, refused: true, reason: 'A special-universe canvas needs a containing canvas and a valid persisted depth.' }
  }
  const shop = createShopAtUniverseCreation(input, existingNodes, creationEventId)
  if (!shop.node || shop.refused) return { canvas: null, shop: null, creationEventId, refused: true, reason: shop.reason }
  const nodeIds = [...new Set([...(input.nodeIds ?? []), shop.node.id])]
  return {
    canvas: { ...input, nodeIds },
    shop: shop.node,
    creationEventId: shop.creationEventId,
    refused: false
  }
}

/**
 * Repair imported or hydrated projection data. The function does not mutate the input and is safe
 * to call after every import, peer event, undo replay, or hydration retry.
 */
export function repairUniverseShops(input: PortableCanvasProjectionV3): UniverseShopRepairResult {
  const nodes = input.nodes.map((node) => ({ ...node, position: { ...node.position }, size: { ...node.size } }))
  const nodeById = new Map<string, PortableCanvasNodeV3>()
  for (const node of nodes) if (!nodeById.has(node.id)) nodeById.set(node.id, node)
  const repairs: ShopRepairRecord[] = []
  const removed = new Set<string>()
  const canvases = input.canvases.map((canvas) => ({ ...canvas, nodeIds: [] as string[] }))

  for (let index = 0; index < input.canvases.length; index += 1) {
    const canvas = input.canvases[index]
    const out = canvases[index]
    const ids = [...new Set(canvas.nodeIds)]
    const shopIds = ids.filter((id) => isShopNode(nodeById.get(id)))

    if (!isSpecialScope(canvas.scope)) {
      if (shopIds.length) {
        for (const id of shopIds) removed.add(id)
        repairs.push({
          canvasId: canvas.id,
          scope: canvas.scope,
          action: 'removed-from-invalid-scope',
          removedNodeIds: shopIds,
          nodeId: null,
          reason: 'The root canvas and non-universe canvases cannot own a Shop node.'
        })
      }
      out.nodeIds = ids.filter((id) => !shopIds.includes(id))
      continue
    }

    const depth = containingCanvasDepth(canvas.id, input.canvases)
    if (
      depth === null ||
      !owningCanvasChainValid(canvas, input.canvases) ||
      (canvas.scope === 'multiverse' && (depth < 1 || depth > MAX_MULTIVERSE_DEPTH)) ||
      canvas.depth === undefined ||
      canvas.depth !== depth
    ) {
      // A malformed containing chain is fail-closed. Preserve every imported node and report the
      // refusal instead of attaching a Shop to a canvas whose ownership or depth is ambiguous.
      out.nodeIds = ids
      repairs.push({
        canvasId: canvas.id,
        scope: canvas.scope,
        action: 'collision-refused',
        removedNodeIds: [],
        nodeId: null,
        reason: depth === null || !owningCanvasChainValid(canvas, input.canvases)
          ? 'Shop repair was refused because the containing canvas chain is missing or cyclic.'
          : canvas.depth === undefined
            ? 'Shop repair was refused because persisted canvas depth is missing.'
            : canvas.depth !== depth
              ? `Shop repair was refused because persisted depth ${canvas.depth} disagrees with containing-canvas depth ${depth}.`
            : `Shop repair was refused because this Multiverse depth is ${depth}; allowed depth is 1 through ${MAX_MULTIVERSE_DEPTH}.`
      })
      continue
    }

    const malformedShop = shopIds
      .map((id) => nodeById.get(id))
      .find((node): node is PortableCanvasNodeV3 => !!node && !ownedShopMetadataValid(node, canvas, depth))
    if (malformedShop) {
      out.nodeIds = ids
      repairs.push({
        canvasId: canvas.id,
        scope: canvas.scope,
        action: 'collision-refused',
        removedNodeIds: [],
        nodeId: malformedShop.id,
        reason: 'Shop repair was refused because the imported Shop owner, scope, depth, placement, id, or creation event is invalid.'
      })
      continue
    }

    let expectedId: string
    try {
      expectedId = resolveShopIdForCanvas(canvas.id, [...nodeById.keys()], shopIds)
    } catch (error) {
      const collision = error instanceof ShopIdentityCollisionError ? error : null
      out.nodeIds = ids
      repairs.push({
        canvasId: canvas.id,
        scope: canvas.scope,
        action: 'collision-refused',
        removedNodeIds: [],
        nodeId: null,
        reason: collision
          ? `Shop creation was refused to preserve ordinary nodes ${collision.displacedNodeIds.join(', ')}.`
          : 'Shop creation was refused because its owning canvas id is invalid.'
      })
      continue
    }
    const canonical = shopIds.includes(expectedId) ? nodeById.get(expectedId) : undefined
    const kept = canonical
      ? {
          ...canonical,
          kind: SHOP_NODE_KIND,
          title: SHOP_TITLE,
          group: null,
          universeCanvasId: canvas.id,
          universeScope: canvas.scope,
          universeDepth: depth,
          nonDeletable: true,
          tags: [...new Set([...(canonical.tags ?? []), 'universe-shop', canvas.scope])].sort()
        }
      : shopNode(canvas.id, canvas.scope, [...nodeById.keys()], depth)
    nodeById.set(expectedId, kept)
    // A malformed root may reference a Shop that actually belongs to this valid child canvas.
    // The valid deterministic owner wins, so do not let the earlier invalid-scope pass remove it.
    removed.delete(expectedId)

    const duplicateIds = shopIds.filter((id) => id !== expectedId)
    for (const id of duplicateIds) removed.add(id)
    out.nodeIds = ids.filter((id) => !shopIds.includes(id) || id === expectedId)
    if (!out.nodeIds.includes(expectedId)) out.nodeIds.push(expectedId)

    if (!canonical) {
      repairs.push({
        canvasId: canvas.id,
        scope: canvas.scope,
        action: 'created',
        removedNodeIds: duplicateIds,
        nodeId: expectedId,
        reason: duplicateIds.length
          ? 'The imported universe had no deterministic Shop, so duplicate or malformed Shop nodes were replaced.'
          : 'The imported universe had no Shop, so its deterministic Shop was rebuilt.'
      })
    } else if (
      duplicateIds.length ||
      canonical.group !== null ||
      canonical.title !== SHOP_TITLE ||
      canonical.universeCanvasId !== canvas.id ||
      canonical.universeScope !== canvas.scope ||
      canonical.universeDepth !== depth ||
      canonical.nonDeletable !== true
    ) {
      repairs.push({
        canvasId: canvas.id,
        scope: canvas.scope,
        action: duplicateIds.length ? 'deduplicated' : 'normalized',
        removedNodeIds: duplicateIds,
        nodeId: expectedId,
        reason: duplicateIds.length
          ? 'Only the deterministic Shop is retained; duplicate Shops are not allowed.'
          : 'The Shop was restored to its fixed title and top-level scope.'
      })
    }
  }

  // Remove invalid duplicate records from the node list, including records that were referenced
  // by more than one canvas. The remaining membership still goes through the projection validator.
  const repairedNodes = [...nodeById.values()].filter((node) => !removed.has(node.id))
  const repaired: PortableCanvasProjectionV3 = {
    ...input,
    canvases,
    nodes: repairedNodes
  }
  return { projection: repaired, repairs }
}

export const ensureUniverseShops = repairUniverseShops
export const repairImportedUniverseShops = repairUniverseShops

const sharedCatalogProviders = new Map<string, UniverseShopCatalogProvider>()
const catalogProviderListeners = new Set<() => void>()

/** Register the project-aware catalog provider. Until then the Shop is intentionally empty. */
export function registerUniverseShopCatalog(provider: UniverseShopCatalogProvider | null, projectId = 'default'): void {
  if (provider) sharedCatalogProviders.set(projectId, provider)
  else sharedCatalogProviders.delete(projectId)
  for (const listener of catalogProviderListeners) listener()
}

export function universeShopCatalogProvider(projectId = 'default'): UniverseShopCatalogProvider | null {
  return sharedCatalogProviders.get(projectId) ?? null
}

export function subscribeUniverseShopCatalog(listener: () => void): () => void {
  catalogProviderListeners.add(listener)
  return () => { catalogProviderListeners.delete(listener) }
}

/** Return only catalog entries legal for the Shop's own universe. */
export function catalogForUniverse(options: ShopCatalogOptions): ShopCatalogEntry[] {
  const depth = Math.max(1, Math.floor(options.depth ?? 1))
  const source = options.catalog ?? universeShopCatalogProvider(options.projectId)
  if (!source) return []
  return source.list().filter(
    (entry) =>
      entry.scopes.includes(options.scope) &&
      (entry.maxDepthExclusive === undefined || depth < entry.maxDepthExclusive)
  ).map((entry) => {
    const availability = entry.availability?.({
      sessionSource: 'local', hasProjectFolder: true, isSshProject: false, hasRemoteConnection: false,
      supportsWindowsTerminalProfiles: true, universeScope: options.scope, universeId: undefined,
      universeDepth: depth, hasShopNode: true
    })
    return {
    ...entry,
    keywords: [...entry.keywords],
    scopes: [...entry.scopes],
    available: entry.available !== false && availability?.available !== false && typeof source.create === 'function',
    disabledReasonKey: entry.available === false || availability?.available === false
      ? entry.disabledReasonKey
      : typeof source.create === 'function'
        ? undefined
        : 'The unified Node Catalog creation coordinator is unavailable in this build.'
  }
  })
}

export const scopedShopCatalog = catalogForUniverse

/** Search remains local and bounded; invalid regex leaves the full scoped list visible. */
export function searchShopCatalog(
  entries: readonly ShopCatalogEntry[],
  query: string,
  options: ShopCatalogSearchOptions = {}
): ShopCatalogSearchResult {
  const value = String(query ?? '').slice(0, 512).trim()
  if (!value) return { entries: [...entries], error: null }
  if (options.mode !== 'regex') {
    const needle = value.toLocaleLowerCase('en-US')
    return {
      entries: entries.filter((entry) =>
        [entry.id, entry.labelKey, entry.descriptionKey, entry.searchText ?? '', ...entry.keywords]
          .join(' ')
          .toLocaleLowerCase('en-US')
          .includes(needle)
      ),
      error: null
    }
  }
  try {
    const regex = new RegExp(value, options.flags ?? 'iu')
    return {
      entries: entries.filter((entry) => {
        // Global/sticky flags carry lastIndex between calls. Reset it so one catalog row cannot
        // make the next row disappear merely because the user selected a `g` flag.
        regex.lastIndex = 0
        return regex.test([entry.id, entry.labelKey, entry.descriptionKey, entry.searchText ?? '', ...entry.keywords].join(' '))
      }),
      error: null
    }
  } catch (error) {
    return { entries: [...entries], error: error instanceof Error ? error.message : 'The pattern is not valid.' }
  }
}

export function shopMutationDecision(request: ShopMutationRequest): ShopMutationDecision | null {
  if (request.nodeKind !== SHOP_NODE_KIND && request.nonDeletable !== true && !request.nodeId.startsWith('shop-')) return null
  switch (request.kind) {
    case 'delete':
      return {
        allowed: false,
        code: 'shop-non-deletable',
        reason: 'Shop nodes are permanent navigation for their universe and cannot be deleted.',
        nextAction: 'Open the Shop and choose a catalog entry.'
      }
    case 'duplicate':
      return {
        allowed: false,
        code: 'shop-non-duplicable',
        reason: 'A universe has one deterministic Shop, so it cannot be duplicated.',
        nextAction: 'Use the existing Shop for this universe.'
      }
    case 'move':
      return {
        allowed: false,
        code: 'shop-scope-bound',
        reason: 'A Shop is bound to its owning universe canvas and cannot be moved.',
        nextAction: 'Create a node from the Shop in the current universe.'
      }
    case 'group':
      return {
        allowed: false,
        code: 'shop-scope-bound',
        reason: 'A Shop stays at the top level of its owning universe and cannot join a group.',
        nextAction: 'Group the node created from the Shop instead.'
      }
    case 'undo-remove':
      return {
        allowed: false,
        code: 'shop-undo-refused',
        reason: 'Undo cannot remove or restore a Shop as an ordinary node operation.',
        nextAction: 'Repair the universe projection if the Shop is missing.'
      }
  }
}

export const canMutateShop = (request: ShopMutationRequest): ShopMutationDecision | null =>
  shopMutationDecision(request)
export const refuseShopMutation = shopMutationDecision

/** A small coordinator that makes hydration and peer retries idempotent. */
export class UniverseShopCoordinator {
  private readonly seenPeerEvents = new Set<string>()
  private readonly creationEvents = new Map<string, string>()

  hydrate(projection: PortableCanvasProjectionV3): UniverseShopRepairResult {
    const result = repairUniverseShops(projection)
    // Hydration only remembers event ids already present in the payload. It never mints a new one.
    for (const node of result.projection.nodes) {
      if (isShopNode(node) && node.universeCanvasId && node.creationEventId && isCreationEventId(node.creationEventId)) this.rememberCreation(node.universeCanvasId, node.creationEventId, node.id)
    }
    return result
  }

  import(projection: PortableCanvasProjectionV3): UniverseShopRepairResult {
    return this.hydrate(projection)
  }

  createAtUniverseCreation(
    canvas: Pick<PortableCanvasV3, 'id' | 'scope'>,
    existingNodes: readonly PortableCanvasNodeV3[] = [],
    creationEventId = newUniverseCreationEventId()
  ): LiveUniverseShopCreationResult {
    const knownId = this.creationEvents.get(this.creationKey(canvas.id, creationEventId))
    if (knownId) {
      const existing = existingNodes.find((node) => node.id === knownId) ?? null
      return { node: existing, creationEventId, duplicate: true, refused: false }
    }
    const result = createShopAtUniverseCreation(canvas, existingNodes, creationEventId)
    if (result.node) this.rememberCreation(canvas.id, result.creationEventId, result.node.id)
    return result
  }

  createUniverseCanvas(
    input: Omit<PortableCanvasV3, 'nodeIds' | 'scope'> & { scope: SpecialUniverseScope; nodeIds?: string[] },
    existingNodes: readonly PortableCanvasNodeV3[] = [],
    creationEventId = newUniverseCreationEventId()
  ): LiveUniverseCanvasCreationResult {
    const result = createSpecialUniverseCanvas(input, existingNodes, creationEventId)
    if (result.shop) this.rememberCreation(input.id, result.creationEventId, result.shop.id)
    return result
  }

  applyPeer(projection: PortableCanvasProjectionV3, event: ShopPeerEvent): ShopPeerApplyResult {
    if (!isCreationEventId(event.eventId)) return { projection, applied: false, refused: true, reason: 'Peer event id is invalid or exceeds its bound.' }
    if (event.operation === 'upsert' && !event.node) return { projection, applied: false, refused: true, reason: 'Peer Shop upsert is missing its typed node payload.' }
    if (this.seenPeerEvents.has(event.eventId)) {
      return { projection, applied: false, refused: false, reason: 'Peer event already applied.' }
    }
    const shopCandidate = projection.nodes.find((node) => node.id === event.nodeId && isShopNode(node))
    if (shopCandidate && (!event.canvasId || shopCandidate.universeCanvasId !== event.canvasId)) {
      return { projection, applied: false, refused: true, reason: 'Peer Shop owner canvas id is missing or does not match the existing Shop.' }
    }
    const ownedShop = shopCandidate && shopCandidate.universeCanvasId === event.canvasId ? shopCandidate : undefined
    if (event.operation === 'upsert' && event.node && (!isShopNode(event.node) || event.node.title !== SHOP_TITLE || event.node.group !== null || event.node.nonDeletable !== true || event.node.universeCanvasId !== event.canvasId || event.node.universeScope === undefined || typeof event.node.universeDepth !== 'number' || !Number.isInteger(event.node.universeDepth) || event.node.universeDepth < 1 || !deterministicShopId(String(event.canvasId), String(event.nodeId)) || !isCreationEventId(event.node.creationEventId))) {
      return { projection, applied: false, refused: true, reason: 'Peer Shop ownership, scope, depth, deterministic id, or creation event is invalid.' }
    }
    if (ownedShop) {
      // A canonical upsert is harmless and is allowed to converge through the same repair pass.
      // Removal, movement, grouping, and duplication are the operations that the Shop policy
      // refuses. Keeping the event unconsumed on refusal makes a retry report the same refusal,
      // rather than changing into an unrelated "already applied" result.
      if (event.operation !== 'upsert') {
        const decision = shopMutationDecision({
          nodeId: event.nodeId,
          kind: event.operation === 'remove' ? 'delete' : event.operation === 'duplicate' ? 'duplicate' : event.operation === 'group' ? 'group' : 'move',
          nodeKind: SHOP_NODE_KIND
        })
        if (decision) return { projection, applied: false, refused: true, reason: decision.reason }
      }
    } else if (event.operation !== 'upsert' && event.creationEventId && !isCreationEventId(event.creationEventId)) {
      return { projection, applied: false, refused: true, reason: 'Peer creation event id is invalid or exceeds its bound.' }
    }
    let nextProjection = projection
    if (event.operation === 'upsert' && event.node) {
      const incoming = event.node as PortableCanvasNodeV3
      const existing = projection.nodes.find((node) => node.id === event.nodeId)
      if (existing && !isShopNode(existing)) return { projection, applied: false, refused: true, reason: 'Peer Shop insertion would replace an ordinary node.' }
      if (!existing) {
        const owner = projection.canvases.find((canvas) => canvas.id === event.canvasId)
        if (!owner || owner.scope !== incoming.universeScope || owner.depth !== incoming.universeDepth) return { projection, applied: false, refused: true, reason: 'Peer Shop owner canvas or depth does not match the projection.' }
        nextProjection = {
          ...projection,
          nodes: [...projection.nodes, incoming],
          canvases: projection.canvases.map((canvas) => canvas.id === event.canvasId ? { ...canvas, nodeIds: [...canvas.nodeIds, event.nodeId] } : canvas)
        }
      }
    }
    this.seenPeerEvents.add(event.eventId)
    const repaired = repairUniverseShops(nextProjection)
    return {
      projection: repaired.projection,
      applied: repaired.repairs.length > 0,
      refused: false,
      reason: repaired.repairs.length ? 'Universe Shop invariant repaired after peer hydration.' : undefined
    }
  }

  applyUndo(projection: PortableCanvasProjectionV3, nodeId: string): ShopPeerApplyResult {
    const decision = shopMutationDecision({ nodeId, kind: 'undo-remove' })
    if (decision) return { projection, applied: false, refused: true, reason: decision.reason }
    return { projection, applied: false, refused: false }
  }

  clear(): void {
    this.seenPeerEvents.clear()
    this.creationEvents.clear()
  }

  private creationKey(canvasId: string, eventId: string): string { return `${canvasId}:${eventId}` }
  private rememberCreation(canvasId: string, eventId: string, nodeId: string): void {
    const key = this.creationKey(canvasId, eventId)
    if (this.creationEvents.size >= 4096 && !this.creationEvents.has(key)) this.creationEvents.delete(this.creationEvents.keys().next().value as string)
    this.creationEvents.set(key, nodeId)
  }
}

export function shopScopeForCanvas(scope: PortableCanvasScope): SpecialUniverseScope | null {
  return isSpecialScope(scope) ? scope : null
}
