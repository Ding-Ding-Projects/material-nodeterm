import type { CanvasNodeState, Project } from '@shared/types'

/** The small structural slice of a persisted cross-project lineage link used by the renderer.
 * Keeping this reader structural lets the projection stay independent of the link migration and
 * endpoint-model lanes, while still validating hostile project-file data before rendering. */
export interface ForeignProjectionLink {
  id: string
  kind: 'lineage'
  source: { ref: 'node'; nodeId: string }
  target: { ref: 'xnode'; projectId: string; nodeId: string }
}

export interface ForeignNodeProjection {
  link: ForeignProjectionLink
  sourceNode: CanvasNodeState
  targetProject: Project
  targetNode: CanvasNodeState
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readLinks(project: Project): ForeignProjectionLink[] {
  const raw = (project as Project & { links?: unknown }).links
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const links: ForeignProjectionLink[] = []
  for (const candidate of raw) {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || seen.has(candidate.id)) continue
    const source = candidate.source
    const target = candidate.target
    if (!isRecord(source) || !isRecord(target)) continue
    if (
      candidate.kind !== 'lineage' ||
      source.ref !== 'node' ||
      target.ref !== 'xnode' ||
      typeof source.nodeId !== 'string' ||
      typeof target.projectId !== 'string' ||
      typeof target.nodeId !== 'string'
    ) continue
    seen.add(candidate.id)
    links.push({
      id: candidate.id,
      kind: 'lineage',
      source: { ref: 'node', nodeId: source.nodeId },
      target: { ref: 'xnode', projectId: target.projectId, nodeId: target.nodeId }
    })
  }
  return links
}

/** Resolve only links whose source is on the mounted project and whose foreign node still exists.
 * Missing targets are intentionally omitted, so a deleted foreign node cannot leave a stale live
 * viewer behind. The persisted link remains available to the owning link-reconciliation lane. */
export function resolveForeignNodeProjections(
  project: Project | undefined,
  projects: readonly Project[],
  sourceNodes: readonly CanvasNodeState[]
): ForeignNodeProjection[] {
  if (!project) return []
  const projections: ForeignNodeProjection[] = []
  for (const link of readLinks(project)) {
    const sourceNode = sourceNodes.find((node) => node.id === link.source.nodeId)
    const targetProject = projects.find((candidate) => candidate.id === link.target.projectId)
    const targetNode = targetProject?.nodes.find((node) => node.id === link.target.nodeId)
    if (!sourceNode || !targetProject || !targetNode) continue
    projections.push({ link, sourceNode, targetProject, targetNode })
  }
  return projections
}
