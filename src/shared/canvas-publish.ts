// Canvas sync — the emitting side.
//
// The renderer holds its nodes in React Flow (the single live source of truth). This publisher turns
// successive serialized snapshots of that list into the minimal CanvasMutation stream for the peers:
//
//   publish(states)                  → diff vs the last published snapshot, send each mutation
//   publish(states, {throttle:true}) → a drag frame: at most one send per PUBLISH_INTERVAL_MS
//   adopt(states)                    → LOOP GUARD: take the snapshot as baseline, send NOTHING
//
// Snapshots, NOT React Flow change-lists: a rename, a color pick, a collapse and an add all reach the
// nodes array through direct setNodes(...) calls that never pass through onNodesChange, so a
// change-list-driven publisher would silently fail to sync half the edits. Diffing the serialized
// snapshot catches every one of them, whatever path produced it.
//
// `adopt` is what stops an infinite echo: when a mutation arrives FROM a peer, Canvas applies it and
// adopts the result, so the React effect that fires for the resulting `nodes` change diffs to nothing.
// (Same shape as the existing `loadingRef` suppression that keeps a programmatic project load from
// marking the project dirty.) Without it, A's mutation applied on B would be re-published by B to C
// (and back at A) forever. The other half of the anti-loop is canvas-order, which never *applies* a
// client's own echoed-back mutation in the first place.
//
// Pure + DOM-free (vitest runs in the node environment): only setTimeout, no React, no window.

import { stripSharedNodeExec } from './node-exec'
import { asScene, diffToMutations, type CanvasScene } from './canvas-mutations'
import { mutationKey } from './canvas-order'
import type { BridgeLink, CanvasMutation, CanvasNodeState, Link } from './types'

/** ~20 Hz while dragging — the same budget the presence cursor stream uses. */
export const PUBLISH_INTERVAL_MS = 50

/**
 * A snapshot, or a thunk that produces one.
 *
 * The thunk is what makes the solo gate below actually free. Serializing the canvas is the
 * expensive half of publishing (`flowToNodeStates` + `stableStringify` per node), and the caller
 * runs inside a React effect keyed on the nodes array — i.e. once per DRAG FRAME. Passing an array
 * meant that cost was paid before the publisher could decide it had nothing to do with it; passing
 * a thunk lets it be paid only when a snapshot is actually going to be diffed or sent.
 *
 * A thunk MUST be pure and must close over the state as of the call (React Flow hands us a fresh
 * immutable array per change, so `() => serialize(nodes)` satisfies this): the publisher may
 * resolve it later — at the trailing edge of a throttle window, or when the first peer arrives.
 */
export type CanvasSnapshot =
  | CanvasScene
  | CanvasNodeState[]
  | (() => CanvasScene | CanvasNodeState[])

export interface CanvasPublisher {
  /** Diff `next` against the last published snapshot and send the mutations.
   *  `throttle` (drag frames) coalesces to at most one send per PUBLISH_INTERVAL_MS.
   *  With no peer attached (`shouldPublish` false) this DEGRADES TO adopt(): the snapshot becomes
   *  the baseline and nothing is diffed or sent — a solo user pays nothing for team sync. */
  publish(next: CanvasSnapshot, opts?: { throttle?: boolean }): void
  /** Take `next` as the new baseline WITHOUT sending — the loop guard (a peer's mutation, or a
   *  programmatic project load). The next diff against it is empty. */
  adopt(next: CanvasSnapshot): void
  /** Send any coalesced drag frame immediately (drag settle / unmount). */
  flush(): void
  dispose(): void
}

/**
 * The baseline after a cast was REFUSED (`send` returned false: an oversized sticky the reflector
 * would drop at ingest, or no active project to cast into). The refused nodes keep their PREVIOUS
 * baseline entry — as if the edit had never been published — so the very next diff emits them again
 * and the edit syncs the moment it becomes castable (the user trims the sticky, a project opens).
 * Advancing the baseline over them, which is what the publisher used to do, meant the edit was
 * dropped SILENTLY AND FOREVER: the peers never saw it and nothing ever retried it.
 *
 * Per NODE, not per snapshot: everything else in the same snapshot was cast and must not be re-sent.
 * A refused node that had no previous entry is simply left OUT of the baseline (so it re-diffs as an
 * add); a refused `remove` keeps its node in the baseline (so the remove is re-emitted).
 */
