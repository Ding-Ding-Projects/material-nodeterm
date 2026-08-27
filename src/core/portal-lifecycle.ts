/**
 * Portable Multiverse portal lifecycle.
 *
 * A portal owns a child canvas and one reciprocal door pair. The lifecycle is deliberately pure:
 * creating, opening, closing, deleting, and repairing a portal changes only a schema 3 projection.
 * Import can therefore repair missing door metadata without starting a process, contacting a
 * provider, or applying a destination binding. Deleting a portal flattens its child content into
 * the containing canvas so a user action never destroys notes, media references, or other nodes.
 */

import type { PortableCanvasProjectionV3, PortableCanvasV3, PortableCanvasNodeV3 } from './portable-canvas-projection'
import {
  createPortableUniverseDoorPair,
  type PortableUniverseDoorV3,
  validatePortableUniverseDoors
} from './universe-door-navigation'

export const PORTAL_SCOPE = 'multiverse' as const
export const MAX_PORTAL_DEPTH = 8

export type PortalLifecycleStatus = 'open' | 'closed'

export interface PortablePortalV3 {
  id: string
  parentCanvasId: string
  childCanvasId: string
  entryDoorId: string
  returnDoorId: string
  title: string
  depth: number
  status: PortalLifecycleStatus
}

export interface PortalRepairRecord {
  portalId?: string
  canvasId?: string
  action:
    | 'created-door-pair'
    | 'normalized'
    | 'removed-missing-canvas'
    | 'preserved-orphan-canvas'
    | 'preserved-child-content'
  detail: string
  preservedNodeIds: string[]
}

export interface PortalProjectionRepairResult {
  projection: PortableCanvasProjectionV3
  repairs: PortalRepairRecord[]
}

export interface PortalCreateRequest {
  portalId: string
  childCanvasId: string
  parentCanvasId: string
  title: string
  entryDoorId?: string
  returnDoorId?: string
  position?: { x: number; y: number }
}

export interface PortalCreateResult {
  projection: PortableCanvasProjectionV3 | null
  portal: PortablePortalV3 | null
  refused: boolean
  reason?: string
}

export interface PortalDeleteResult {
  projection: PortableCanvasProjectionV3 | null
  refused: boolean
  reason?: string
  preservedNodeIds: string[]
  removedCanvasIds: string[]
}

export type PortalNavigationResult =
  | { allowed: true; portal: PortablePortalV3; targetCanvasId: string; returnDoorId: string }
  | { allowed: false; reason: string; nextAction: string }

const ID_LIMIT = 256
const TITLE_LIMIT = 512

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max || [...value].some((char) => char < ' ' || char === '\u007f')) {
    throw new Error(`${label} must be non-empty bounded text.`)
  }
  return value
}

function depthForCanvas(canvasId: string, canvases: readonly PortableCanvasV3[]): number | null {
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
    if (depth > MAX_PORTAL_DEPTH) return depth
  }
  return null
}

