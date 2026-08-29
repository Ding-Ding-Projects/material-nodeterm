import type {
  CanvasNodeState,
  CanvasScope,
  PortalDoor,
  PortalDoorDirection,
  PortalNavigationSnapshot,
  ProjectCanvas,
  Viewport
} from './types'

/** Reasons a navigation attempt is refused. These are user-facing states, not thrown exceptions. */
export type PortalNavigationRefusal =
  | 'not-at-parent'
  | 'not-at-child'
  | 'wrong-door-direction'
  | 'unknown-door'
  | 'unknown-canvas'
  | 'unmatched-door-pair'
  | 'invalid-topology'
  | 'direct-canvas-selection-refused'

export interface PortalNavigationResult {
  ok: boolean
  reason?: PortalNavigationRefusal
  snapshot?: PortalNavigationSnapshot
}

export interface PortalTopology {
  rootCanvasId: string
  canvases: ProjectCanvas[]
  nodes: CanvasNodeState[]
}

const ROOT_ID = 'root'
const scopes = new Set<CanvasScope>(['root', 'multiverse', 'aws-universe'])

function canvasMap(topology: PortalTopology): Map<string, ProjectCanvas> {
  const map = new Map<string, ProjectCanvas>([
    [topology.rootCanvasId, { id: topology.rootCanvasId, scope: 'root', parentCanvasId: '', title: 'Root', order: 0 }]
  ])
  for (const canvas of topology.canvases) map.set(canvas.id, canvas)
  return map
}

function nodeCanvas(node: CanvasNodeState): string {
  return node.canvasId ?? ROOT_ID
}

function doorsFor(topology: PortalTopology, pairId: string): Array<{ node: CanvasNodeState; canvasId: string; door: PortalDoor }> {
  return topology.nodes
    .filter((node) => node.portal?.doorPairId === pairId)
    .map((node) => ({ node, canvasId: nodeCanvas(node), door: node.portal! }))
}

/**
 * Validate every portal pair before a project is mounted. A pair is valid only when its entry
 * opens a child, its return door opens the exact parent, and both records carry the same pair id.
 */
export function validatePortalTopology(topology: PortalTopology): PortalNavigationRefusal | null {
  const maps = canvasMap(topology)
  if (!maps.has(topology.rootCanvasId)) return 'unknown-canvas'
  const children = topology.canvases.filter((canvas) => canvas.id !== topology.rootCanvasId)
  for (const canvas of children) {
    if (!scopes.has(canvas.scope) || canvas.scope === 'root' || !maps.has(canvas.parentCanvasId) || canvas.parentCanvasId === canvas.id) return 'invalid-topology'
  }
  const pairs = new Set(topology.nodes.flatMap((node) => node.portal ? [node.portal.doorPairId] : []))
  for (const pairId of pairs) {
    const doors = doorsFor(topology, pairId)
    if (doors.length !== 2) return 'unmatched-door-pair'
    const entry = doors.find((item) => item.door.direction === 'entry')
    const back = doors.find((item) => item.door.direction === 'return')
    if (!entry || !back) return 'wrong-door-direction'
    const child = maps.get(entry.door.targetCanvasId)
    if (!child || child.scope === 'root' || child.parentCanvasId !== back.canvasId || back.door.targetCanvasId !== entry.canvasId) return 'unmatched-door-pair'
    if (entry.canvasId !== child.parentCanvasId) return 'unmatched-door-pair'
  }
  return null
}

function matchingDoor(topology: PortalTopology, doorNodeId: string, direction: PortalDoorDirection): { node: CanvasNodeState; canvasId: string; door: PortalDoor } | null {
  const source = topology.nodes.find((node) => node.id === doorNodeId)
  if (!source?.portal || source.portal.direction !== direction) return null
  const pair = doorsFor(topology, source.portal.doorPairId)
  return pair.find((item) => item.node.id !== source.id && item.door.direction !== direction) ?? null
}

