// How a canvas becomes a context-link map: node id → the nodes it may READ.
//
// Lives in shared because both shells need it and neither owns it. The desktop renderer builds
// the ACTIVE project's map from live React Flow edges and the rest from the projects store
// (Canvas.tsx). The Server Edition has no renderer holding a canvas — it derives the whole map
// from persisted project files instead (src/server/context-link.ts). Same rules either way, so
// they belong in one place rather than two that drift.
import type { BridgeLink, CanvasNodeState, ContextLinkInfo, ContextLinkMap, Link } from './types'

/**
 * Return only local node-to-node context links. Branch endpoints and cross-project endpoints do
 * not identify a transcript pair for this route, while lineage links are display-only.
 */
export function contextNodeEdges(links: readonly Link[] | undefined): Array<{ source: string; target: string }> {
  if (!links?.length) return []
  const out: Array<{ source: string; target: string }> = []
  for (const link of links) {
    if (link.kind !== 'context') continue
    if (link.source.ref !== 'node' || link.target.ref !== 'node') continue
    out.push({ source: link.source.nodeId, target: link.target.nodeId })
  }
  return out
}

export interface LinkNodeInfo {
  id: string
  title: string
  cwd?: string
  note?: string
  sticky: boolean
  agentId?: string
  sessionId?: string
  accountId?: string
}

/**
 * Build the node → linked-nodes map pushed to main (which writes the per-node link files).
 * Context edges map both directions; note edges map one direction only — the terminal side
 * gets a { id, title, note } entry, the sticky side gets nothing (a sticky cannot read).
 */
export function buildLinkMap(
  edges: Array<{ source: string; target: string }>,
  infoOf: (id: string) => LinkNodeInfo
): ContextLinkMap {
  const map: ContextLinkMap = {}
  const entryOf = (n: LinkNodeInfo): ContextLinkInfo => {
    if (n.sticky) return { id: n.id, title: n.title, note: n.note ?? '' }
    const e: ContextLinkInfo = { id: n.id, title: n.title, cwd: n.cwd ?? '' }
    if (n.agentId) e.agentId = n.agentId
    if (n.sessionId) e.sessionId = n.sessionId
    if (n.accountId) e.accountId = n.accountId
    return e
  }
  for (const e of edges) {
    const s = infoOf(e.source)
    const t = infoOf(e.target)
    if (s.sticky && t.sticky) continue
    if (s.sticky) {
      ;(map[t.id] ??= []).push(entryOf(s))
    } else if (t.sticky) {
      ;(map[s.id] ??= []).push(entryOf(t))
    } else {
      ;(map[s.id] ??= []).push(entryOf(t))
      ;(map[t.id] ??= []).push(entryOf(s))
    }
  }
  return map
}

/**
 * Link maps built from serialized nodes + links, for every project EXCEPT `activeProjectId`.
 *
 * On the desktop the active project's map is built live from React Flow and this covers the rest,
 * because writeLinkFiles clears ALL link files before writing the pushed map — pushing only the
 * active project's map deleted the link files of background projects whose tmux sessions (and
 * agents mid-task) were still running. Node ids are globally unique across projects, so the maps
 * merge without collisions.
 *
 * A shell with no focused canvas (the Server Edition) passes `activeProjectId: null` and gets
 * every project, which is the whole map.
 *
 * `agentIdOf` is the hook-status fallback for plain terminals where the user launched an
 * agent CLI by hand: the serialized node carries no agentId, but the status store (fed by
 * the managed hooks, node ids are per-core so background projects share it) knows who's
 * running inside.
 */
