/**
 * Portable lifecycle rules for child canvases and their doors.
 *
 * This module is deliberately free of Electron, filesystem, network, and renderer imports. A
 * portal is safe intent and content only. Binding a child to a local host, starting a process, or
 * opening a provider belongs to a separate explicit action after this model has been accepted.
 */

export const PORTAL_MAX_DEPTH = 8 as const
export const PORTAL_ROOT_ID = 'root' as const
export const PORTAL_SHOP_KIND = 'shop' as const
export const PORTAL_DOOR_KIND = 'portal-door' as const
export const PORTAL_RETURN_DOOR_KIND = 'portal-return-door' as const

export type PortalUniverseScope = 'multiverse' | 'aws-universe'
export type PortalCanvasScope = 'root' | PortalUniverseScope

export interface PortalCanvasRecord {
  id: string
  scope: PortalCanvasScope
  parentCanvasId?: string
  title: string
  order: number
  nodeIds: string[]
  /** A preserved child whose parent project was deleted or whose parent link was malformed. */
  orphaned?: boolean
  orphanedFromCanvasId?: string
}

export interface PortalNodeRecord {
  id: string
  kind: 'portal' | typeof PORTAL_SHOP_KIND
  canvasId: string
  title: string
  /** Portal target. Shops have no target and are tied to their owning universe canvas. */
  targetCanvasId?: string
  /** The immutable return relationship id for a portal. */
  returnDoorId?: string
  universeScope?: PortalUniverseScope
  /** Shops and door records are structural and cannot be removed by ordinary actions. */
  nonDeletable?: true
  /** Safe, portable configuration only. No credentials, paths, or provider sessions. */
  settings?: Record<string, unknown>
}

export interface PortalRelationshipRecord {
  id: string
  kind: typeof PORTAL_DOOR_KIND | typeof PORTAL_RETURN_DOOR_KIND
  source: string
  target: string
  /** True for both halves of a door pair. Ordinary delete and undo must refuse these records. */
  nonDeletable: true
  orphaned?: boolean
}

export interface PortablePortalHierarchy {
  rootCanvasId: string
  canvases: PortalCanvasRecord[]
  nodes: PortalNodeRecord[]
  relationships: PortalRelationshipRecord[]
}

export interface PortalRepairRecord {
  id: string
  kind: 'orphaned-canvas' | 'rebuilt-shop' | 'removed-duplicate-shop' | 'rebuilt-door'
  canvasId?: string
  nodeId?: string
  detail: string
}

export interface PortalRepairResult {
  hierarchy: PortablePortalHierarchy
  repairs: PortalRepairRecord[]
}

export interface CreatePortalInput {
  portalNodeId: string
  ownerCanvasId: string
  targetCanvasId: string
  title: string
  universeScope?: PortalUniverseScope
}

export type PortalLifecycleEvent =
  | {
      id: string
      kind: 'canvas-created'
      canvas: PortalCanvasRecord
      nodes?: PortalNodeRecord[]
      relationships?: PortalRelationshipRecord[]
    }
  | {
      id: string
      kind: 'canvas-deleted'
      canvasId: string
      canvas?: PortalCanvasRecord
      nodes?: PortalNodeRecord[]
      relationships?: PortalRelationshipRecord[]
    }
  | {
      id: string
      kind: 'canvas-recovered'
      canvasId: string
      parentCanvasId: string
    }
  | {
      id: string
      kind: 'node-upserted'
      node: PortalNodeRecord
    }
  | {
      id: string
      kind: 'relationship-upserted'
      relationship: PortalRelationshipRecord
    }

export interface PortalLifecycleState extends PortablePortalHierarchy {
  /** Append-only event ids make retries from a peer and replay after restart idempotent. */
  appliedEventIds: string[]
  history: PortalLifecycleEvent[]
}

export interface PortalOrphan {
  canvasId: string
  reason: 'missing-parent' | 'cycle' | 'deleted-parent' | 'missing-door-target'
  preservedNodeIds: string[]
  recoverable: true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Portal ${label} is invalid.`)
  }
  return value
}

function boundedTitle(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 16_384) throw new Error(`Portal ${label} is invalid.`)
  return value
}

function boundedNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > 1_000_000_000) throw new Error(`Portal ${label} is invalid.`)
  return value
}

const FORBIDDEN_SETTING_KEY = /credential|password|passkey|secret|token|vault|path|directory|cwd|host|port|socket|cookie|session|process|pid|cache|machine|environment|profile|account/i

function safeSettings(value: unknown, depth = 0, count = { value: 0 }): Record<string, unknown> {
  if (!isRecord(value) || depth > PORTAL_MAX_DEPTH) throw new Error('Portal settings are invalid.')
  const copy = (candidate: unknown, level: number): unknown => {
    if (++count.value > 4096 || level > PORTAL_MAX_DEPTH) throw new Error('Portal settings exceed their bounds.')
    if (candidate === null || typeof candidate === 'boolean') return candidate
    if (typeof candidate === 'string') {
      if (candidate.length > 16_384 || /[\u0000-\u001f\u007f]/.test(candidate)) throw new Error('Portal settings contain invalid text.')
      return candidate
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate) || Math.abs(candidate) > 1_000_000_000) throw new Error('Portal setting value is invalid.')
      return candidate
    }
    if (Array.isArray(candidate)) return candidate.map((item) => copy(item, level + 1))
    if (!isRecord(candidate)) throw new Error('Portal settings contain an unsafe value.')
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(candidate)) {
      boundedId(key, 'setting key')
      if (FORBIDDEN_SETTING_KEY.test(key)) throw new Error(`Portal setting is not portable: ${key}`)
      output[key] = copy(item, level + 1)
    }
    return output
  }
  return copy(value, depth) as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Portal ${label} contains an unknown field: ${key}`)
}