function rebaseList<T extends { id: string }>(
  prev: T[],
  next: T[],
  refused: Set<string>,
  prefix: string
): T[] {
  const prevById = new Map(prev.map((n) => [n.id, n]))
  const nextIds = new Set(next.map((n) => n.id))
  const out: T[] = []
  for (const n of next) {
    if (!refused.has(prefix + n.id)) {
      out.push(n)
      continue
    }
    const before = prevById.get(n.id)
    if (before) out.push(before)
  }
  for (const n of prev) {
    if (refused.has(prefix + n.id) && !nextIds.has(n.id)) out.push(n) // a refused remove: still owed
  }
  return out
}

/** The refusal rebase, over the whole scene. `refused` holds `mutationKey`s, so the two edge lists
 *  share the `e:` prefix — an edge id is one edge whichever list it is in (see mutationKey). */
function rebaseRefused(prev: CanvasScene, next: CanvasScene, refused: Set<string>): CanvasScene {
  return {
    nodes: rebaseList(prev.nodes, next.nodes, refused, 'n:'),
    bridges: rebaseList(prev.bridges, next.bridges, refused, 'e:'),
    ropes: rebaseList(prev.ropes, next.ropes, refused, 'e:'),
    links: rebaseList(prev.links ?? [], next.links ?? [], refused, 'l:')
  }
}

/** The empty baseline — a scene, so the first diff after mount is against a real shape. */
const EMPTY_SCENE: CanvasScene = { nodes: [], bridges: [], ropes: [], links: [] }

/**
 * @param send        casts one mutation (already stamped with `src`). Returning `false` means the
 *                    cast did NOT happen (refused / no project): the mutation is then owed — its
 *                    node keeps its old baseline entry and the next publish retries it. Any other
 *                    return value (including `undefined`) means it was cast.
 * @param opts.src    this client's publisher tag, stamped onto every mutation it sends, so it can
 *                    recognize its own echo coming back (see canvas-order). Omitted in tests that
 *                    only care about the diff.
 * @param opts.shouldPublish
 *   THE SOLO GATE. When it returns false — nobody else is attached — publish() takes the snapshot
 *   as the baseline and returns: no stableStringify of every node (~1.4 ms at 100 nodes, and the
 *   `nodes` array changes at 60 Hz during a drag), no IPC cast, no work in the main process. A solo
 *   user must not pay for a feature they cannot use. The baseline still tracks the canvas, so the
 *   instant a peer joins the very next edit diffs correctly against what is actually on screen —
 *   there is no resync step and no missed mutation. Default: always publish.
 *
 *   With a thunk snapshot the gate covers the SERIALIZATION too, which is where the cost actually
 *   was: a solo baseline is kept UNRESOLVED (just the thunk), and the first publish that has a peer
 *   resolves it to diff against. Same baseline, same mutations — the work is merely deferred to the
 *   moment something reads it, which for a solo user is never.
 */
export function createCanvasPublisher(
  send: (m: CanvasMutation) => void | boolean,
  opts: { intervalMs?: number; src?: string; shouldPublish?: () => boolean } = {}
): CanvasPublisher {
  const intervalMs = opts.intervalMs ?? PUBLISH_INTERVAL_MS
  const shouldPublish = opts.shouldPublish ?? (() => true)
  /** The baseline, held EITHER resolved (`last`) or unresolved (`lastLazy`) — never both. */
  let last: CanvasScene = EMPTY_SCENE
  let lastLazy: (() => CanvasScene) | null = null
  let pending: CanvasSnapshot | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const resolve = (s: CanvasSnapshot): CanvasScene =>
    asScene(typeof s === 'function' ? s() : s)

  /** The baseline to diff against, resolving a deferred one exactly once. */
  const baseline = (): CanvasScene => {
    if (lastLazy) {
      last = lastLazy()
      lastLazy = null
    }
    return last
  }

  /** Take a snapshot as the baseline. A thunk is stored unresolved — nothing has asked for it yet
   *  and, for a solo user, nothing ever will. */
  const setBaseline = (s: CanvasSnapshot): void => {
    if (typeof s === 'function') {
      lastLazy = () => asScene(s())
    } else {
      last = asScene(s)
      lastLazy = null
    }
  }

  const emit = (snapshot: CanvasSnapshot): void => {
    if (!shouldPublish()) {
      setBaseline(snapshot) // solo: adopt as baseline, diff nothing, send nothing
      return
    }
    const prev = baseline()
    const next = resolve(snapshot)
    const mutations = diffToMutations(prev, next)
    const refused = new Set<string>()
    for (const m of mutations) {
      if (send(opts.src ? { ...m, src: opts.src } : m) === false) refused.add(mutationKey(m))
    }
    last = refused.size ? rebaseRefused(prev, next, refused) : next
    lastLazy = null
  }

  const onTimer = (): void => {
    timer = null
    if (!pending) return
    const next = pending
    pending = null
    emit(next)
  }

  return {
    publish(next, o) {
      if (!shouldPublish()) {
        // Solo: not even a throttle timer. Just keep the baseline current for the peer who joins.
        if (timer) clearTimeout(timer)
        timer = null
        pending = null
        setBaseline(next)
        return
      }
      if (o?.throttle) {
        // Leading edge sends at once; further frames inside the window coalesce into one trailing send.
        if (timer) {
          pending = next
          return
        }
        emit(next)
        timer = setTimeout(onTimer, intervalMs)
        return
      }
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      pending = null
      emit(next)
    },
    adopt(next) {
      setBaseline(next)
      pending = null
    },
    flush() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (pending) {
        const next = pending
        pending = null
        emit(next)
      }
    },
    dispose() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = null
    }
  }
}

