/** Pure helpers for the off-canvas link authoring and inspection surfaces. */
import type { BridgeLink, CanvasNodeState, Endpoint, Link, LinkKind, Project } from '@shared/types'
import { canContextLink, createdAgentHarnessId } from '@shared/agents/config'

export interface DependencyGitSurface {
  setBranchParent(repoPath: string, child: string, parent: string): Promise<{ ok: boolean; message: string }>
  unsetBranchParent(repoPath: string, child: string): Promise<{ ok: boolean; message: string }>
}

export type PickerSelection =
  | { kind: 'node'; projectId: string; nodeId: string }
  | { kind: 'branch'; repoPath: string; branch: string }

export function resolveEndpoint(selection: PickerSelection, sourceProjectId: string): Endpoint {
  if (selection.kind === 'branch') return { ref: 'branch', repoPath: selection.repoPath, branch: selection.branch }
  return selection.projectId === sourceProjectId
    ? { ref: 'node', nodeId: selection.nodeId }
    : { ref: 'xnode', projectId: selection.projectId, nodeId: selection.nodeId }
}

export type ProjectLookup = Pick<Project, 'id' | 'name' | 'nodes'> & {
  cwd?: string
  closed?: boolean
  unavailable?: boolean
}

export function describeEndpoint(
  endpoint: Endpoint,
  projects: readonly ProjectLookup[]
): { label: string; available: boolean } {
  if (endpoint.ref === 'branch') {
    const repo = endpoint.repoPath.split(/[\\/]/).filter(Boolean).pop() ?? endpoint.repoPath
    return { label: `${repo} · ${endpoint.branch}`, available: true }
  }
  if (endpoint.ref === 'xnode') {
    const project = projects.find((candidate) => candidate.id === endpoint.projectId)
    if (!project || project.unavailable) return { label: 'Unavailable project', available: false }
    const node = project.nodes.find((candidate) => candidate.id === endpoint.nodeId)
    return node
      ? { label: `${project.name} · ${node.title || node.id}`, available: true }
      : { label: `${project.name} · unavailable node`, available: false }
  }
  for (const project of projects) {
    const node = project.nodes.find((candidate) => candidate.id === endpoint.nodeId)
    if (node) return { label: `${project.name} · ${node.title || node.id}`, available: true }
  }
  return { label: 'Unavailable node', available: false }
}

export function linksForNode(links: readonly Link[], nodeId: string): { outgoing: Link[]; incoming: Link[] } {
  const outgoing: Link[] = []
  const incoming: Link[] = []
  for (const link of links) {
    const source = link.source.ref === 'node' && link.source.nodeId === nodeId
    const target = link.target.ref === 'node' && link.target.nodeId === nodeId
    if (source) outgoing.push(link)
    else if (target) incoming.push(link)
  }
  return { outgoing, incoming }
}

export interface LinkKindEndpoint {
  kind: string
  contextCapable: boolean
}

export function kindAllowed(kind: LinkKind, source: LinkKindEndpoint, target: LinkKindEndpoint): boolean {
  if (kind === 'dependency' || kind === 'lineage') return true
  const stickies = (source.kind === 'sticky' ? 1 : 0) + (target.kind === 'sticky' ? 1 : 0)
  if (stickies === 0) return source.contextCapable && target.contextCapable
  if (stickies !== 1) return false
  const other = source.kind === 'sticky' ? target : source
  return other.kind === 'terminal'
}

export function linkKindEndpointOf(node: CanvasNodeState): LinkKindEndpoint {
  const harness = createdAgentHarnessId(node)
  return {
    kind: node.kind,
    contextCapable: node.kind !== 'sticky' && !!harness && canContextLink(harness)
  }
}

export function newLinkId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `link-${random}`
}

export function offCanvasLinkColor(link: Link): string {
  if (link.kind === 'dependency') return '#f59e0b'
  if (link.kind === 'lineage') return '#8e8e93'
  if (link.source.ref === 'xnode' || link.target.ref === 'xnode') return '#a855f7'
  return '#0a84ff'
}