function cloned<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Stable id for the structural Shop belonging to one universe canvas. */
export function deterministicShopNodeId(canvasId: string): string {
  const id = boundedId(canvasId, 'canvas id')
  return `shop-${id}`
}

/** Stable ids for the two halves of a portal door pair. */
export function portalDoorRelationshipId(portalNodeId: string): string {
  return `door-${boundedId(portalNodeId, 'portal node id')}`
}

export function portalReturnRelationshipId(portalNodeId: string): string {
  return `return-${boundedId(portalNodeId, 'portal node id')}`
}

/** Build a portal node and both immutable halves of its return-door relationship. */
export function createPortalRecords(input: CreatePortalInput): {
  node: PortalNodeRecord
  relationships: [PortalRelationshipRecord, PortalRelationshipRecord]
} {
  const portalNodeId = boundedId(input.portalNodeId, 'portal node id')
  const ownerCanvasId = boundedId(input.ownerCanvasId, 'owner canvas id')
  const targetCanvasId = boundedId(input.targetCanvasId, 'target canvas id')
  const node: PortalNodeRecord = {
    id: portalNodeId,
    kind: 'portal',
    canvasId: ownerCanvasId,
    title: boundedTitle(input.title, 'portal title'),
    targetCanvasId,
    returnDoorId: portalReturnRelationshipId(portalNodeId),
    ...(input.universeScope ? { universeScope: input.universeScope } : {}),
    nonDeletable: true
  }
  return {
    node,
    relationships: [
      { id: portalDoorRelationshipId(portalNodeId), kind: PORTAL_DOOR_KIND, source: portalNodeId, target: targetCanvasId, nonDeletable: true },
      { id: portalReturnRelationshipId(portalNodeId), kind: PORTAL_RETURN_DOOR_KIND, source: targetCanvasId, target: portalNodeId, nonDeletable: true }
    ]
  }
}

/** Create the one structural Shop that every universe canvas owns. */
export function createUniverseShop(canvasId: string, universeScope: PortalUniverseScope, title = 'Shop'): PortalNodeRecord {
  return {
    id: deterministicShopNodeId(canvasId),
    kind: PORTAL_SHOP_KIND,
    canvasId: boundedId(canvasId, 'canvas id'),
    title: boundedTitle(title, 'Shop title'),
    universeScope,
    nonDeletable: true
  }
}

/** Validate the small event envelope before it can affect local state or be reflected to peers. */
export function validatePortalLifecycleEvent(value: unknown): PortalLifecycleEvent {
  if (!isRecord(value)) throw new Error('Portal lifecycle event is invalid.')
  const id = boundedId(value.id, 'event id')
  if (value.kind === 'canvas-created') {
    exactKeys(value, new Set(['id', 'kind', 'canvas', 'nodes', 'relationships']), 'canvas-created event')
    if (!isRecord(value.canvas)) throw new Error('Portal canvas-created event is missing its canvas.')
    const canvas = validatePortalCanvas(value.canvas)
    const nodes = value.nodes === undefined ? undefined : Array.isArray(value.nodes) ? value.nodes.map((node) => validatePortalNode(node)) : (() => { throw new Error('Portal canvas-created nodes are invalid.') })()
    const relationships = value.relationships === undefined ? undefined : Array.isArray(value.relationships) ? value.relationships.map((relationship) => validatePortalRelationship(relationship)) : (() => { throw new Error('Portal canvas-created relationships are invalid.') })()
    return { id, kind: 'canvas-created', canvas, ...(nodes ? { nodes } : {}), ...(relationships ? { relationships } : {}) }
  }
  if (value.kind === 'canvas-deleted') {
    exactKeys(value, new Set(['id', 'kind', 'canvasId', 'canvas', 'nodes', 'relationships']), 'canvas-deleted event')
    const canvasId = boundedId(value.canvasId, 'canvas id')
    return { id, kind: 'canvas-deleted', canvasId, ...(isRecord(value.canvas) ? { canvas: validatePortalCanvas(value.canvas) } : {}), ...(Array.isArray(value.nodes) ? { nodes: value.nodes.map((node) => validatePortalNode(node)) } : {}), ...(Array.isArray(value.relationships) ? { relationships: value.relationships.map((relationship) => validatePortalRelationship(relationship)) } : {}) }
  }
  if (value.kind === 'canvas-recovered') { exactKeys(value, new Set(['id', 'kind', 'canvasId', 'parentCanvasId']), 'canvas-recovered event'); return { id, kind: 'canvas-recovered', canvasId: boundedId(value.canvasId, 'canvas id'), parentCanvasId: boundedId(value.parentCanvasId, 'parent canvas id') } }
  if (value.kind === 'node-upserted') { exactKeys(value, new Set(['id', 'kind', 'node']), 'node-upserted event'); return { id, kind: 'node-upserted', node: validatePortalNode(value.node) } }
  if (value.kind === 'relationship-upserted') { exactKeys(value, new Set(['id', 'kind', 'relationship']), 'relationship-upserted event'); return { id, kind: 'relationship-upserted', relationship: validatePortalRelationship(value.relationship) } }
  throw new Error('Portal lifecycle event kind is invalid.')
}