function nextId(base: string, occupied: ReadonlySet<string>): string {
  if (!occupied.has(base)) return base
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}-${index}`
    if (!occupied.has(candidate)) return candidate
  }
  throw new Error(`No free identifier is available for ${base}.`)
}

function cloneProjection(projection: PortableCanvasProjectionV3): PortableCanvasProjectionV3 {
  return {
    ...projection,
    project: { ...projection.project },
    canvases: projection.canvases.map((canvas) => ({ ...canvas, nodeIds: [...canvas.nodeIds], ...(canvas.viewport ? { viewport: { ...canvas.viewport } } : {}) })),
    nodes: projection.nodes.map((node) => ({ ...node, position: { ...node.position }, size: { ...node.size }, ...(node.tags ? { tags: [...node.tags] } : {}) })),
    relationships: projection.relationships.map((link) => ({ ...link })),
    ...(projection.doors ? { doors: projection.doors.map((door) => ({ ...door })) } : {}),
    ...(projection.portals ? { portals: projection.portals.map((portal) => ({ ...portal })) } : {})
  }
}

function portalCanvasIds(projection: PortableCanvasProjectionV3): Set<string> {
  return new Set(projection.canvases.map((canvas) => canvas.id))
}

/** Validate only the portable portal records. Missing doors are intentionally allowed here so
 * import repair can recreate a reciprocal pair while retaining the child canvas and its nodes. */
export function validatePortablePortals(
  input: unknown,
  canvases: readonly PortableCanvasV3[]
): PortablePortalV3[] {
  if (input === undefined) return []
  if (!Array.isArray(input) || input.length > 4096) throw new Error('Portable portal records are invalid.')
  const canvasIds = portalCanvasIds({ canvases } as PortableCanvasProjectionV3)
  const seen = new Set<string>()
  const result: PortablePortalV3[] = []
  for (const value of input) {
    if (!record(value)) throw new Error('Portable portal record is invalid.')
    const allowed = new Set(['id', 'parentCanvasId', 'childCanvasId', 'entryDoorId', 'returnDoorId', 'title', 'depth', 'status'])
    for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Portable portal contains an unknown field: ${key}`)
    const portal: PortablePortalV3 = {
      id: text(value.id, 'Portal id', ID_LIMIT),
      parentCanvasId: text(value.parentCanvasId, 'Portal parent canvas id', ID_LIMIT),
      childCanvasId: text(value.childCanvasId, 'Portal child canvas id', ID_LIMIT),
      entryDoorId: text(value.entryDoorId, 'Portal entry door id', ID_LIMIT),
      returnDoorId: text(value.returnDoorId, 'Portal return door id', ID_LIMIT),
      title: text(value.title, 'Portal title', TITLE_LIMIT),
      depth: value.depth as number,
      status: value.status as PortalLifecycleStatus
    }
    if (seen.has(portal.id)) throw new Error(`Duplicate portable portal: ${portal.id}`)
    seen.add(portal.id)
    if (!canvasIds.has(portal.parentCanvasId) || !canvasIds.has(portal.childCanvasId) || portal.parentCanvasId === portal.childCanvasId) {
      throw new Error(`Portable portal ${portal.id} references an invalid canvas.`)
    }
    const child = canvases.find((canvas) => canvas.id === portal.childCanvasId)
    if (!child || child.scope !== PORTAL_SCOPE) throw new Error(`Portable portal ${portal.id} must target a Multiverse canvas.`)
    const measuredDepth = depthForCanvas(child.id, canvases)
    if (measuredDepth === null || measuredDepth < 1 || measuredDepth > MAX_PORTAL_DEPTH || portal.depth !== measuredDepth) {
      throw new Error(`Portable portal ${portal.id} has an invalid hierarchy depth.`)
    }
    if (portal.status !== 'open' && portal.status !== 'closed') throw new Error(`Portable portal ${portal.id} status is invalid.`)
    result.push(portal)
  }
  return result.sort((left, right) => left.id.localeCompare(right.id))
}

function portalDoors(portal: PortablePortalV3, existingDoors: readonly PortableUniverseDoorV3[] = []): [PortableUniverseDoorV3, PortableUniverseDoorV3] {
  const existingEntry = existingDoors.find((door) => door.id === portal.entryDoorId)
  const existingReturn = existingDoors.find((door) => door.id === portal.returnDoorId)
  return createPortableUniverseDoorPair({
    entryDoorId: portal.entryDoorId,
    returnDoorId: portal.returnDoorId,
    parentCanvasId: portal.parentCanvasId,
    childCanvasId: portal.childCanvasId,
    entryLabel: portal.title,
    returnLabel: `Return to ${portal.title}`,
    ...(existingEntry?.construction ? { entryConstruction: existingEntry.construction } : {}),
    ...(existingReturn?.construction ? { returnConstruction: existingReturn.construction } : {})
  })
}

