// The canvas mutation vocabulary — ONE implementation, imported by every surface:
// the relay host (src/main/remote), the renderer (Canvas), and the canvas-sync reflector
// (src/core). Pure: no electron, no sockets, no disk.

import { acceptNewInboundNode, carryLocalNodeExec, sanitizeInboundNode } from './node-exec'
import { REF_MAX_LEN } from './presence'
import { canCreateInUniverse, isAwsShopNode, isNonDeletableCanvasNode } from './aws-shop'
import { canCreateAwsCatalogEntry } from './aws-catalog'
import type { BridgeLink, CanvasEdgeKind, CanvasMutation, CanvasNodeState, Link } from './types'

/**
 * A canvas as the publisher sees it: the nodes React Flow manages, plus the two PERSISTED edge
 * lists (`bridges` = context links, `ropes` = display-only "spawned by" lineage).
 *
 * The edges are in here for one reason, and it is a data-loss reason rather than a cosmetic one.
 * They ride the same whole-file `workspace.save` as the nodes but were NOT in the mutation
 * vocabulary, so an edge you drew never reached your teammate — and their next save, of a canvas
 * that never had it, DELETED it. (Same in reverse.) Syncing them is what makes the file the two
 * clients converge on the file they both agree with.
 */
export interface CanvasScene {
  nodes: CanvasNodeState[]
  bridges: BridgeLink[]
  ropes: BridgeLink[]
  links?: Link[]
}

/** A bare node array read as a scene with no edges — the shape every pre-edge caller passes. */
export function asScene(s: CanvasScene | CanvasNodeState[]): CanvasScene {
  return Array.isArray(s) ? { nodes: s, bridges: [], ropes: [], links: [] } : { ...s, links: s.links ?? [] }
}

/** Does this mutation address an edge (rather than a node)? */
export function isEdgeMutation(
  m: CanvasMutation
): m is Extract<CanvasMutation, { op: 'edge-upsert' | 'edge-remove' }> {
  return m.op === 'edge-upsert' || m.op === 'edge-remove'
}

export function isLinkMutation(
  m: CanvasMutation
): m is Extract<CanvasMutation, { op: 'link-upsert' | 'link-remove' }> {
  return m.op === 'link-upsert' || m.op === 'link-remove'
}

function isEdgeKind(value: unknown): value is CanvasEdgeKind {
  return value === 'bridge' || value === 'rope'
}

/**
 * Ceiling on one mutation's serialized size. A node carries free text (a sticky's body, an
 * editor's path), and the whole object is reflected verbatim to every peer — so an unbounded one
 * is an N-way amplifier straight into everyone's WS send buffer (the same sink pty output rides).
 * 256 KB is orders of magnitude past any real node and cannot refuse a legitimate edit.
 */
export const MUTATION_MAX_BYTES = 256_000

/** An id off the wire: non-empty and bounded by the shared ref cap (node ids and project ids are
 *  short and generated — `term-ab12`, `project-1` — so this can never refuse a real one). Ids are
 *  REJECTED, never truncated: a truncated id would address the WRONG node on every peer. */
export function isRefId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= REF_MAX_LEN
}

/**
 * Shape + size guard: a client cast is untrusted input, and it is reflected to every peer as-is.
 * A malformed payload would wedge a peer's React Flow (applyCanvasMutation would upsert a node with
 * no id, or a NaN position, which React Flow cannot lay out); an oversized one would flood their
 * sockets.
 *
 * IT LIVES IN `shared`, NOT IN THE REFLECTOR, because BOTH ends need the same verdict. The reflector
 * drops what it refuses — silently, with no negative ack — so a publisher that cast it anyway would
 * advance its baseline (never retrying) and record a pending entry (deafening that node to its peers
 * for the whole pending TTL: a peer's `remove` landing in that window would be dropped, and the next
 * whole-file save would resurrect the node they deleted). The publisher therefore asks THIS function
 * first and, on a refusal, casts nothing, records nothing, and keeps the node in its baseline so the
 * next edit retries it. One predicate, one verdict, both ends.
 */
