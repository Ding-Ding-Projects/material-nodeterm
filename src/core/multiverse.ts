/** Platform-free Multiverse hierarchy, catalog, scope, and import seam. */

import type { CanvasNodeState, NodeKind, Viewport } from '../shared/types'
import { sanitizeInboundNode } from '../shared/node-exec'
import {
  MULTIVERSE_MAX_DEPTH,
  MULTIVERSE_ROOT_CANVAS_ID,
  type MultiverseChildCanvas,
  type MultiverseState
} from '../shared/multiverse'

export { MULTIVERSE_MAX_DEPTH, MULTIVERSE_ROOT_CANVAS_ID }
export type { MultiverseChildCanvas, MultiverseState }

export const MULTIVERSE_MAX_JSON_BYTES = 8 * 1024 * 1024

export type MultiverseScope = {
  rootCanvasId: typeof MULTIVERSE_ROOT_CANVAS_ID
  canvasId: string
  parentCanvasId?: string
  depth: number
}

export type MultiverseCommand =
  | { kind: 'create-child-canvas'; parentCanvasId: string; title: string }
  | { kind: 'open-child-canvas'; canvasId: string }
  | { kind: 'add-node'; canvasId: string; node: CanvasNodeState }
  | { kind: 'remove-node'; canvasId: string; nodeId: string }
  | { kind: 'move-node'; fromCanvasId: string; toCanvasId: string; nodeId: string }

export interface MultiverseCatalogEntry {
  kind: NodeKind
  label: string
  description: string
  scopes: readonly ('root' | 'multiverse')[]
}

export interface MultiverseCatalog {
  list(scope: MultiverseScope): readonly MultiverseCatalogEntry[]
  canCreate(kind: NodeKind, scope: MultiverseScope): boolean
}

/** A registry seam for future universe-specific nodes. Doors, codes, and games are intentionally
 * absent from this lane and must be added by their own later features. */
export const MULTIVERSE_CATALOG: MultiverseCatalog = {
  list(scope) {
    return MULTIVERSE_CATALOG_ENTRIES.filter((entry) => entry.scopes.includes(scope.depth === 0 ? 'root' : 'multiverse'))
  },
  canCreate(kind, scope) {
    return this.list(scope).some((entry) => entry.kind === kind)
  }
}

export const MULTIVERSE_CATALOG_ENTRIES: readonly MultiverseCatalogEntry[] = [
  { kind: 'terminal', label: 'Terminal', description: 'A terminal session scoped to this canvas.', scopes: ['root', 'multiverse'] },
  { kind: 'sticky', label: 'Sticky note', description: 'A note that belongs only to this canvas.', scopes: ['root', 'multiverse'] },
  { kind: 'group', label: 'Group', description: 'A group frame for this canvas.', scopes: ['root', 'multiverse'] },
  { kind: 'editor', label: 'Editor', description: 'A file editor scoped to this canvas.', scopes: ['root', 'multiverse'] },
  { kind: 'diff', label: 'Diff', description: 'A file diff scoped to this canvas.', scopes: ['root', 'multiverse'] }
]

export function emptyMultiverseState(): MultiverseState {
  return { rootCanvasId: MULTIVERSE_ROOT_CANVAS_ID, children: [] }
}

export function serializeMultiverseState(value: MultiverseState): Uint8Array {
  const checked = validateMultiverseState(value)
  const normalized = {
    ...checked,
    children: [...checked.children].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map((child) => ({
      ...child,
      nodes: [...child.nodes].sort((a, b) => a.id.localeCompare(b.id)),
      ...(child.bridges ? { bridges: [...child.bridges].sort((a, b) => a.id.localeCompare(b.id)) } : {}),
      ...(child.ropes ? { ropes: [...child.ropes].sort((a, b) => a.id.localeCompare(b.id)) } : {})
    }))
  }
  const bytes = new TextEncoder().encode(JSON.stringify(normalized))
  if (bytes.byteLength > MULTIVERSE_MAX_JSON_BYTES) throw new Error('Multiverse state exceeds its JSON size bound.')
  return bytes
}