/**
 * Replace only node-to-node links whose endpoints are present in the current view.
 *
 * Group and node drills temporarily remove the other nodes from React Flow. Treating the visible
 * edge arrays as the complete project would therefore delete links to siblings on the next save.
 * Foreign-node, branch, and partially hidden links stay in the project while visible edges are
 * refreshed from the current canvas state.
 */
export function mergeVisibleNodeLinks(
  existing: readonly Link[],
  visibleNodeIds: ReadonlySet<string>,
  bridges: readonly BridgeLink[],
  ropes: readonly BridgeLink[]
): Link[] {
  const nextIds = new Set([...bridges, ...ropes].map((edge) => edge.id))
  const retained = existing.filter((link) => {
    if (nextIds.has(link.id)) return false
    if (link.kind !== 'context' && link.kind !== 'lineage') return true
    if (link.source.ref !== 'node' || link.target.ref !== 'node') return true
    return !(visibleNodeIds.has(link.source.nodeId) && visibleNodeIds.has(link.target.nodeId))
  })
  return [
    ...retained,
    ...bridges.map((edge) => ({
      id: edge.id,
      kind: 'context' as const,
      source: { ref: 'node' as const, nodeId: edge.source },
      target: { ref: 'node' as const, nodeId: edge.target }
    })),
    ...ropes.map((edge) => ({
      id: edge.id,
      kind: 'lineage' as const,
      source: { ref: 'node' as const, nodeId: edge.source },
      target: { ref: 'node' as const, nodeId: edge.target },
      meta: { displayOnly: true }
    }))
  ]
}

export interface BranchBranchLink extends Link {
  source: { ref: 'branch'; repoPath: string; branch: string }
  target: { ref: 'branch'; repoPath: string; branch: string }
}

export function isBranchDependencyLink(link: Link): link is BranchBranchLink {
  return link.kind === 'dependency' && link.source.ref === 'branch' && link.target.ref === 'branch'
}

export function isCrossProjectDependencyLink(link: Link): boolean {
  return link.kind === 'dependency' && (link.source.ref === 'xnode' || link.target.ref === 'xnode')
}

export async function applyDependencyLink(
  git: DependencyGitSurface,
  link: Link
): Promise<{ ok: boolean; message: string }> {
  if (!isBranchDependencyLink(link)) return { ok: true, message: '' }
  if (link.source.repoPath !== link.target.repoPath) {
    return { ok: false, message: 'Branch dependency endpoints must belong to the same repository.' }
  }
  return git.setBranchParent(link.source.repoPath, link.source.branch, link.target.branch)
}

export async function removeDependencyLinkConfig(
  git: DependencyGitSurface,
  link: Link
): Promise<{ ok: boolean; message: string }> {
  if (!isBranchDependencyLink(link)) return { ok: true, message: '' }
  if (link.source.repoPath !== link.target.repoPath) {
    return { ok: false, message: 'Branch dependency endpoints belong to different repositories.' }
  }
  return git.unsetBranchParent(link.source.repoPath, link.source.branch)
}

export interface DepHostEdge {
  id: string
  source: string
  target: string
  label: string
  linkId: string
}

/** Stable in-memory key for a repository branch. The branch name alone is not unique on a canvas. */
export function branchEndpointKey(repoPath: string, branch: string): string {
  return `${repoPath}\u0000${branch}`
}

export function depHostEdges(
  links: readonly Link[],
  branchToGroupNode: ReadonlyMap<string, string>
): DepHostEdge[] {
  const edges: DepHostEdge[] = []
  for (const link of links) {
    if (!isBranchDependencyLink(link)) continue
    const source = branchToGroupNode.get(branchEndpointKey(link.source.repoPath, link.source.branch)) ?? branchToGroupNode.get(link.source.branch)
    const target = branchToGroupNode.get(branchEndpointKey(link.target.repoPath, link.target.branch)) ?? branchToGroupNode.get(link.target.branch)
    if (!source || !target || source === target) continue
    edges.push({
      id: `dep-${link.id}`,
      source,
      target,
      label: `${link.source.branch} → ${link.target.branch}`,
      linkId: link.id
    })
  }
  return edges
}