function validatePortalCanvas(value: unknown): PortalCanvasRecord {
  if (!isRecord(value)) throw new Error('Portal event canvas is invalid.')
  exactKeys(value, new Set(['id', 'scope', 'parentCanvasId', 'title', 'order', 'nodeIds', 'orphaned', 'orphanedFromCanvasId']), 'event canvas')
  const scope = value.scope
  if (scope !== 'root' && scope !== 'multiverse' && scope !== 'aws-universe') throw new Error('Portal event canvas scope is invalid.')
  if (scope !== 'root' && value.parentCanvasId === undefined && value.orphaned !== true) throw new Error('Portal event child canvas has no parent.')
  if (!Array.isArray(value.nodeIds)) throw new Error('Portal event canvas node list is invalid.')
  return { id: boundedId(value.id, 'canvas id'), scope, ...(value.parentCanvasId !== undefined ? { parentCanvasId: boundedId(value.parentCanvasId, 'parent canvas id') } : {}), title: boundedTitle(value.title, 'canvas title'), order: boundedNumber(value.order, 'canvas order'), nodeIds: value.nodeIds.map((nodeId) => boundedId(nodeId, 'canvas node id')), ...(value.orphaned === true ? { orphaned: true } : {}), ...(value.orphanedFromCanvasId !== undefined ? { orphanedFromCanvasId: boundedId(value.orphanedFromCanvasId, 'orphan source') } : {}) }
}

function validatePortalNode(value: unknown): PortalNodeRecord {
  const candidate = isRecord(value) ? value : null
  if (!candidate) throw new Error('Portal event node is invalid.')
  exactKeys(candidate, new Set(['id', 'kind', 'canvasId', 'title', 'targetCanvasId', 'returnDoorId', 'universeScope', 'nonDeletable', 'settings']), 'event node')
  const kind = candidate.kind === 'portal' || candidate.kind === PORTAL_SHOP_KIND ? candidate.kind : null
  if (!kind) throw new Error('Portal event node kind is invalid.')
  if (candidate.nonDeletable !== true) throw new Error('Portal event node is deletable.')
  if (candidate.universeScope !== undefined && candidate.universeScope !== 'multiverse' && candidate.universeScope !== 'aws-universe') throw new Error('Portal event node scope is invalid.')
  const node: PortalNodeRecord = { id: boundedId(candidate.id, 'node id'), kind, canvasId: boundedId(candidate.canvasId, 'node canvas id'), title: boundedTitle(candidate.title, 'node title'), ...(candidate.targetCanvasId !== undefined ? { targetCanvasId: boundedId(candidate.targetCanvasId, 'target canvas id') } : {}), ...(candidate.returnDoorId !== undefined ? { returnDoorId: boundedId(candidate.returnDoorId, 'return door id') } : {}), ...(candidate.universeScope !== undefined ? { universeScope: candidate.universeScope as PortalUniverseScope } : {}), nonDeletable: true, ...(candidate.settings !== undefined ? { settings: safeSettings(candidate.settings) } : {}) }
  if (kind === PORTAL_SHOP_KIND && node.id !== deterministicShopNodeId(node.canvasId)) throw new Error('Portal event Shop id is invalid.')
  if (kind === 'portal' && (!node.targetCanvasId || !node.returnDoorId)) throw new Error('Portal event portal is incomplete.')
  return node
}

function validatePortalRelationship(value: unknown): PortalRelationshipRecord {
  if (!isRecord(value) || (value.kind !== PORTAL_DOOR_KIND && value.kind !== PORTAL_RETURN_DOOR_KIND) || value.nonDeletable !== true) throw new Error('Portal event relationship is invalid.')
  return { id: boundedId(value.id, 'relationship id'), kind: value.kind as PortalRelationshipRecord['kind'], source: boundedId(value.source, 'relationship source'), target: boundedId(value.target, 'relationship target'), nonDeletable: true, ...(value.orphaned === true ? { orphaned: true } : {}) }
}

