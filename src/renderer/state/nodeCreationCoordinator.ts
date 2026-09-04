import type { NodeCatalogEntry } from '@shared/node-catalog'
import { newCreationEventId } from '@shared/node-catalog'
import type { CanvasNode, NodeData } from './workspace'

export interface NodeCreationRequest {
  entry: NodeCatalogEntry
  /** One id is reused for an IPC retry or a double-click, never minted per retry. */
  creationEventId?: string
  center?: { x: number; y: number }
  groupId?: string
}

export interface NodeCreationResult {
  node: CanvasNode | null
  creationEventId: string
  duplicate: boolean
  error?: string
}

export type CatalogNodeFactory = (
  entry: NodeCatalogEntry,
  index: number,
  center: { x: number; y: number }
) => CanvasNode | null

const GAP = 24
const STEP = 56
const MAX_SEARCH = 512

function nodeBox(node: CanvasNode, position = node.position) {
  return {
    left: position.x,
    top: position.y,
    right: position.x + (node.width ?? node.measured?.width ?? 640),
    bottom: position.y + (node.height ?? node.measured?.height ?? 440)
  }
}

function overlaps(a: ReturnType<typeof nodeBox>, b: ReturnType<typeof nodeBox>): boolean {
  return a.left < b.right + GAP && a.right + GAP > b.left && a.top < b.bottom + GAP && a.bottom + GAP > b.top
}

/** Find a free position using a deterministic square spiral around the requested placement. */
export function collisionFreePosition(
  nodes: readonly CanvasNode[],
  node: CanvasNode,
  requested: { x: number; y: number }
): { x: number; y: number } | null {
  const occupied = nodes.map((existing) => nodeBox(existing))
  const width = node.width ?? node.measured?.width ?? 640
  const height = node.height ?? node.measured?.height ?? 440
  const fits = (position: { x: number; y: number }) =>
    !occupied.some((box) => overlaps({ ...nodeBox(node, position), right: position.x + width, bottom: position.y + height }, box))
  if (fits(requested)) return requested

  let ring = 1
  let attempts = 0
  while (attempts < MAX_SEARCH) {
    const span = ring * 2
    for (let y = -ring; y <= ring; y++) {
      for (let x = -ring; x <= ring; x++) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== ring) continue
        attempts++
        const candidate = { x: requested.x + x * (width + STEP), y: requested.y + y * (height + STEP) }
        if (fits(candidate)) return candidate
      }
    }
    ring++
    // Keep the variable meaningful for readers and avoid an accidental infinite loop if the
    // spiral arithmetic changes in a future edit.
    if (span <= 0) break
  }
  return null
}

/** Add the immutable event id without changing the factory's kind-specific data. */
export function stampCreationEvent(node: CanvasNode, creationEventId: string): CanvasNode {
  return {
    ...node,
    data: { ...node.data, creationEventId } satisfies NodeData
  }
}

/**
 * Coordinates every catalog entry, including retries from automation or peer insertion. It owns
 * the idempotency ledger and placement policy, while the caller supplies the actual kind factory
 * and any project-specific parent conversion. This keeps the registry typed and the renderer
 * factories independent from the server and portable projection.
 */
const MAX_CREATION_EVENT_ID = 200

function isValidCreationEventId(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_CREATION_EVENT_ID &&
    ![...value].some((char) => (char.codePointAt(0) ?? 0) <= 0x1f)
}

export class NodeCreationCoordinator {
  private readonly consumed = new Map<string, string>()