/** Rebuild only missing or inconsistent door metadata. All canvases and node membership survive. */
export function repairPortablePortals(input: PortableCanvasProjectionV3): PortalProjectionRepairResult {
  const projection = cloneProjection(input)
  const repairs: PortalRepairRecord[] = []
  const portals = validatePortablePortals(projection.portals ?? [], projection.canvases)
  const validCanvasIds = portalCanvasIds(projection)
  const portalByChild = new Set<string>()
  const doors: PortableUniverseDoorV3[] = []
  const existingDoors = projection.doors ?? []
  const managedDoorIds = new Set(portals.flatMap((portal) => [portal.entryDoorId, portal.returnDoorId]))
  for (const portal of portals) {
    if (!validCanvasIds.has(portal.childCanvasId) || !validCanvasIds.has(portal.parentCanvasId)) {
      repairs.push({ portalId: portal.id, action: 'removed-missing-canvas', detail: 'The portal target was absent; its remaining canvases and nodes were kept.', preservedNodeIds: [] })
      continue
    }
    portalByChild.add(portal.childCanvasId)
    const [entry, exit] = portalDoors(portal, existingDoors)
    const entryPresent = existingDoors.some((door) => door.id === entry.id && door.canvasId === entry.canvasId && door.targetCanvasId === entry.targetCanvasId && door.pairedDoorId === entry.pairedDoorId)
    const exitPresent = existingDoors.some((door) => door.id === exit.id && door.canvasId === exit.canvasId && door.targetCanvasId === exit.targetCanvasId && door.pairedDoorId === exit.pairedDoorId)
    doors.push(entry, exit)
    if (!entryPresent || !exitPresent) {
      repairs.push({ portalId: portal.id, action: 'created-door-pair', detail: 'The reciprocal portal doors were missing or stale and were rebuilt from the safe portal intent.', preservedNodeIds: [] })
    }
  }
  for (const canvas of projection.canvases) {
    if (canvas.scope === PORTAL_SCOPE && !portalByChild.has(canvas.id)) {
      repairs.push({ canvasId: canvas.id, action: 'preserved-orphan-canvas', detail: 'An unreachable child canvas was retained with all of its content for explicit later repair.', preservedNodeIds: nodesForCanvas(projection, canvas.id) })
    }
  }
  const preservedDoors = existingDoors.filter((door) => !managedDoorIds.has(door.id))
  const repaired = {
    ...projection,
    ...(portals.length ? { portals } : {}),
    ...(doors.length || preservedDoors.length ? { doors: validatePortableUniverseDoors([...preservedDoors, ...doors], validCanvasIds) } : {})
  }
  return { projection: repaired, repairs }
}

function nodesForCanvas(projection: PortableCanvasProjectionV3, canvasId: string): string[] {
  return projection.canvases.find((canvas) => canvas.id === canvasId)?.nodeIds.filter((id) => projection.nodes.some((node) => node.id === id)) ?? []
}

/** Add one closed-by-default child portal with a reciprocal door pair. */
export function createPortablePortal(input: PortableCanvasProjectionV3, request: PortalCreateRequest): PortalCreateResult {
  try {
    const projection = cloneProjection(input)
    const parent = projection.canvases.find((canvas) => canvas.id === request.parentCanvasId)
    if (!parent) return { projection: null, portal: null, refused: true, reason: 'Choose an existing containing canvas for the portal.' }
    if (parent.scope !== 'root' && parent.scope !== PORTAL_SCOPE) return { projection: null, portal: null, refused: true, reason: 'Portals can only be created from the root or a Multiverse canvas.' }
    const childDepth = (depthForCanvas(parent.id, projection.canvases) ?? 0) + 1
    if (childDepth > MAX_PORTAL_DEPTH) return { projection: null, portal: null, refused: true, reason: `Multiverse portals stop at depth ${MAX_PORTAL_DEPTH}. Open a shallower canvas first.` }
    const portalId = text(request.portalId, 'Portal id', ID_LIMIT)
    const childCanvasId = text(request.childCanvasId, 'Portal child canvas id', ID_LIMIT)
    const title = text(request.title, 'Portal title', TITLE_LIMIT)
    const occupiedCanvas = new Set(projection.canvases.map((canvas) => canvas.id))
    const occupiedNodes = new Set(projection.nodes.map((node) => node.id))
    if (occupiedCanvas.has(childCanvasId)) return { projection: null, portal: null, refused: true, reason: 'That child canvas id is already in use.' }
    if ((projection.portals ?? []).some((portal) => portal.id === portalId)) return { projection: null, portal: null, refused: true, reason: 'That portal id is already in use.' }
    const entryDoorId = nextId(request.entryDoorId ?? `door-${portalId}-entry`, new Set([...(projection.doors ?? []).map((door) => door.id), ...occupiedNodes]))
    const returnDoorId = nextId(request.returnDoorId ?? `door-${portalId}-return`, new Set([...(projection.doors ?? []).map((door) => door.id), entryDoorId, ...occupiedNodes]))
    const portal: PortablePortalV3 = { id: portalId, parentCanvasId: parent.id, childCanvasId, entryDoorId, returnDoorId, title, depth: childDepth, status: 'closed' }
    const child: PortableCanvasV3 = { id: childCanvasId, scope: PORTAL_SCOPE, parentCanvasId: parent.id, depth: childDepth, title, order: projection.canvases.length, viewport: { x: 0, y: 0, zoom: 1 }, nodeIds: [] }
    const [entry, exit] = portalDoors(portal)
    const next = { ...projection, canvases: [...projection.canvases, child], portals: [...(projection.portals ?? []), portal], doors: [...(projection.doors ?? []), entry, exit] }
    return { projection: next, portal, refused: false }
  } catch (error) {
    return { projection: null, portal: null, refused: true, reason: error instanceof Error ? error.message : 'Portal creation was refused.' }
  }
}