export function parseMultiverseState(bytes: Uint8Array, rootNodeIds: ReadonlySet<string> = new Set()): MultiverseState {
  if (bytes.byteLength > MULTIVERSE_MAX_JSON_BYTES) throw new Error('Multiverse state exceeds its JSON size bound.')
  try {
    return validateMultiverseState(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), rootNodeIds)
  } catch (error) {
    if (error instanceof Error) throw error
    throw new Error('Multiverse state is not valid UTF-8 JSON.')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const MULTIVERSE_STATE_KEYS = new Set(['rootCanvasId', 'children', 'activeCanvasId'])
const MULTIVERSE_CHILD_KEYS = new Set(['id', 'rootCanvasId', 'parentCanvasId', 'title', 'order', 'depth', 'viewport', 'nodes', 'bridges', 'ropes'])

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Unknown Multiverse ${label} field: ${key}.`)
}

function validText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw new Error(`Invalid Multiverse ${label}.`)
  return value
}

function validNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9) throw new Error(`Invalid Multiverse ${label}.`)
  return value
}

function validViewport(value: unknown): Viewport {
  if (!isRecord(value)) throw new Error('Invalid Multiverse viewport.')
  return { x: validNumber(value.x, 'viewport x'), y: validNumber(value.y, 'viewport y'), zoom: validNumber(value.zoom, 'viewport zoom') }
}

function validLinks(value: unknown, nodeIds: ReadonlySet<string>, label: string): import('../shared/types').BridgeLink[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`Invalid Multiverse ${label}.`)
  const ids = new Set<string>()
  const links = value.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.source !== 'string' || typeof entry.target !== 'string') throw new Error(`Invalid Multiverse ${label} entry.`)
    exactKeys(entry, new Set(['id', 'source', 'target']), `${label} entry`)
    const id = validText(entry.id, `${label} id`)
    if (ids.has(id) || !nodeIds.has(entry.source) || !nodeIds.has(entry.target)) throw new Error(`Invalid Multiverse ${label} reference.`)
    ids.add(id)
    return { id, source: validText(entry.source, `${label} source`), target: validText(entry.target, `${label} target`) }
  })
  return links
}

function canvasDepth(id: string, byId: Map<string, MultiverseChildCanvas>): number {
  const seen = new Set<string>()
  let current = id
  let depth = 1
  while (current !== MULTIVERSE_ROOT_CANVAS_ID) {
    if (seen.has(current)) throw new Error('Multiverse hierarchy contains a cycle.')
    seen.add(current)
    const canvas = byId.get(current)
    if (!canvas) throw new Error('Multiverse parent canvas is missing.')
    current = canvas.parentCanvasId
    depth += 1
    if (depth > MULTIVERSE_MAX_DEPTH) throw new Error(`Multiverse hierarchy exceeds depth ${MULTIVERSE_MAX_DEPTH}.`)
  }
  return depth
}

function cloneNode(node: unknown): CanvasNodeState {
  if (!isRecord(node) || typeof node.id !== 'string' || typeof node.kind !== 'string' || !isRecord(node.position) || !isRecord(node.size)) throw new Error('Invalid Multiverse child node.')
  if (!hasNoTabRepresentation(node)) throw new Error('Multiverse child content cannot represent project tabs.')
  const position = { x: validNumber(node.position.x, 'node x'), y: validNumber(node.position.y, 'node y') }
  const size = { width: validNumber(node.size.width, 'node width'), height: validNumber(node.size.height, 'node height') }
  if (typeof node.title !== 'string' || node.title.length === 0 || typeof node.color !== 'string' || !('group' in node) || (node.group !== null && typeof node.group !== 'string')) throw new Error('Invalid Multiverse child node metadata.')
  return sanitizeInboundNode({ ...(node as unknown as CanvasNodeState), id: validText(node.id, 'node id'), kind: node.kind as NodeKind, position, size, title: validText(node.title, 'node title'), color: validText(node.color, 'node color'), group: node.group as string | null })
}

/** Validate an imported hierarchy before it can be adopted. No network, process, or host access. */
export function validateMultiverseState(value: unknown, rootNodeIds: ReadonlySet<string> = new Set()): MultiverseState {
  if (!isRecord(value) || value.rootCanvasId !== MULTIVERSE_ROOT_CANVAS_ID || !Array.isArray(value.children)) throw new Error('Invalid Multiverse state.')
  exactKeys(value, MULTIVERSE_STATE_KEYS, 'state')
  if (!hasNoTabRepresentation(value)) throw new Error('Multiverse state cannot represent project tabs.')
  const byId = new Map<string, MultiverseChildCanvas>()
  const seenNodes = new Set<string>(rootNodeIds)
  const children: MultiverseChildCanvas[] = []
  for (const raw of value.children) {
    if (!isRecord(raw) || raw.rootCanvasId !== MULTIVERSE_ROOT_CANVAS_ID || typeof raw.nodes === 'undefined') throw new Error('Invalid Multiverse child canvas.')
    exactKeys(raw, MULTIVERSE_CHILD_KEYS, 'child canvas')
    const id = validText(raw.id, 'canvas id')
    if (id === MULTIVERSE_ROOT_CANVAS_ID || byId.has(id)) throw new Error('Duplicate Multiverse canvas identity.')
    const parentCanvasId = validText(raw.parentCanvasId, 'parent canvas id')
    const nodes = Array.isArray(raw.nodes) ? raw.nodes.map(cloneNode) : (() => { throw new Error('Invalid Multiverse child content.') })()
    for (const node of nodes) {
      if (seenNodes.has(node.id)) throw new Error(`Duplicate Multiverse node identity: ${node.id}`)
      seenNodes.add(node.id)
    }
    const nodeIds = new Set(nodes.map((node) => node.id))
    const bridges = validLinks(raw.bridges, nodeIds, 'bridge links')
    const ropes = validLinks(raw.ropes, nodeIds, 'rope links')
    const canvas: MultiverseChildCanvas = { id, rootCanvasId: MULTIVERSE_ROOT_CANVAS_ID, parentCanvasId, title: validText(raw.title, 'canvas title'), order: validNumber(raw.order, 'canvas order'), depth: validNumber(raw.depth, 'canvas depth'), viewport: validViewport(raw.viewport), nodes, ...(bridges ? { bridges } : {}), ...(ropes ? { ropes } : {}) }
    byId.set(id, canvas)
    children.push(canvas)
  }
  for (const canvas of children) {
    const depth = canvasDepth(canvas.id, byId)
    if (canvas.depth !== depth) throw new Error('Multiverse child depth does not match its parent identity.')
  }
  const activeCanvasId = value.activeCanvasId === undefined ? undefined : validText(value.activeCanvasId, 'active canvas id')
  if (activeCanvasId !== undefined && !byId.has(activeCanvasId)) throw new Error('Multiverse active canvas is missing.')
  return { rootCanvasId: MULTIVERSE_ROOT_CANVAS_ID, children, ...(activeCanvasId ? { activeCanvasId } : {}) }
}

export function createMultiverseChildCanvas(state: MultiverseState, parentCanvasId: string, title: string, id: string, viewport: Viewport = { x: 0, y: 0, zoom: 1 }): MultiverseState {
  const current = validateMultiverseState(state)
  const parent = parentCanvasId === MULTIVERSE_ROOT_CANVAS_ID ? undefined : current.children.find((canvas) => canvas.id === parentCanvasId)
  if (parentCanvasId !== MULTIVERSE_ROOT_CANVAS_ID && !parent) throw new Error('Multiverse parent canvas is missing.')
  const depth = (parent?.depth ?? 0) + 1
  if (depth > MULTIVERSE_MAX_DEPTH) throw new Error(`Multiverse hierarchy is limited to depth ${MULTIVERSE_MAX_DEPTH}.`)
  if (current.children.some((canvas) => canvas.id === id)) throw new Error('Multiverse canvas id already exists.')
  const child: MultiverseChildCanvas = { id: validText(id, 'canvas id'), rootCanvasId: MULTIVERSE_ROOT_CANVAS_ID, parentCanvasId, title: validText(title, 'canvas title'), order: current.children.length, depth, viewport, nodes: [] }
  return validateMultiverseState({ ...current, children: [...current.children, child], activeCanvasId: id })
}

export function multiverseScope(state: MultiverseState, canvasId: string): MultiverseScope {
  const current = validateMultiverseState(state)
  if (canvasId === MULTIVERSE_ROOT_CANVAS_ID) return { rootCanvasId: MULTIVERSE_ROOT_CANVAS_ID, canvasId, depth: 0 }
  const canvas = current.children.find((candidate) => candidate.id === canvasId)
  if (!canvas) throw new Error('Multiverse canvas is not in this project.')
  return { rootCanvasId: MULTIVERSE_ROOT_CANVAS_ID, canvasId, parentCanvasId: canvas.parentCanvasId, depth: canvas.depth }
}

export function multiverseCanvas(state: MultiverseState, canvasId: string): MultiverseChildCanvas | undefined {
  const current = validateMultiverseState(state)
  return canvasId === MULTIVERSE_ROOT_CANVAS_ID ? undefined : current.children.find((canvas) => canvas.id === canvasId)
}

/** Add validated content to one child canvas. Root content is intentionally outside this API. */
export function addMultiverseNode(state: MultiverseState, canvasId: string, node: CanvasNodeState): MultiverseState {
  const current = validateMultiverseState(state)
  const scope = multiverseScope(current, canvasId)
  enforceMultiverseCommand(current, scope, { kind: 'add-node', canvasId, node })
  if (!MULTIVERSE_CATALOG.canCreate(node.kind, scope)) throw new Error(`Node kind ${node.kind} is not registered for Multiverse scope.`)
  const checked = validateMultiverseState({ ...current, children: current.children.map((child) => child.id === canvasId ? { ...child, nodes: [...child.nodes, node] } : child) })
  return checked
}

export function removeMultiverseNode(state: MultiverseState, canvasId: string, nodeId: string): MultiverseState {
  const current = validateMultiverseState(state)
  enforceMultiverseCommand(current, multiverseScope(current, canvasId), { kind: 'remove-node', canvasId, nodeId })
  return validateMultiverseState({ ...current, children: current.children.map((child) => child.id === canvasId ? { ...child, nodes: child.nodes.filter((node) => node.id !== nodeId) } : child) })
}

/** Reject commands that try to cross canvas scope or model a child canvas as a tab. */
export function enforceMultiverseCommand(state: MultiverseState, scope: MultiverseScope, command: MultiverseCommand): void {
  const current = validateMultiverseState(state)
  if (scope.rootCanvasId !== current.rootCanvasId) throw new Error('Multiverse command has an invalid root identity.')
  if (command.kind === 'create-child-canvas') {
    if (command.parentCanvasId !== scope.canvasId) throw new Error('Child canvas creation must stay in the current canvas scope.')
    if (scope.depth >= MULTIVERSE_MAX_DEPTH) throw new Error(`Multiverse hierarchy is limited to depth ${MULTIVERSE_MAX_DEPTH}.`)
    return
  }
  if (command.kind === 'open-child-canvas') {
    if (!current.children.some((canvas) => canvas.id === command.canvasId)) throw new Error('Child canvas is not in this project.')
    return
  }
  const addressed = command.kind === 'add-node' || command.kind === 'remove-node' ? command.canvasId : command.fromCanvasId
  if (addressed !== scope.canvasId) throw new Error('Command target is outside the active canvas scope.')
  if (command.kind === 'move-node' && command.toCanvasId !== scope.canvasId) throw new Error('Nodes cannot move across Multiverse canvas scopes.')
}

/** Runtime shape check for command/canvas records, deliberately excluding tab representation. */
export function hasNoTabRepresentation(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(hasNoTabRepresentation)
  if (!isRecord(value)) return true
  return !Object.entries(value).some(([key, child]) =>
    key === 'tabs' || key === 'tabId' || key === 'tabIndex' || key === 'projectTab' || !hasNoTabRepresentation(child)
  )
}