export function isCanvasMutation(value: unknown): value is CanvasMutation {
  if (!value || typeof value !== 'object') return false
  const m = value as { op?: unknown; id?: unknown; node?: unknown; kind?: unknown; edge?: unknown }
  if (m.op === 'remove') return isRefId(m.id)
  if (m.op === 'link-remove') return isRefId(m.id)
  if (m.op === 'link-upsert') {
    const link = (value as { link?: unknown }).link
    if (!link || typeof link !== 'object') return false
    const raw = link as { id?: unknown; kind?: unknown; source?: unknown; target?: unknown }
    if (!isRefId(raw.id) || !['context', 'lineage', 'dependency'].includes(String(raw.kind))) return false
    const endpoint = (candidate: unknown): boolean => {
      if (!candidate || typeof candidate !== 'object') return false
      const ep = candidate as Record<string, unknown>
      if (ep.ref === 'node') return isRefId(ep.nodeId)
      if (ep.ref === 'xnode') return isRefId(ep.projectId) && isRefId(ep.nodeId)
      if (ep.ref === 'branch') return isRefId(ep.repoPath) && isRefId(ep.branch)
      return false
    }
    return endpoint(raw.source) && endpoint(raw.target) && withinSizeLimit(value)
  }
  if (m.op === 'edge-remove') return isEdgeKind(m.kind) && isRefId(m.id)
  if (m.op === 'edge-upsert') {
    if (!isEdgeKind(m.kind)) return false
    const edge = m.edge as { id?: unknown; source?: unknown; target?: unknown } | undefined
    if (!edge || typeof edge !== 'object') return false
    // All three ids are ADDRESSES — an edge with a truncated endpoint would attach to the wrong
    // node on every peer — so they are rejected rather than capped, exactly like a node id.
    if (!isRefId(edge.id) || !isRefId(edge.source) || !isRefId(edge.target)) return false
    return withinSizeLimit(m)
  }
  if (m.op !== 'upsert') return false
  const node = m.node as { id?: unknown; creationEventId?: unknown; position?: { x?: unknown; y?: unknown } } | undefined
  if (!node || typeof node !== 'object') return false
  // The Shop is created from the universe canvas, never by peer traffic. Rejecting it at the
  // shared wire predicate keeps the reflector and every receiver from learning a mutable copy.
  if ((node as { kind?: unknown }).kind === 'aws-shop') return false
  if (!isRefId(node.id)) return false
  if ('creationEventId' in node && node.creationEventId !== undefined && !isRefId(node.creationEventId)) return false
  const pos = node.position
  if (!pos || typeof pos !== 'object') return false
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false
  return withinSizeLimit(m)
}

function withinSizeLimit(m: unknown): boolean {
  try {
    // The wire form is JSON on the server and a structured clone on the desktop; either way this
    // is a faithful measure of what would be pushed to every peer. A value that cannot even be
    // stringified (BigInt, a cycle) is not something we should be reflecting.
    return JSON.stringify(m).length <= MUTATION_MAX_BYTES
  } catch {
    return false
  }
}

function isDeterministicShopId(node: CanvasNodeState): boolean {
  if (typeof node.universeCanvasId !== 'string') return false
  const base = `shop-${node.universeCanvasId}`
  if (node.id === base) return true
  const suffix = node.id.startsWith(`${base}-`) ? node.id.slice(base.length + 1) : ''
  return suffix.length === 8 && [...suffix].every((char) => '0123456789abcdefABCDEF'.includes(char))
}

/**
 * Same top-level VALUE? A shallow compare, deliberately: it never reads the CONTENT of a string
 * field, which is the whole point (the free text is what makes an oversized node expensive).
 *
 * Sound because of how the snapshot is built: `flowToNodeStates` rebuilds the node object on every
 * publish but passes each field through BY REFERENCE (`text: n.data.text`, `tags: n.data.tags`, …),
 * so an untouched field is the SAME reference and `Object.is` settles it in O(1). `position` and
 * `size` are freshly built objects of numbers, so they are compared field-wise.
 *
 * Conservative in the only direction that matters: equal references ⇒ equal content, so it can never
 * report "unchanged" for a node that changed (which would strand an edit). The reverse (an equal
 * value rebuilt as a new reference) merely costs one honest re-validation — what happens today.
 */
