import type { BridgeLink, CanvasNodeState, Project, ProjectAwsUniverseCanvas, Viewport } from './types'

export const AWS_UNIVERSE_ROOT_ID = 'root'
/** Resource safety bound only. There is no product limit on the number of AWS Universe instances. */
export const MAX_AWS_UNIVERSE_INSTANCES = 4095

export interface AwsUniverseCanvasView {
  id: string
  title: string
  depth: 0 | 1
  parentCanvasId: 'root'
  viewport: Viewport
  nodes: CanvasNodeState[]
  bridges?: BridgeLink[]
  ropes?: BridgeLink[]
}

function cleanTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const title = value.trim()
  if (!title || title.length > 160 || [...title].some((char) => {
    const code = char.codePointAt(0) ?? 0
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
  })) return null
  return title
}

function validViewport(value: unknown): value is Viewport {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Viewport>
  return typeof candidate.x === 'number' && Number.isFinite(candidate.x) &&
    typeof candidate.y === 'number' && Number.isFinite(candidate.y) &&
    typeof candidate.zoom === 'number' && Number.isFinite(candidate.zoom) && candidate.zoom > 0
}

function safeCanvasId(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) return null
  if ([...value].some((char) => {
    const code = char.codePointAt(0) ?? 0
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
  })) return null
  return value
}

export function projectAwsUniverseCanvas(project: Project, id: string): AwsUniverseCanvasView {
  const selected = project.awsUniverses?.find((canvas) => canvas.id === id)
  if (selected) return { ...selected, depth: 1, parentCanvasId: AWS_UNIVERSE_ROOT_ID }
  return {
    id: AWS_UNIVERSE_ROOT_ID,
    title: project.name,
    depth: 0,
    parentCanvasId: AWS_UNIVERSE_ROOT_ID,
    viewport: project.viewport,
    nodes: project.nodes,
    bridges: project.bridges,
    ropes: project.ropes
  }
}

export function awsUniverseCanvasPath(project: Project, id: string): AwsUniverseCanvasView[] {
  const active = projectAwsUniverseCanvas(project, id)
  return active.id === AWS_UNIVERSE_ROOT_ID
    ? [active]
    : [projectAwsUniverseCanvas(project, AWS_UNIVERSE_ROOT_ID), active]
}

/** Validate shared AWS Universe records without accepting machine-local provider state. */
export function sanitizeAwsUniverses(value: unknown): ProjectAwsUniverseCanvas[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MAX_AWS_UNIVERSE_INSTANCES) return undefined
  const accepted: ProjectAwsUniverseCanvas[] = []
  const ids = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Partial<ProjectAwsUniverseCanvas>
    const id = safeCanvasId(item.id)
    const title = cleanTitle(item.title)
    if (!id || ids.has(id) || !title || item.parentCanvasId !== AWS_UNIVERSE_ROOT_ID || item.depth !== 1 ||
      typeof item.order !== 'number' || !Number.isFinite(item.order) || !validViewport(item.viewport) ||
      !Array.isArray(item.nodes)) continue
    ids.add(id)
    accepted.push({
      id,
      title,
      parentCanvasId: AWS_UNIVERSE_ROOT_ID,
      depth: 1,
      order: item.order,
      viewport: { x: item.viewport.x, y: item.viewport.y, zoom: item.viewport.zoom },
      nodes: item.nodes,
      ...(Array.isArray(item.bridges) ? { bridges: item.bridges } : {}),
      ...(Array.isArray(item.ropes) ? { ropes: item.ropes } : {})
    })
  }
  return accepted.length ? accepted : undefined
}

export function nextAwsUniverseId(existing: readonly ProjectAwsUniverseCanvas[]): string {
  let index = existing.length + 1
  let candidate = `aws-universe-${index}`
  const ids = new Set(existing.map((item) => item.id))
  while (ids.has(candidate)) candidate = `aws-universe-${++index}`
  return candidate
}

export function awsUniverseScopeIsValid(scope: unknown): scope is 'aws-universe' {
  return scope === 'aws-universe'
}