/** A portal relationship is structural. All ordinary destructive paths should consult this. */
export function isNonDeletablePortalRelationship(value: unknown): value is PortalRelationshipRecord {
  return isRecord(value) &&
    (value.kind === PORTAL_DOOR_KIND || value.kind === PORTAL_RETURN_DOOR_KIND) &&
    value.nonDeletable === true
}

export function portalDestructiveActionRequiresConfirmation(action: string): boolean {
  return action === 'delete-project' || action === 'delete-child-canvas' || action === 'delete-portal' || action === 'remove-portal-door'
}

/** Ordinary removal never deletes either half of a door pair. */
export function canDeletePortalRelationship(value: unknown): boolean {
  return !isNonDeletablePortalRelationship(value)
}

/** Structural portal nodes are never removed by an ordinary canvas delete or duplicate action. */
export function canDeletePortalNode(value: unknown): boolean {
  return !(isRecord(value) && (value.kind === 'portal' || value.kind === PORTAL_SHOP_KIND) && value.nonDeletable === true)
}

function canvasDepth(id: string, byId: Map<string, PortalCanvasRecord>): number {
  let depth = 0
  let current: string | undefined = id
  const seen = new Set<string>()
  while (current !== undefined) {
    if (seen.has(current)) throw new Error('Portal canvas hierarchy contains a cycle.')
    seen.add(current)
    const canvas = byId.get(current)
    if (!canvas) throw new Error(`Portal canvas parent is missing: ${current}`)
    if (canvas.parentCanvasId === undefined) return depth
    depth += 1
    if (depth > PORTAL_MAX_DEPTH) throw new Error(`Portal canvas hierarchy exceeds depth ${PORTAL_MAX_DEPTH}.`)
    current = canvas.parentCanvasId
  }
  return depth
}