export function buildBackgroundLinkMaps(
  projects: Array<{ id: string; nodes: CanvasNodeState[]; bridges?: BridgeLink[]; links?: Link[] }>,
  activeProjectId: string | null,
  sessionIdOf: (nodeId: string) => string | undefined,
  agentIdOf?: (nodeId: string) => string | undefined,
  onlyProjectId?: string
): ContextLinkMap {
  const map: ContextLinkMap = {}
  const allNodes = new Map<string, CanvasNodeState>()
  for (const project of projects) {
    for (const node of project.nodes) if (!allNodes.has(node.id)) allNodes.set(node.id, node)
  }
  const infoFor = (id: string): LinkNodeInfo | undefined => {
    const node = allNodes.get(id)
    if (!node) return undefined
    const sticky = node.kind === 'sticky'
    const agentId = sticky ? undefined : (node.agentId ?? agentIdOf?.(id))
    return {
      id,
      title: node.title || id,
      cwd: node.cwd ?? '',
      note: sticky ? (node.text ?? '') : undefined,
      sticky,
      agentId,
      sessionId: agentId ? (sessionIdOf(id) ?? node.agentSessionId) : undefined,
      accountId: sticky ? undefined : node.accountId
    }
  }
  for (const p of projects) {
    if (p.id === activeProjectId || !p.links?.length) continue
    const byId = new Map(p.nodes.map((n) => [n.id, n]))
    const edges = contextNodeEdges(p.links).filter(
      (edge) => byId.has(edge.source) && byId.has(edge.target)
    )
    const infoOf = (id: string): LinkNodeInfo => {
      const n = byId.get(id)!
      const sticky = n.kind === 'sticky'
      const agentId = sticky ? undefined : (n.agentId ?? agentIdOf?.(id))
      return {
        id,
        title: n.title || id,
        cwd: n.cwd ?? '',
        note: sticky ? (n.text ?? '') : undefined,
        sticky,
        agentId,
        sessionId: agentId ? sessionIdOf(id) : undefined,
        accountId: sticky ? undefined : n.accountId
      }
    }
  }
  for (const p of projects) {
    if (p.id === activeProjectId) continue
    if (onlyProjectId !== undefined && p.id !== onlyProjectId) continue
    const typed = p.links?.filter(
      (link) =>
        link.kind === 'context' &&
        (link.source.ref === 'node' || link.source.ref === 'xnode') &&
        (link.target.ref === 'node' || link.target.ref === 'xnode')
    ) ?? []
    if (typed.length) {
      const edges = typed
        .map((link) => ({
          id: link.id,
          source: link.source.ref === 'node' || link.source.ref === 'xnode' ? link.source.nodeId : '',
          target: link.target.ref === 'node' || link.target.ref === 'xnode' ? link.target.nodeId : ''
        }))
        .filter((edge) => !!edge.source && !!edge.target && !!infoFor(edge.source) && !!infoFor(edge.target))
      Object.assign(map, buildLinkMap(edges, (id) => infoFor(id)!))
      continue
    }
    // Legacy bridge arrays only ever had same-project node ids. Keep that fallback for older files,
    // but never invent a cross-project endpoint from a bridge-shaped record.
    const byId = new Map(p.nodes.map((node) => [node.id, node]))
    const edges = (p.bridges ?? []).filter((edge) => byId.has(edge.source) && byId.has(edge.target))
    if (!edges.length) continue
    Object.assign(map, buildLinkMap(edges, (id) => infoFor(id)!))
  }
  return map
}

/** Build context-link entries for one project, including xnode endpoints resolved from the full
 * project set. The active canvas uses this alongside its live React Flow edge map; background and
 * Server Edition callers use `buildBackgroundLinkMaps` above. */
export function buildProjectContextLinkMap(
  project: { id: string; nodes: CanvasNodeState[]; bridges?: BridgeLink[]; links?: Link[] },
  projects: readonly { id: string; nodes: CanvasNodeState[]; bridges?: BridgeLink[]; links?: Link[] }[],
  sessionIdOf: (nodeId: string) => string | undefined,
  agentIdOf?: (nodeId: string) => string | undefined
): ContextLinkMap {
  return buildBackgroundLinkMaps(
    [...projects.filter((candidate) => candidate.id !== project.id), project],
    null,
    sessionIdOf,
    agentIdOf,
    project.id
  )
}
