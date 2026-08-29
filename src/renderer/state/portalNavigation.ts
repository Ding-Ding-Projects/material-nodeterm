import { create } from 'zustand'
import type { Project, PortalNavigationSnapshot, Viewport } from '@shared/types'
import {
  enterPortal,
  exitPortal,
  normalizePortalNavigationOnRelaunch,
  refuseDirectCanvasSelection,
  type PortalNavigationResult,
  type PortalTopology
} from '@shared/portal-navigation'

interface PortalNavigationState {
  byProject: Record<string, PortalNavigationSnapshot>
  current(projectId: string): PortalNavigationSnapshot
  enter(project: Project, doorNodeId: string, parentViewport?: Viewport, parentFocusNodeId?: string): PortalNavigationResult
  exit(project: Project, doorNodeId: string): PortalNavigationResult
  selectCanvas(_projectId: string, _canvasId: string): PortalNavigationResult
  reset(projectId: string): void
  resetAll(): void
}

function topologyFor(project: Project): PortalTopology {
  return {
    rootCanvasId: 'root',
    canvases: project.canvases ?? [],
    nodes: project.nodes
  }
}

function initial(): Record<string, PortalNavigationSnapshot> {
  // Never hydrate a child canvas from browser or application storage. A relaunch always shows the
  // parent root and requires a fresh, matched door activation to enter again.
  return {}
}

export const usePortalNavigation = create<PortalNavigationState>((set, get) => ({
  byProject: initial(),
  current(projectId) {
    return get().byProject[projectId] ?? normalizePortalNavigationOnRelaunch()
  },
  enter(project, doorNodeId, parentViewport, parentFocusNodeId) {
    const current = get().current(project.id)
    const result = enterPortal(topologyFor(project), current, doorNodeId, parentViewport, parentFocusNodeId)
    if (result.ok && result.snapshot) set((state) => ({ byProject: { ...state.byProject, [project.id]: result.snapshot! } }))
    return result
  },
  exit(project, doorNodeId) {
    const current = get().current(project.id)
    const result = exitPortal(topologyFor(project), current, doorNodeId)
    if (result.ok && result.snapshot) set((state) => ({ byProject: { ...state.byProject, [project.id]: result.snapshot! } }))
    return result
  },
  selectCanvas() {
    return refuseDirectCanvasSelection()
  },
  reset(projectId) {
    set((state) => ({ byProject: { ...state.byProject, [projectId]: normalizePortalNavigationOnRelaunch() } }))
  },
  resetAll() {
    set({ byProject: {} })
  }
}))

/** Child membership is a render concern, not a route. Root nodes omit canvasId. */
export function nodesForPortalCanvas(project: Project, canvasId: string) {
  return project.nodes.filter((node) => (node.canvasId ?? 'root') === canvasId)
}