/** Validate a complete portable hierarchy and return a detached normalized copy. */
export function validatePortablePortalHierarchy(input: unknown): PortablePortalHierarchy {
  if (!isRecord(input) || typeof input.rootCanvasId !== 'string' || !Array.isArray(input.canvases) || !Array.isArray(input.nodes) || !Array.isArray(input.relationships)) {
    throw new Error('Portable portal hierarchy is invalid.')
  }
  exactKeys(input, new Set(['rootCanvasId', 'canvases', 'nodes', 'relationships']), 'hierarchy')
  const rootCanvasId = boundedId(input.rootCanvasId, 'root canvas id')
  const canvases: PortalCanvasRecord[] = []
  const canvasIds = new Set<string>()
  for (const raw of input.canvases) {
    if (!isRecord(raw)) throw new Error('Portable portal canvas is invalid.')
    exactKeys(raw, new Set(['id', 'scope', 'parentCanvasId', 'title', 'order', 'nodeIds', 'orphaned', 'orphanedFromCanvasId']), 'canvas')
    const id = boundedId(raw.id, 'canvas id')
    if (canvasIds.has(id)) throw new Error(`Duplicate portal canvas: ${id}`)
    canvasIds.add(id)
    if (raw.scope !== 'root' && raw.scope !== 'multiverse' && raw.scope !== 'aws-universe') throw new Error(`Portal canvas scope is invalid: ${id}`)
    const scope = raw.scope as PortalCanvasScope
    if (raw.parentCanvasId !== undefined) boundedId(raw.parentCanvasId, 'parent canvas id')
    if (!Array.isArray(raw.nodeIds) || raw.nodeIds.some((nodeId) => typeof nodeId !== 'string')) throw new Error(`Portal canvas node list is invalid: ${id}`)
    const nodeIds = raw.nodeIds.map((nodeId) => boundedId(nodeId, 'canvas node id'))
    if (new Set(nodeIds).size !== nodeIds.length) throw new Error(`Portal canvas repeats a node: ${id}`)
    canvases.push({ id, scope, ...(raw.parentCanvasId !== undefined ? { parentCanvasId: boundedId(raw.parentCanvasId, 'parent canvas id') } : {}), title: boundedTitle(raw.title, 'canvas title'), order: boundedNumber(raw.order, 'canvas order'), nodeIds, ...(raw.orphaned === true ? { orphaned: true } : {}), ...(raw.orphanedFromCanvasId !== undefined ? { orphanedFromCanvasId: boundedId(raw.orphanedFromCanvasId, 'orphan source') } : {}) })
  }
  const byCanvasId = new Map(canvases.map((canvas) => [canvas.id, canvas]))
  const roots = canvases.filter((canvas) => canvas.scope === 'root')
  if (roots.length !== 1 || roots[0].id !== rootCanvasId || roots[0].parentCanvasId !== undefined) throw new Error('Portable portal hierarchy must contain exactly one parentless root canvas.')
  for (const canvas of canvases) {
    if (canvas.scope !== 'root' && canvas.parentCanvasId === undefined && !canvas.orphaned) throw new Error(`Portal child canvas has no parent: ${canvas.id}`)
    if (canvas.parentCanvasId !== undefined && !byCanvasId.has(canvas.parentCanvasId)) throw new Error(`Portal canvas parent is missing: ${canvas.id}`)
    if (!canvas.orphaned) canvasDepth(canvas.id, byCanvasId)
  }

  const nodes: PortalNodeRecord[] = []
  const nodeIds = new Set<string>()
  const nodeById = new Map<string, PortalNodeRecord>()
  for (const raw of input.nodes) {
    if (!isRecord(raw)) throw new Error('Portable portal node is invalid.')
    exactKeys(raw, new Set(['id', 'kind', 'canvasId', 'title', 'targetCanvasId', 'returnDoorId', 'universeScope', 'nonDeletable', 'settings']), 'node')
    const id = boundedId(raw.id, 'node id')
    if (nodeIds.has(id)) throw new Error(`Duplicate portal node: ${id}`)
    if (raw.kind !== 'portal' && raw.kind !== PORTAL_SHOP_KIND) throw new Error(`Unsupported portal node kind: ${id}`)
    const canvasId = boundedId(raw.canvasId, 'node canvas id')
    if (!byCanvasId.has(canvasId)) throw new Error(`Portal node canvas is missing: ${id}`)
    const kind = raw.kind as PortalNodeRecord['kind']
    if (raw.universeScope !== undefined && raw.universeScope !== 'multiverse' && raw.universeScope !== 'aws-universe') throw new Error(`Portal node scope is invalid: ${id}`)
    const node: PortalNodeRecord = { id, kind, canvasId, title: boundedTitle(raw.title, 'node title'), ...(raw.targetCanvasId !== undefined ? { targetCanvasId: boundedId(raw.targetCanvasId, 'target canvas id') } : {}), ...(raw.returnDoorId !== undefined ? { returnDoorId: boundedId(raw.returnDoorId, 'return door id') } : {}), ...(raw.universeScope !== undefined ? { universeScope: raw.universeScope as PortalUniverseScope } : {}), ...(raw.nonDeletable === true ? { nonDeletable: true } : {}), ...(raw.settings !== undefined ? { settings: safeSettings(raw.settings) } : {}) }
    if (node.kind === PORTAL_SHOP_KIND && node.id !== deterministicShopNodeId(canvasId)) throw new Error(`Portal Shop id is not deterministic: ${id}`)
    if (node.kind === PORTAL_SHOP_KIND && raw.nonDeletable !== true) throw new Error(`Portal Shop is deletable: ${id}`)
    if (node.kind === 'portal' && (node.nonDeletable !== true || !node.targetCanvasId || !node.returnDoorId)) throw new Error(`Portal node is missing its target, return door, or structural marker: ${id}`)
    nodeIds.add(id); nodes.push(node); nodeById.set(id, node)
  }
  const membership = new Map<string, number>()
  for (const canvas of canvases) for (const nodeId of canvas.nodeIds) {
    if (!nodeIds.has(nodeId)) throw new Error(`Portal canvas references an unknown node: ${nodeId}`)
    membership.set(nodeId, (membership.get(nodeId) ?? 0) + 1)
  }
  for (const id of nodeIds) if (membership.get(id) !== 1) throw new Error(`Portal node must belong to exactly one canvas: ${id}`)
  for (const canvas of canvases) {
    const shops = nodes.filter((node) => node.kind === PORTAL_SHOP_KIND && node.canvasId === canvas.id)
    if (canvas.scope === 'root' && shops.length > 0) throw new Error('The root canvas cannot contain a Shop node.')
    if (canvas.scope !== 'root' && shops.length !== 1) throw new Error(`Universe canvas must contain exactly one Shop node: ${canvas.id}`)
    if (shops[0]?.universeScope !== undefined && shops[0].universeScope !== canvas.scope) throw new Error(`Portal Shop scope does not match its canvas: ${canvas.id}`)
  }

  const relationships: PortalRelationshipRecord[] = []
  const relationshipIds = new Set<string>()
  for (const raw of input.relationships) {
    if (!isRecord(raw)) throw new Error('Portable portal relationship is invalid or deletable.')
    exactKeys(raw, new Set(['id', 'kind', 'source', 'target', 'nonDeletable', 'orphaned']), 'relationship')
    if ((raw.kind !== PORTAL_DOOR_KIND && raw.kind !== PORTAL_RETURN_DOOR_KIND) || raw.nonDeletable !== true) throw new Error('Portable portal relationship is invalid or deletable.')
    const id = boundedId(raw.id, 'relationship id')
    if (relationshipIds.has(id)) throw new Error(`Duplicate portal relationship: ${id}`)
    const source = boundedId(raw.source, 'relationship source'); const target = boundedId(raw.target, 'relationship target')
    if (!nodeById.has(source) && !byCanvasId.has(source) && raw.orphaned !== true) throw new Error(`Portal relationship source is missing: ${id}`)
    if (!nodeById.has(target) && !byCanvasId.has(target) && raw.orphaned !== true) throw new Error(`Portal relationship target is missing: ${id}`)
    relationshipIds.add(id); relationships.push({ id, kind: raw.kind as PortalRelationshipRecord['kind'], source, target, nonDeletable: true, ...(raw.orphaned === true ? { orphaned: true } : {}) })
  }
  for (const node of nodes.filter((candidate) => candidate.kind === 'portal')) {
    const target = node.targetCanvasId ? byCanvasId.get(node.targetCanvasId) : undefined
    if (!target || target.scope === 'root' || (!target.orphaned && target.parentCanvasId !== node.canvasId)) throw new Error(`Portal target is not a child of its owner canvas: ${node.id}`)
    if (!relationships.some((relationship) => relationship.id === portalDoorRelationshipId(node.id) && relationship.source === node.id && relationship.target === node.targetCanvasId)) throw new Error(`Portal door relationship is missing: ${node.id}`)
    if (!relationships.some((relationship) => relationship.id === node.returnDoorId && relationship.kind === PORTAL_RETURN_DOOR_KIND)) throw new Error(`Portal return door relationship is missing: ${node.id}`)
  }
  return { rootCanvasId, canvases, nodes, relationships }
}

