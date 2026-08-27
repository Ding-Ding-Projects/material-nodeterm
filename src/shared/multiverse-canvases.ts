import type { BridgeLink, CanvasNodeState, Project, ProjectMultiverseCanvas, Viewport } from './types'

export const ROOT_CANVAS_ID = 'root'
export const MAX_MULTIVERSE_DEPTH = 8
export const MAX_MULTIVERSE_CANVASES = 4095

export interface ProjectCanvasView {
  id: string
  title: string
  depth: number
  parentCanvasId?: string
  viewport: Viewport
  nodes: CanvasNodeState[]
  bridges?: BridgeLink[]
  ropes?: BridgeLink[]
}

export function projectCanvasView(project: Project): ProjectCanvasView {
  const selected = project.activeCanvasId
    ? project.multiverseCanvases?.find((canvas) => canvas.id === project.activeCanvasId)
    : undefined
  return selected
    ? { ...selected }
    : {
        id: ROOT_CANVAS_ID,
        title: project.name,
        depth: 0,
        viewport: project.viewport,
        nodes: project.nodes,
        bridges: project.bridges,
        ropes: project.ropes
      }
}

export function canvasDepth(project: Project, canvasId: string): number | null {
  if (canvasId === ROOT_CANVAS_ID) return 0
  const byId = new Map((project.multiverseCanvases ?? []).map((canvas) => [canvas.id, canvas]))
  const seen = new Set<string>()
  const measure = (id: string): number | null => {
    if (id === ROOT_CANVAS_ID) return 0
    if (seen.has(id)) return null
    const canvas = byId.get(id)
    if (!canvas) return null
    seen.add(id)
    const parentDepth = measure(canvas.parentCanvasId)
    seen.delete(id)
    if (parentDepth === null || canvas.depth !== parentDepth + 1) return null
    return parentDepth + 1
  }
  return measure(canvasId)
}

export function multiverseCanvasPath(project: Project, canvasId: string): ProjectCanvasView[] {
  const byId = new Map((project.multiverseCanvases ?? []).map((canvas) => [canvas.id, canvas]))
  const path: ProjectCanvasView[] = []
  let current = canvasId
  const seen = new Set<string>()
  while (current !== ROOT_CANVAS_ID) {
    if (seen.has(current)) return []
    seen.add(current)
    const canvas = byId.get(current)
    if (!canvas) return []
    path.unshift({ ...canvas })
    current = canvas.parentCanvasId
  }
  path.unshift({ id: ROOT_CANVAS_ID, title: project.name, depth: 0, viewport: project.viewport, nodes: project.nodes, bridges: project.bridges, ropes: project.ropes })
  return path
}

export function sanitizeMultiverseCanvases(value: unknown): ProjectMultiverseCanvas[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MULTIVERSE_CANVASES) return undefined
  const accepted: ProjectMultiverseCanvas[] = []
  const ids = new Set<string>([ROOT_CANVAS_ID])
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Partial<ProjectMultiverseCanvas>
    if (
      typeof item.id !== 'string' || !item.id.trim() || item.id.length > 128 || ids.has(item.id) ||
      typeof item.title !== 'string' || !item.title.trim() || item.title.length > 160 ||
      typeof item.parentCanvasId !== 'string' || !ids.has(item.parentCanvasId) ||
      typeof item.depth !== 'number' || !Number.isInteger(item.depth) || item.depth < 1 || item.depth > MAX_MULTIVERSE_DEPTH ||
      typeof item.order !== 'number' || !Number.isFinite(item.order) ||
      !item.viewport || typeof item.viewport.x !== 'number' || !Number.isFinite(item.viewport.x) ||
      typeof item.viewport.y !== 'number' || !Number.isFinite(item.viewport.y) ||
      typeof item.viewport.zoom !== 'number' || !Number.isFinite(item.viewport.zoom) || item.viewport.zoom <= 0 ||
      !Array.isArray(item.nodes)
    ) continue
    const parentDepth = item.parentCanvasId === ROOT_CANVAS_ID
      ? 0
      : accepted.find((canvas) => canvas.id === item.parentCanvasId)?.depth
    if (parentDepth === undefined || item.depth !== parentDepth + 1) continue
    ids.add(item.id)
    accepted.push({
      id: item.id,
      title: item.title.trim(),
      parentCanvasId: item.parentCanvasId,
      depth: item.depth,
      order: item.order,
      viewport: { x: item.viewport.x, y: item.viewport.y, zoom: item.viewport.zoom },
      nodes: item.nodes,
      ...(Array.isArray(item.bridges) ? { bridges: item.bridges } : {}),
      ...(Array.isArray(item.ropes) ? { ropes: item.ropes } : {})
    })
  }
  return accepted.length ? accepted : undefined
}