/** Enter a child canvas only from its entry door. */
export function enterPortal(
  topology: PortalTopology,
  current: PortalNavigationSnapshot,
  doorNodeId: string,
  parentViewport?: Viewport,
  parentFocusNodeId?: string
): PortalNavigationResult {
  const refusal = validatePortalTopology(topology)
  if (refusal) return { ok: false, reason: refusal }
  const source = topology.nodes.find((node) => node.id === doorNodeId)
  if (!source?.portal) return { ok: false, reason: 'unknown-door' }
  if (nodeCanvas(source) !== current.currentCanvasId) return { ok: false, reason: 'unknown-door' }
  if (source.portal.direction !== 'entry') return { ok: false, reason: 'wrong-door-direction' }
  const target = topology.canvases.find((canvas) => canvas.id === source.portal!.targetCanvasId)
  const back = matchingDoor(topology, doorNodeId, 'entry')
  if (!target || !back || back.door.targetCanvasId !== current.currentCanvasId) return { ok: false, reason: 'unmatched-door-pair' }
  return {
    ok: true,
    snapshot: {
      currentCanvasId: target.id,
      parentCanvasId: current.currentCanvasId,
      entryDoorNodeId: source.id,
      returnDoorNodeId: back.node.id,
      ...(parentViewport ? { parentViewport } : {}),
      ...(parentFocusNodeId ? { parentFocusNodeId } : {}),
      trail: [
        ...(current.trail ?? []),
        {
          canvasId: current.currentCanvasId,
          entryDoorNodeId: source.id,
          returnDoorNodeId: back.node.id,
          ...(parentViewport ? { viewport: parentViewport } : {}),
          ...(parentFocusNodeId ? { focusNodeId: parentFocusNodeId } : {})
        }
      ]
    }
  }
}

/** Exit a child canvas only from its matching return door. */
export function exitPortal(
  topology: PortalTopology,
  current: PortalNavigationSnapshot,
  doorNodeId: string
): PortalNavigationResult {
  const refusal = validatePortalTopology(topology)
  if (refusal) return { ok: false, reason: refusal }
  if (!current.parentCanvasId) return { ok: false, reason: 'not-at-child' }
  const source = topology.nodes.find((node) => node.id === doorNodeId)
  if (!source?.portal || nodeCanvas(source) !== current.currentCanvasId) return { ok: false, reason: 'unknown-door' }
  if (source.portal.direction !== 'return') return { ok: false, reason: 'wrong-door-direction' }
  const entry = matchingDoor(topology, doorNodeId, 'return')
  if (!entry || entry.door.targetCanvasId !== current.currentCanvasId || source.portal.targetCanvasId !== current.parentCanvasId) return { ok: false, reason: 'unmatched-door-pair' }
  const trail = current.trail ?? []
  const frame = trail.at(-1)
  const remaining = trail.slice(0, -1)
  const parentFrame = remaining.at(-1)
  const nextCanvasId = frame?.canvasId ?? current.parentCanvasId
  if (!nextCanvasId) return { ok: false, reason: 'not-at-child' }
  return {
    ok: true,
    snapshot: {
      currentCanvasId: nextCanvasId,
      ...(parentFrame ? { parentCanvasId: parentFrame.canvasId, entryDoorNodeId: parentFrame.entryDoorNodeId, returnDoorNodeId: parentFrame.returnDoorNodeId } : {}),
      ...(frame?.viewport ? { parentViewport: frame.viewport } : current.parentViewport ? { parentViewport: current.parentViewport } : {}),
      ...(frame?.focusNodeId ? { parentFocusNodeId: frame.focusNodeId } : current.parentFocusNodeId ? { parentFocusNodeId: current.parentFocusNodeId } : {}),
      ...(remaining.length ? { trail: remaining } : {})
    }
  }
}

/** Direct tab/back/generic selection is intentionally never an alternate route. */
export function refuseDirectCanvasSelection(): PortalNavigationResult {
  return { ok: false, reason: 'direct-canvas-selection-refused' }
}

/** Relaunch always starts at root. A child can be reached again only by activating its door. */
export function normalizePortalNavigationOnRelaunch(rootCanvasId = ROOT_ID): PortalNavigationSnapshot {
  return { currentCanvasId: rootCanvasId }
}

/** Restore the parent camera and focus captured before entry, without reopening the child. */
export function parentRestore(snapshot: PortalNavigationSnapshot): { viewport?: Viewport; focusNodeId?: string } {
  return { ...(snapshot.parentViewport ? { viewport: snapshot.parentViewport } : {}), ...(snapshot.parentFocusNodeId ? { focusNodeId: snapshot.parentFocusNodeId } : {}) }
}