/**
 * Ephemeral canvas nodes — subagent cards (ids tracked in the agentNodes store) and /loop, /schedule
 * and /cron cards (`loop-<parentId>`). They are DERIVED on every client from the already-broadcast
 * `agent:status` stream, live outside React Flow's managed `nodes` array, and are never persisted.
 * Publishing them would render each card twice on a peer. They are never published — full stop.
 * This is the one definition of "ephemeral"; Canvas's own change-list filter uses it too.
 */
export function isEphemeralNodeId(id: string, ephemeralIds: ReadonlySet<string>): boolean {
  return ephemeralIds.has(id) || id.startsWith('loop-') || id.startsWith('xproj-')
}

/**
 * The whole canvas as it may go on the wire: publishable nodes (above) plus the two PERSISTED edge
 * lists, with every edge whose endpoint is an ephemeral card dropped.
 *
 * That last filter is the edge half of the same rule. The ephemeral subagent / loop cards are
 * derived per client from the `agent:status` stream, so an edge pointing at one addresses a node id
 * that exists on the peer with a DIFFERENT lifetime (or not at all yet) — and unlike a node, an
 * edge is not visibly duplicated by the mistake, it just gets pruned on the peer at a moment we do
 * not control and then re-published back at us. The ephemeral edges Canvas draws to those cards are
 * built and merged at the `<ReactFlow>` prop and are not in these lists at all; this is the guard
 * for a PERSISTED edge that happens to name one.
 */
export function publishableScene(
  scene: CanvasScene,
  ephemeralIds: ReadonlySet<string>
): CanvasScene {
  const nodes = publishableStates(scene.nodes, ephemeralIds)
  const live = new Set(nodes.map((n) => n.id))
  const keep = (e: BridgeLink): boolean => live.has(e.source) && live.has(e.target)
  const keepLink = (link: Link): boolean => {
    const endpointLive = (endpoint: Link['source']): boolean =>
      endpoint.ref !== 'node' || live.has(endpoint.nodeId)
    return endpointLive(link.source) && endpointLive(link.target)
  }
  return {
    nodes,
    bridges: scene.bridges.filter(keep),
    ropes: scene.ropes.filter(keep),
    links: (scene.links ?? []).filter(keepLink)
  }
}

/** The node states that may go on the wire: everything except the ephemeral cards. */
export function publishableStates(
  states: CanvasNodeState[],
  ephemeralIds: ReadonlySet<string>
): CanvasNodeState[] {
  // `stripSharedNodeExec`, for the same reason it runs on a project file: the exec-enabling fields
  // are MACHINE-LOCAL. A teammate cannot use our `shell` or our `-o ProxyCommand=…` (they name
  // programs and hosts on OUR box), and sending them would both leak our local setup and put a
  // value of foreign provenance into their live nodes. The publisher's baseline is built from this
  // same function, so nothing re-publishes in a loop.
  return stripSharedNodeExec(states.filter((n) => !isEphemeralNodeId(n.id, ephemeralIds)))
}