function sameNodeValue(a: CanvasNodeState, b: CanvasNodeState): boolean {
  if (a === b) return true
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  const ra = a as unknown as Record<string, unknown>
  const rb = b as unknown as Record<string, unknown>
  for (const k of ka) {
    const va = ra[k]
    const vb = rb[k]
    if (Object.is(va, vb)) continue
    if (k !== 'position' && k !== 'size') return false
    // The two geometry objects: plain records of numbers, rebuilt on every snapshot.
    const oa = va as Record<string, number> | undefined
    const ob = vb as Record<string, number> | undefined
    if (!oa || !ob) return false
    const gk = Object.keys(oa)
    if (gk.length !== Object.keys(ob).length) return false
    for (const g of gk) if (!Object.is(oa[g], ob[g])) return false
  }
  return true
}

/**
 * The PUBLISHER's guard: `isCanvasMutation`'s verdict, with a refusal REMEMBERED per node.
 *
 * `isCanvasMutation` answers the size question by serializing the whole node, and a refused node is
 * deliberately re-emitted on every publish (that is what makes the sticky sync the instant the user
 * trims it — see `rebaseRefused` in canvas-publish). A drag publishes at ~20 Hz. So the ONE node that
 * is already pathological — a sticky someone pasted a document into — was being stringified 20 times
 * a second, at a cost proportional to its size, for as long as it stayed oversized. The pathological
 * case must not also be the expensive one.
 *
 * The memo holds the refused node itself and re-checks only when that node's value actually changes
 * (`sameNodeValue`: reference-shallow, so it never touches the big string). Behaviour is unchanged:
 * the same verdict for every input, the refusal is re-paid the moment the node is edited, and the
 * trimmed sticky casts immediately (its entry is dropped as soon as it passes). Bounded by the number
 * of oversized nodes on the canvas — in practice zero or one, and their memory is the node the canvas
 * already holds.
 *
 * The REFLECTOR keeps calling the plain `isCanvasMutation`: its input is untrusted, freshly decoded
 * off the wire for every client, so nothing there would ever hit a memo and the map would grow with
 * whatever ids a client cared to invent. One predicate, one verdict, both ends — this only caches the
 * one end that asks the same question about the same node over and over.
 */
export function createMutationGuard(): (m: CanvasMutation) => boolean {
  const refused = new Map<string, CanvasNodeState>()
  return (m) => {
    // A `remove` and both edge ops are a couple of dozen bytes (ids only): nothing to amortize,
    // and nothing that can grow. Only a node `upsert` carries free text.
    if (!m || typeof m !== 'object' || (m as { op?: unknown }).op !== 'upsert')
      return isCanvasMutation(m)
    const node = (m as { node?: CanvasNodeState }).node
    if (!node || typeof node !== 'object' || typeof node.id !== 'string') return isCanvasMutation(m)

    const last = refused.get(node.id)
    if (last && sameNodeValue(last, node)) return false // already refused, and nothing has changed

    const ok = isCanvasMutation(m)
    if (ok) refused.delete(node.id)
    else refused.set(node.id, node)
    return ok
  }
}

/**
 * Apply a single mutation to a node list, returning a NEW array (the input is never mutated).
 * `upsert` replaces the node with the matching id, or appends it if absent; `remove` filters
 * out the node with the given id.
 *
 * Every caller of this is applying a mutation that came from SOMEONE ELSE (a canvas-sync peer, a
 * relay client), so the node goes through `sanitizeInboundNode` first: the exec-enabling fields
 * (`shell`, `terminalProfileId`, `ssh.extraArgs`) are per-machine settings that nobody else gets
 * to write, and letting them into the live node array is how a peer laundered them into the
 * machine-local — "trusted" — workspace.json on the next save (@shared/node-exec). A genuinely
 * new node may receive the accepting Windows host's default through the optional argument; that
 * value comes from the host, never the mutation.
 */