/** Repair only structural damage that can be recovered without dropping child content. */
export function repairPortablePortalHierarchy(input: unknown): PortalRepairResult {
  if (!isRecord(input) || !Array.isArray(input.canvases) || !Array.isArray(input.nodes) || !Array.isArray(input.relationships)) throw new Error('Portable portal hierarchy is invalid.')
  const raw = cloned(input) as Record<string, unknown>
  const repairs: PortalRepairRecord[] = []
  const canvases = raw.canvases as Record<string, unknown>[]
  const canvasById = new Map<string, Record<string, unknown>>()
  for (const canvas of canvases) if (isRecord(canvas) && typeof canvas.id === 'string') canvasById.set(canvas.id, canvas)
  for (const canvas of canvases) {
    if (!isRecord(canvas) || canvas.scope === 'root' || canvas.orphaned === true) continue
    const parent = typeof canvas.parentCanvasId === 'string' ? canvas.parentCanvasId : undefined
    let current = canvas.id as string
    const seen = new Set<string>()
    let broken = !parent || !canvasById.has(parent)
    while (!broken && current) {
      if (seen.has(current)) { broken = true; break }
      seen.add(current)
      const next = canvasById.get(current)?.parentCanvasId
      current = typeof next === 'string' ? next : ''
    }
    if (broken) {
      canvas.orphaned = true
      canvas.orphanedFromCanvasId = parent
      delete canvas.parentCanvasId
      repairs.push({ id: `repair-orphan-${String(canvas.id)}`, kind: 'orphaned-canvas', canvasId: String(canvas.id), detail: 'Child canvas was preserved as an orphan because its parent relationship could not be trusted.' })
    }
  }
  const nodes = raw.nodes as Record<string, unknown>[]
  for (const canvas of canvases) {
    if (!isRecord(canvas) || (canvas.scope !== 'multiverse' && canvas.scope !== 'aws-universe')) continue
    const id = String(canvas.id)
    const nodeIds = Array.isArray(canvas.nodeIds) ? canvas.nodeIds.filter((value): value is string => typeof value === 'string') : []
    const shops = nodes.filter((node) => isRecord(node) && node.kind === PORTAL_SHOP_KIND && node.canvasId === id)
    const wantedId = deterministicShopNodeId(id)
    if (shops.length === 0) {
      const shop: Record<string, unknown> = { id: wantedId, kind: PORTAL_SHOP_KIND, canvasId: id, title: 'Shop', universeScope: canvas.scope, nonDeletable: true }
      nodes.push(shop); nodeIds.push(wantedId)
      repairs.push({ id: `repair-shop-${id}`, kind: 'rebuilt-shop', canvasId: id, nodeId: wantedId, detail: 'Universe canvas had no Shop, so its deterministic non-deletable Shop was rebuilt.' })
    } else {
      const keep = shops.find((node) => node.id === wantedId) ?? shops[0]
      if (keep.id !== wantedId) { keep.id = wantedId; repairs.push({ id: `repair-shop-id-${id}`, kind: 'rebuilt-shop', canvasId: id, nodeId: wantedId, detail: 'Universe Shop was re-keyed to its deterministic identity.' }) }
      keep.nonDeletable = true
      for (const duplicate of shops) if (duplicate !== keep) {
        const index = nodeIds.indexOf(String(duplicate.id)); if (index >= 0) nodeIds.splice(index, 1)
        const duplicateIndex = nodes.indexOf(duplicate); if (duplicateIndex >= 0) nodes.splice(duplicateIndex, 1)
        repairs.push({ id: `repair-shop-duplicate-${String(duplicate.id)}`, kind: 'removed-duplicate-shop', canvasId: id, nodeId: String(duplicate.id), detail: 'Duplicate Shop was removed while preserving the deterministic Shop and all child content.' })
      }
    }
    canvas.nodeIds = [...new Set(nodeIds)]
  }
  const hierarchy = validatePortablePortalHierarchy(raw)
  return { hierarchy, repairs }
}