  create(
    request: NodeCreationRequest,
    existing: readonly CanvasNode[],
    factory: CatalogNodeFactory,
    parentInto?: (node: CanvasNode, groupId: string) => CanvasNode
  ): NodeCreationResult {
    // A caller-supplied retry id is persisted into project.json and kept in the ledger for the
    // life of the session, so it is bounded here rather than after it has already been stamped.
    if (request.creationEventId !== undefined && !isValidCreationEventId(request.creationEventId)) {
      return { node: null, creationEventId: newCreationEventId(), duplicate: false, error: 'The supplied creation event id is invalid.' }
    }
    const creationEventId = request.creationEventId ?? newCreationEventId()
    const knownNodeId = this.consumed.get(creationEventId)
    const knownNode = existing.find((node) => node.id === knownNodeId || node.data.creationEventId === creationEventId)
    // React may evaluate a state updater more than once in development. A ledger-only hit with no
    // node in the updater's input would discard the second evaluation and could lose the append.
    // The durable node id is the authority here; once the append commits, the next invocation sees
    // it in `existing` and becomes a true duplicate no-op.
    if (knownNode) {
      return { node: knownNode ?? null, creationEventId, duplicate: true }
    }

    const center = request.center ?? { x: 120, y: 120 }
    const created = factory(request.entry, existing.length, center)
    if (!created) return { node: null, creationEventId, duplicate: false }

    const requestedPosition = created.position
    // React Flow stores child positions relative to their parent frame. Comparing a child with
    // its enclosing frame, or with a node in a different frame, would always report a collision
    // and eject the new node from the group. Only siblings in the same coordinate space count.
    const collisionPeers = request.groupId
      ? existing.filter((node) => node.parentId === request.groupId)
      : existing.filter((node) => !node.parentId)
    const position = collisionFreePosition(collisionPeers, created, requestedPosition)
    if (!position) {
      return {
        node: null,
        creationEventId,
        duplicate: false,
        error: 'No free canvas position was found within the bounded placement search.'
      }
    }
    const positioned = {
      ...created,
      position,
      data: { ...created.data, creationEventId }
    }
    const node = request.groupId && parentInto ? parentInto(positioned, request.groupId) : positioned
    this.consumed.set(creationEventId, node.id)
    return { node, creationEventId, duplicate: false }
  }

  /** Pure append boundary used by every renderer creation path. The result makes the persistence
   * decision explicit: callers mark dirty only when `result.duplicate` is false and `node` exists.
   */
  append(
    existing: readonly CanvasNode[],
    request: NodeCreationRequest,
    factory: CatalogNodeFactory,
    parentInto?: (node: CanvasNode, groupId: string) => CanvasNode
  ): { nodes: CanvasNode[]; result: NodeCreationResult } {
    const result = this.create(request, existing, factory, parentInto)
    return {
      result,
      nodes: result.node && !result.duplicate ? [...existing, result.node] : [...existing]
    }
  }

  /**
   * Append an already-built node from a shortcut, drop, board, SCM, login, automation, or peer
   * path. The source node's event id is intentionally ignored: these paths represent a new event
   * unless the caller supplies an explicit retry id. This prevents duplicateNode or a copied
   * inbound payload from inheriting the source event.
   */
  appendNode(
    existing: readonly CanvasNode[],
    node: CanvasNode,
    creationEventId?: string,
    options?: { prepend?: boolean }
  ): { nodes: CanvasNode[]; result: NodeCreationResult } {
    const eventId = creationEventId ?? newCreationEventId()
    const duplicate = existing.find((candidate) => candidate.data.creationEventId === eventId)
    if (duplicate) {
      return { nodes: [...existing], result: { node: duplicate, creationEventId: eventId, duplicate: true } }
    }
    const collisionPeers = node.parentId
      ? existing.filter((candidate) => candidate.parentId === node.parentId)
      : existing.filter((candidate) => !candidate.parentId)
    const position = collisionFreePosition(collisionPeers, node, node.position)
    if (!position) {
      return {
        nodes: [...existing],
        result: {
          node: null,
          creationEventId: eventId,
          duplicate: false,
          error: 'No free canvas position was found within the bounded placement search.'
        }
      }
    }
    const fresh = { ...node, position, data: { ...node.data, creationEventId } }
    this.consumed.set(eventId, fresh.id)
    const nodes = options?.prepend ? [fresh, ...existing] : [...existing, fresh]
    return { nodes, result: { node: fresh, creationEventId: eventId, duplicate: false } }
  }

  /** Stamp nodes assembled by a higher-level operation such as grouping or undoable board work.
   * Existing ids are preserved, while every genuinely new node receives a fresh event id. */
  stampNewNodes(nodes: readonly CanvasNode[], prior: readonly CanvasNode[]): CanvasNode[] {
    const priorIds = new Set(prior.map((node) => node.id))
    return nodes.map((node) => {
      if (priorIds.has(node.id) || node.data.creationEventId) return node
      const creationEventId = newCreationEventId()
      this.consumed.set(creationEventId, node.id)
      return { ...node, data: { ...node.data, creationEventId } }
    })
  }

  /** Useful when hydrating a persisted canvas: hydration records are never new events. */
  remember(nodes: readonly CanvasNode[]): void {
    for (const node of nodes) {
      if (node.data.creationEventId) this.consumed.set(node.data.creationEventId, node.id)
    }
  }

  clear(): void {
    this.consumed.clear()
  }
}