export function applyCanvasMutation(
  states: CanvasNodeState[],
  m: CanvasMutation,
  options?: { defaultTerminalProfileId?: string; universeScope?: import('./aws-shop').UniverseCanvasScope; universeId?: string }
): CanvasNodeState[] {
  // An edge mutation addresses neither of these nodes. Returned UNCHANGED (by reference, so a
  // caller's `next === prev` short-circuit still fires) rather than trusted to be pre-filtered:
  // every caller here is applying something that came off the wire, and a silent no-op is the only
  // safe reading of "this list is not what that mutation is about".
  if (isEdgeMutation(m)) return states
  if (isLinkMutation(m)) return states
  if (m.op === 'remove') {
    // A peer may remove ordinary nodes, but the deterministic Shop belongs to its universe and
    // must survive every mirrored remove. Import/hydration repair remains the recovery path when a
    // malformed peer snapshot omitted it.
    if (states.some((n) => n.id === m.id && n.kind === 'shop')) return states
    return states.filter((n) => n.id !== m.id)
  }
  if (m.node.kind === 'shop') {
    // A repeated peer upsert must not move or rewrite an existing Shop. A genuinely missing Shop
    // can enter once, after which the deterministic universe coordinator repairs its ownership and
    // top-level placement. This keeps peer delivery idempotent without granting peer mutations the
    // ability to delete, duplicate, group, or move the catalog anchor.
    if (states.some((n) => n.id === m.node.id)) return states
    const accepted = acceptNewInboundNode(m.node, options?.defaultTerminalProfileId)
    return [...states, { ...accepted, title: 'Shop', group: null, nonDeletable: true }]
  }
  // One immutable creation event may be retried by a peer or IPC transport. The first node wins,
  // even if a buggy retry arrives with a different node id, so a repeated event cannot duplicate
  // an ordinary catalog result either.
  if (m.node.creationEventId && states.some((n) => n.creationEventId === m.node.creationEventId)) return states
  const idx = states.findIndex((n) => n.id === m.node.id)
  if (idx === -1)
    return [...states, acceptNewInboundNode(m.node, options?.defaultTerminalProfileId)]
  const node = sanitizeInboundNode(m.node)
  const next = states.slice()
  // …and OUR exec fields stay on the node the upsert replaces: they are per-machine, so a peer
  // dragging our ssh terminal must not hand it back stripped of the jump host we configured.
  next[idx] = carryLocalNodeExec(states[idx], node)
  return next
}

/**
 * Apply one EDGE mutation to one of a project's edge lists, returning a NEW array (the input is
 * never mutated). Edge ids share one key space across both kinds (`mutationKey` deliberately omits
 * `kind`), so a winning upsert also evicts the same id from the other list and a winning remove
 * clears it from either list. Without that cross-kind eviction, bridge `x` followed by rope `x`
 * was retained twice even though ordering had resolved it as one entity. A node mutation leaves
 * the list untouched by reference, as does an unrelated edge whose id is absent.
 *
 * There is nothing to sanitize here the way `sanitizeInboundNode` sanitizes a node: an edge is
 * three ids and carries no exec-enabling field, and `isCanvasMutation` has already bounded all
 * three. What it CAN carry is a dangling endpoint (the peer deleted that node a moment ago) —
 * deliberately not filtered here, because this function does not know the node list. Canvas's
 * existing prune effects drop a dangling edge on the next node change, which is the same treatment
 * a locally-drawn edge gets.
 */
export function applyEdgeMutation(
  edges: BridgeLink[],
  kind: CanvasEdgeKind,
  m: CanvasMutation
): BridgeLink[] {
  if (!isEdgeMutation(m)) return edges
  if (m.op === 'edge-remove') {
    const next = edges.filter((e) => e.id !== m.id)
    return next.length === edges.length ? edges : next
  }
  if (m.kind !== kind) {
    const next = edges.filter((e) => e.id !== m.edge.id)
    return next.length === edges.length ? edges : next
  }
  const edge: BridgeLink = { id: m.edge.id, source: m.edge.source, target: m.edge.target }
  const idx = edges.findIndex((e) => e.id === edge.id)
  if (idx === -1) return [...edges, edge]
  const next = edges.slice()
  next[idx] = edge
  return next
}

/** Apply one typed link mutation to a project's relationship list. */
export function applyLinkMutation(links: Link[], m: CanvasMutation): Link[] {
  if (!isLinkMutation(m)) return links
  if (m.op === 'link-remove') {
    const next = links.filter((link) => link.id !== m.id)
    return next.length === links.length ? links : next
  }
  const nextLink: Link = {
    id: m.link.id,
    kind: m.link.kind,
    source: m.link.source,
    target: m.link.target,
    ...(m.link.meta ? { meta: { ...m.link.meta } } : {})
  }
  const index = links.findIndex((link) => link.id === nextLink.id)
  if (index < 0) return [...links, nextLink]
  const next = links.slice()
  next[index] = nextLink
  return next
}