/** Remove a project root while retaining every child canvas and its content for recovery. */
export function deleteProjectPreservingChildren(state: PortalLifecycleState, rootCanvasId = state.rootCanvasId): PortalLifecycleState {
  const next = cloned(state)
  const root = next.canvases.find((canvas) => canvas.id === rootCanvasId)
  if (!root) return next
  const removedNodes = next.nodes.filter((node) => node.canvasId === rootCanvasId)
  const removedRelationships = next.relationships.filter((relationship) =>
    relationship.source === rootCanvasId || relationship.target === rootCanvasId || removedNodes.some((node) => node.id === relationship.source || node.id === relationship.target)
  )
  const childIds = next.canvases.filter((canvas) => canvas.parentCanvasId === rootCanvasId).map((canvas) => canvas.id)
  next.canvases = next.canvases.filter((canvas) => canvas.id !== rootCanvasId).map((canvas) => childIds.includes(canvas.id) ? { ...canvas, parentCanvasId: undefined, orphaned: true, orphanedFromCanvasId: rootCanvasId } : canvas)
  next.nodes = next.nodes.filter((node) => node.canvasId !== rootCanvasId)
  const remainingNodeIds = new Set(next.nodes.map((node) => node.id))
  const remainingCanvasIds = new Set(next.canvases.map((canvas) => canvas.id))
  next.relationships = next.relationships.map((relationship) =>
    remainingNodeIds.has(relationship.source) || remainingCanvasIds.has(relationship.source)
      ? (remainingNodeIds.has(relationship.target) || remainingCanvasIds.has(relationship.target) ? relationship : { ...relationship, orphaned: true })
      : { ...relationship, orphaned: true }
  )
  next.history = next.history.concat({ id: `delete-canvas-${rootCanvasId}`, kind: 'canvas-deleted', canvasId: rootCanvasId, canvas: root, nodes: removedNodes, relationships: removedRelationships })
  next.appliedEventIds = [...new Set(next.appliedEventIds.concat(`delete-canvas-${rootCanvasId}`))]
  return next
}

export function detectPortalOrphans(hierarchy: PortablePortalHierarchy): PortalOrphan[] {
  const byId = new Map(hierarchy.canvases.map((canvas) => [canvas.id, canvas]))
  const orphans: PortalOrphan[] = []
  for (const canvas of hierarchy.canvases) {
    if (canvas.scope === 'root') continue
    let reason: PortalOrphan['reason'] | undefined
    if (canvas.orphaned) reason = canvas.orphanedFromCanvasId && !byId.has(canvas.orphanedFromCanvasId) ? 'deleted-parent' : 'missing-parent'
    else if (!canvas.parentCanvasId || !byId.has(canvas.parentCanvasId)) reason = 'missing-parent'
    else {
      try { canvasDepth(canvas.id, byId) } catch { reason = 'cycle' }
    }
    const portal = hierarchy.nodes.find((node) => node.kind === 'portal' && node.targetCanvasId === canvas.id)
    if (!portal && canvas.parentCanvasId !== undefined) reason = reason ?? 'missing-door-target'
    if (reason) orphans.push({ canvasId: canvas.id, reason, preservedNodeIds: [...canvas.nodeIds], recoverable: true })
  }
  return orphans
}

export function recoverPortalOrphan(hierarchy: PortablePortalHierarchy, canvasId: string, parentCanvasId: string): PortablePortalHierarchy {
  const next = cloned(hierarchy)
  const canvas = next.canvases.find((candidate) => candidate.id === canvasId)
  if (!canvas) throw new Error(`Portal orphan is not known: ${canvasId}`)
  let parent = next.canvases.find((candidate) => candidate.id === parentCanvasId)
  if (!parent && parentCanvasId === PORTAL_ROOT_ID) {
    const recoveryRootId = 'recovery-root'
    if (canvasId === recoveryRootId) throw new Error('Portal orphan recovery parent is invalid.')
    parent = { id: recoveryRootId, scope: 'root', title: 'Recovered project', order: 0, nodeIds: [] }
    next.rootCanvasId = recoveryRootId
    next.canvases.unshift(parent)
  }
  if (canvasId === parentCanvasId || !parent) throw new Error('Portal orphan recovery parent is invalid.')
  canvas.parentCanvasId = parent.id
  delete canvas.orphaned
  delete canvas.orphanedFromCanvasId
  return validatePortablePortalHierarchy(next)
}

