import { beforeEach, describe, expect, it } from 'vitest'
import { useProjects } from './projects'
import { flowToNodeStates, nodeStatesToFlow } from './workspace'
import { projectCanvasView, ROOT_CANVAS_ID } from '@shared/multiverse-canvases'
import { createPortableDoorConstruction, activatePortableDoor } from '@shared/door-construction'

beforeEach(() => {
  useProjects.getState().hydrate({ version: 2, activeProjectId: '', projects: [] })
})

function finite(nodes: ReturnType<typeof nodeStatesToFlow>): void {
  for (const node of nodes) {
    expect(Number.isFinite(node.position.x)).toBe(true)
    expect(Number.isFinite(node.position.y)).toBe(true)
    expect(Number.isFinite(Number(node.width))).toBe(true)
    expect(Number.isFinite(Number(node.height))).toBe(true)
  }
}

describe('universe creation never leaves the canvas unrenderable', () => {
  it('a new Multiverse child canvas hydrates into finite React Flow nodes and round-trips', () => {
    const project = useProjects.getState().addProject('demo', '/tmp/demo')
    const created = useProjects.getState().createMultiverseCanvas(project.id, ROOT_CANVAS_ID, 'Child')
    expect(created.canvasId).toBeTruthy()
    expect(useProjects.getState().openMultiverseCanvas(project.id, created.canvasId!)).toBe(true)
    const view = projectCanvasView(useProjects.getState().getProject(project.id)!)
    expect(view.id).toBe(created.canvasId)
    const flow = nodeStatesToFlow(view.nodes)
    expect(flow.map((n) => n.type)).toEqual(['shop'])
    finite(flow)
    expect(flowToNodeStates(flow).map((n) => n.kind)).toEqual(['shop'])
  })

  it('pairs a door onto the child and navigates back to the root without losing either canvas', () => {
    const project = useProjects.getState().addProject('demo', '/tmp/demo')
    const created = useProjects.getState().createMultiverseCanvas(project.id, ROOT_CANVAS_ID, 'Child')
    const childCanvasId = created.canvasId!
    const entry = activatePortableDoor(createPortableDoorConstruction({
      doorId: `door-${childCanvasId}-entry`,
      canvasId: ROOT_CANVAS_ID,
      targetCanvasId: childCanvasId,
      pairedDoorId: `door-${childCanvasId}-return`,
      label: 'Child',
      activationCore: { id: 'activation-core', label: 'Activation core', mode: 'door-only', armed: true }
    }))
    expect(entry.activated).toBe(true)
    if (!entry.activated) return
    const returnConstruction = createPortableDoorConstruction({
      doorId: `door-${childCanvasId}-return`,
      canvasId: childCanvasId,
      targetCanvasId: ROOT_CANVAS_ID,
      pairedDoorId: `door-${childCanvasId}-entry`,
      label: 'Return to Child',
      frame: entry.construction.frame,
      hinges: entry.construction.hinges,
      panel: entry.construction.panel,
      handle: entry.construction.handle,
      activationCore: { ...entry.construction.activationCore, armed: true }
    })
    const attached = useProjects.getState().attachMultiverseDoor(project.id, {
      parentCanvasId: ROOT_CANVAS_ID,
      childCanvasId,
      entryDoorId: `door-${childCanvasId}-entry`,
      returnDoorId: `door-${childCanvasId}-return`,
      title: 'Child',
      entryConstruction: entry.construction,
      returnConstruction
    })
    expect(attached.portalId).toBeTruthy()
    const portals = useProjects.getState().getProject(project.id)!.portals ?? []
    expect(portals).toHaveLength(1)
    expect(portals[0].entryConstruction?.doorId).toBe(`door-${childCanvasId}-entry`)
    expect(useProjects.getState().attachMultiverseDoor(project.id, {
      parentCanvasId: ROOT_CANVAS_ID,
      childCanvasId,
      entryDoorId: `door-${childCanvasId}-entry`,
      returnDoorId: `door-${childCanvasId}-return`,
      title: 'Child',
      entryConstruction: entry.construction,
      returnConstruction
    }).reason).toMatch(/already has a constructed portal/)
    expect(useProjects.getState().openMultiverseCanvas(project.id, childCanvasId)).toBe(true)
    finite(nodeStatesToFlow(projectCanvasView(useProjects.getState().getProject(project.id)!).nodes))
    expect(useProjects.getState().openMultiverseCanvas(project.id, ROOT_CANVAS_ID)).toBe(true)
    finite(nodeStatesToFlow(projectCanvasView(useProjects.getState().getProject(project.id)!).nodes))
  })

  it('a new AWS Universe hydrates into finite React Flow nodes on both canvases', () => {
    const project = useProjects.getState().addProject('demo', '/tmp/demo')
    const created = useProjects.getState().createAwsUniverseCanvas(project.id, 'Cloud')
    expect(created.canvasId).toBeTruthy()
    finite(nodeStatesToFlow(projectCanvasView(useProjects.getState().getProject(project.id)!).nodes))
    expect(useProjects.getState().openAwsUniverseCanvas(project.id, created.canvasId!)).toBe(true)
    const view = projectCanvasView(useProjects.getState().getProject(project.id)!)
    expect(view.id).toBe(created.canvasId)
    finite(nodeStatesToFlow(view.nodes))
  })
})