/** Stable JSON stringify (keys sorted) so deep-equality is order-independent. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k]
      }
      return sorted
    }
    return val
  })
}

/** The edge half of `diffToMutations`, for one kind. Same shape: changed/added → upsert (in
 *  next-array order), dropped → remove (in prev-array order). An edge is three short ids, so the
 *  compare is a plain field compare rather than a stringify. */
function diffEdges(
  prev: BridgeLink[],
  next: BridgeLink[],
  allNextIds: ReadonlySet<string>,
  kind: CanvasEdgeKind,
  upserts: CanvasMutation[],
  removes: CanvasMutation[]
): void {
  const prevById = new Map(prev.map((e) => [e.id, e]))
  for (const edge of next) {
    const before = prevById.get(edge.id)
    if (!before || before.source !== edge.source || before.target !== edge.target) {
      upserts.push({ op: 'edge-upsert', kind, edge })
    }
  }
  for (const edge of prev) {
    // Moving one id from bridge to rope (or back) is ONE upsert in the shared edge key space, not
    // an upsert followed by a later remove that would win the total order and erase the move.
    if (!allNextIds.has(edge.id)) removes.push({ op: 'edge-remove', kind, id: edge.id })
  }
}

function diffLinks(
  previous: readonly Link[],
  next: readonly Link[],
  upserts: CanvasMutation[],
  removes: CanvasMutation[]
): void {
  const before = new Map(previous.map((link) => [link.id, JSON.stringify(link)]))
  const ids = new Set(next.map((link) => link.id))
  for (const link of next) if (before.get(link.id) !== JSON.stringify(link)) upserts.push({ op: 'link-upsert', link })
  for (const link of previous) if (!ids.has(link.id)) removes.push({ op: 'link-remove', id: link.id })
}

/**
 * Diff two canvas snapshots into the minimal mutation list (deterministic): an `upsert` for every
 * node that was added or changed (deep-equal via stable stringify), a `remove` for every node that
 * was dropped, and the same for both edge lists. Never throws on normal input.
 *
 * A bare node array is accepted as a scene with no edges, so every caller that predates edge sync
 * keeps its exact behaviour.
 *
 * THE ORDER OF THE BATCH IS LOAD-BEARING: additions before removals, and within each half nodes
 * before edges. A peer applies these one at a time, so an `edge-upsert` naming a node that has not
 * arrived yet would draw an edge into nothing (React Flow drops it and warns) — and an
 * `edge-remove` for an edge whose node is removed in the SAME batch has to land while the edge is
 * still there. Adds: nodes, then edges. Removes: edges, then nodes.
 */
export function diffToMutations(
  prev: CanvasScene | CanvasNodeState[],
  next: CanvasScene | CanvasNodeState[]
): CanvasMutation[] {
  const a = asScene(prev)
  const b = asScene(next)
  const upserts: CanvasMutation[] = []
  const removes: CanvasMutation[] = []
  const prevById = new Map(a.nodes.map((node) => [node.id, node]))
  const nextIds = new Set(b.nodes.map((node) => node.id))

  // upserts: added or changed nodes (in next-array order for determinism).
  for (const node of b.nodes) {
    const before = prevById.get(node.id)
    if (!before || stableStringify(before) !== stableStringify(node)) {
      upserts.push({ op: 'upsert', node })
    }
  }
  // removes: nodes present in prev but gone from next (in prev-array order).
  for (const node of a.nodes) {
    if (!nextIds.has(node.id) && !isNonDeletableCanvasNode(node)) removes.push({ op: 'remove', id: node.id })
  }

  const edgeUpserts: CanvasMutation[] = []
  const edgeRemoves: CanvasMutation[] = []
  const allNextEdgeIds = new Set([...b.bridges, ...b.ropes].map((edge) => edge.id))
  diffEdges(a.bridges, b.bridges, allNextEdgeIds, 'bridge', edgeUpserts, edgeRemoves)
  diffEdges(a.ropes, b.ropes, allNextEdgeIds, 'rope', edgeUpserts, edgeRemoves)

  const linkUpserts: CanvasMutation[] = []
  const linkRemoves: CanvasMutation[] = []
  diffLinks(a.links ?? [], b.links ?? [], linkUpserts, linkRemoves)
  return [...upserts, ...edgeUpserts, ...linkUpserts, ...linkRemoves, ...edgeRemoves, ...removes]
}