/** Apply one local or peer event. Replayed ids are no-ops, including after restart. */
export function applyPortalLifecycleEvent(state: PortalLifecycleState, event: PortalLifecycleEvent): PortalLifecycleState {
  const accepted = validatePortalLifecycleEvent(event)
  if (state.appliedEventIds.includes(accepted.id)) return state
  const next = cloned(state)
  let appliedEvent: PortalLifecycleEvent = accepted
  if (accepted.kind === 'canvas-created') {
    if (!next.canvases.some((canvas) => canvas.id === accepted.canvas.id)) next.canvases.push(cloned(accepted.canvas))
    for (const node of accepted.nodes ?? []) if (!next.nodes.some((candidate) => candidate.id === node.id)) next.nodes.push(cloned(node))
    for (const relationship of accepted.relationships ?? []) if (!next.relationships.some((candidate) => candidate.id === relationship.id)) next.relationships.push(cloned(relationship))
  } else if (accepted.kind === 'canvas-deleted') {
    const beforeCanvasCount = next.canvases.length
    const deleted = deleteProjectPreservingChildren(next, accepted.canvasId)
    next.canvases = deleted.canvases
    next.nodes = deleted.nodes
    next.relationships = deleted.relationships
    // The helper records a deterministic local event for direct callers. Peer replay must keep
    // only the peer's event id, otherwise one deletion appears twice in append-only history.
    next.history = state.history
    next.appliedEventIds = state.appliedEventIds
    const recorded = deleted.history[deleted.history.length - 1]
    if (deleted.canvases.length < beforeCanvasCount && recorded?.kind === 'canvas-deleted') appliedEvent = { ...accepted, canvas: accepted.canvas ?? recorded.canvas, nodes: accepted.nodes ?? recorded.nodes, relationships: accepted.relationships ?? recorded.relationships }
  } else if (accepted.kind === 'canvas-recovered') {
    const recovered = recoverPortalOrphan(next, accepted.canvasId, accepted.parentCanvasId)
    next.canvases = recovered.canvases
  } else if (accepted.kind === 'node-upserted') {
    const index = next.nodes.findIndex((node) => node.id === accepted.node.id)
    if (index === -1) next.nodes.push(cloned(accepted.node)); else if (next.nodes[index].kind === 'shop' || accepted.node.kind !== 'shop') next.nodes[index] = cloned(accepted.node)
  } else if (accepted.kind === 'relationship-upserted') {
    const index = next.relationships.findIndex((relationship) => relationship.id === accepted.relationship.id)
    if (index === -1) next.relationships.push(cloned(accepted.relationship)); else next.relationships[index] = cloned(accepted.relationship)
  }
  next.appliedEventIds = [...new Set(next.appliedEventIds.concat(appliedEvent.id))]
  next.history = next.history.concat(cloned(appliedEvent))
  return next
}

/** Undo is append-only: it emits an inverse event rather than removing the original history row. */
export function undoPortalLifecycleEvent(state: PortalLifecycleState, eventId: string): PortalLifecycleState {
  const event = state.history.find((candidate) => candidate.id === eventId)
  if (!event) return state
  if (event.kind === 'relationship-upserted' && event.relationship.nonDeletable) return state
  if (event.kind === 'canvas-deleted') {
    if (!event.canvas) return state
    const next = cloned(state)
    if (!next.canvases.some((canvas) => canvas.id === event.canvas!.id)) next.canvases.push(cloned(event.canvas))
    for (const node of event.nodes ?? []) if (!next.nodes.some((candidate) => candidate.id === node.id)) next.nodes.push(cloned(node))
    for (const relationship of event.relationships ?? []) {
      const index = next.relationships.findIndex((candidate) => candidate.id === relationship.id)
      if (index === -1) next.relationships.push(cloned(relationship)); else next.relationships[index] = cloned(relationship)
    }
    next.canvases = next.canvases.map((canvas) => canvas.orphanedFromCanvasId === event.canvasId ? { ...canvas, parentCanvasId: event.canvasId, orphaned: undefined, orphanedFromCanvasId: undefined } : canvas)
    const inverse: PortalLifecycleEvent = { id: `undo-${event.id}`, kind: 'canvas-created', canvas: event.canvas, nodes: event.nodes, relationships: event.relationships }
    next.appliedEventIds = [...new Set(next.appliedEventIds.concat(inverse.id))]
    next.history = next.history.concat(inverse)
    return next
  }
  return state
}

/** Build a fresh state while tolerating old payloads that had no event ledger. */
export function createPortalLifecycleState(hierarchy: PortablePortalHierarchy): PortalLifecycleState {
  const normalized = validatePortablePortalHierarchy(hierarchy)
  return { ...normalized, appliedEventIds: [], history: [] }
}

export const validatePortalHierarchy = validatePortablePortalHierarchy
export const repairPortalHierarchy = repairPortablePortalHierarchy
export const repairImportedPortalHierarchy = repairPortablePortalHierarchy
export const detectOrphanedPortals = detectPortalOrphans
export const detectPortalOrphansForProject = detectPortalOrphans
export const recoverOrphanedPortal = recoverPortalOrphan
export const applyPortalEvent = applyPortalLifecycleEvent
export const undoPortalEvent = undoPortalLifecycleEvent
export const createPortal = createPortalRecords