/** Close or reopen a portal without touching child content. */
export function setPortablePortalStatus(input: PortableCanvasProjectionV3, portalId: string, status: PortalLifecycleStatus): PortableCanvasProjectionV3 {
  const projection = cloneProjection(input)
  const portal = (projection.portals ?? []).find((candidate) => candidate.id === portalId)
  if (!portal) return projection
  return { ...projection, portals: (projection.portals ?? []).map((candidate) => candidate.id === portalId ? { ...candidate, status } : candidate) }
}

/** Open a portal only from its containing canvas. Closed portals remain visible but refuse entry. */
export function navigatePortablePortal(input: PortableCanvasProjectionV3, portalId: string, fromCanvasId: string): PortalNavigationResult {
  const portal = (input.portals ?? []).find((candidate) => candidate.id === portalId)
  if (!portal) return { allowed: false, reason: 'The selected portal is not part of this project.', nextAction: 'Choose a visible portal on the current canvas.' }
  if (portal.parentCanvasId !== fromCanvasId) return { allowed: false, reason: 'That portal is not on the current canvas.', nextAction: 'Choose a portal shown on the current canvas.' }
  if (portal.status !== 'open') return { allowed: false, reason: 'This portal is closed.', nextAction: 'Open the portal, then activate it again.' }
  return { allowed: true, portal, targetCanvasId: portal.childCanvasId, returnDoorId: portal.returnDoorId }
}

/** Remove a portal while flattening every descendant canvas into its parent. Node ids and content
 * remain intact, while the now-unreachable child hierarchy and its doors are removed. */
export function deletePortablePortal(input: PortableCanvasProjectionV3, portalId: string): PortalDeleteResult {
  const projection = cloneProjection(input)
  const portal = (projection.portals ?? []).find((candidate) => candidate.id === portalId)
  if (!portal) return { projection, refused: true, reason: 'The selected portal is not part of this project.', preservedNodeIds: [], removedCanvasIds: [] }
  const descendants = new Set<string>([portal.childCanvasId])
  let changed = true
  while (changed) {
    changed = false
    for (const canvas of projection.canvases) {
      if (canvas.parentCanvasId && descendants.has(canvas.parentCanvasId) && !descendants.has(canvas.id)) {
        descendants.add(canvas.id)
        changed = true
      }
    }
  }
  const preservedNodeIds = projection.canvases.filter((canvas) => descendants.has(canvas.id)).flatMap((canvas) => canvas.nodeIds)
  const canvases = projection.canvases
    .filter((canvas) => !descendants.has(canvas.id))
    .map((canvas) => canvas.id === portal.parentCanvasId ? { ...canvas, nodeIds: [...canvas.nodeIds, ...preservedNodeIds.filter((id) => !canvas.nodeIds.includes(id))] } : canvas)
  const removedCanvasIds = [...descendants]
  const portals = (projection.portals ?? []).filter((candidate) => !descendants.has(candidate.childCanvasId) && !descendants.has(candidate.parentCanvasId))
  const doors = (projection.doors ?? []).filter((door) => !descendants.has(door.canvasId) && !descendants.has(door.targetCanvasId))
  return {
    projection: { ...projection, canvases, ...(portals.length ? { portals } : {}), ...(doors.length ? { doors } : {}) },
    refused: false,
    preservedNodeIds,
    removedCanvasIds
  }
}

/** Return the node ids retained by a repaired or deleted child hierarchy. */
export function preservedPortalNodeIds(input: PortableCanvasProjectionV3, canvasIds: readonly string[]): string[] {
  const wanted = new Set(canvasIds)
  return input.canvases.filter((canvas) => wanted.has(canvas.id)).flatMap((canvas) => canvas.nodeIds)
}

export function isPortablePortal(value: unknown): value is PortablePortalV3 {
  return record(value) && typeof value.id === 'string' && typeof value.parentCanvasId === 'string' && typeof value.childCanvasId === 'string' && typeof value.entryDoorId === 'string' && typeof value.returnDoorId === 'string' && typeof value.title === 'string' && typeof value.depth === 'number' && (value.status === 'open' || value.status === 'closed')
}

export type PortablePortalNode = PortableCanvasNodeV3 & { kind: 'portal' }
