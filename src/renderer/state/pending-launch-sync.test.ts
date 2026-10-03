// `pendingLaunch` across the live canvas (applyMutationToFlow) and the background-project store
// (applyNodeMutation).
//
// The launch is machine-local (@shared/node-exec): a peer or relay guest may never set, replace or
// clear it, and nothing about it rides the canvas cast. These tests pin that for both apply paths.
import { describe, it, expect, beforeEach } from 'vitest'
import { applyMutationToFlow, nodeStatesToFlow, type CanvasNode } from './workspace'
import { useProjects } from './projects'
import type { CanvasNodeState, PendingLaunch } from '@shared/types'

const armed: PendingLaunch = {
  after: [],
  launchId: '123e4567-e89b-42d3-a456-426614174000',
  launch: { kind: 'shell-command', command: 'claude "brief"' }
}
const hostile: PendingLaunch = {
  after: [],
  launchId: '223e4567-e89b-42d3-a456-426614174000',
  launch: { kind: 'shell-command', command: 'evil' }
}
const state = (over: Partial<CanvasNodeState> = {}): CanvasNodeState => ({
  id: 'n1',
  kind: 'terminal',
  position: { x: 0, y: 0 },
  size: { width: 480, height: 320 },
  title: 'n1',
  color: '#fff',
  group: null,
  ...over
})
const flow = (s: CanvasNodeState): CanvasNode[] => nodeStatesToFlow([s])

describe('applyMutationToFlow (live canvas)', () => {
  it('a peer upsert carrying a launch neither arms a node nor replaces ours', () => {
    const fresh = applyMutationToFlow([], { op: 'upsert', node: state({ pendingLaunch: hostile }) })
    expect(fresh[0].data.pendingLaunch).toBeUndefined()
    const mine = flow(state({ pendingLaunch: armed }))
    const moved = applyMutationToFlow(mine, { op: 'upsert', node: state({ position: { x: 9, y: 9 } }) })
    expect(moved[0].data.pendingLaunch).toEqual(armed)
    expect(moved[0].position).toEqual({ x: 9, y: 9 })
  })
  it('a relay guest keeps its own launch through the host\'s stripped echo', () => {
    // The host strips the guest's launch before reflecting; the guest's own live copy survives.
    const guest = flow(state({ pendingLaunch: armed }))
    const echo = applyMutationToFlow(guest, { op: 'upsert', node: state(), seq: 4 })
    expect(echo[0].data.pendingLaunch).toEqual(armed)
  })
})

describe('projects store (a project not on screen)', () => {
  beforeEach(() => useProjects.getState().hydrate({ version: 2, activeProjectId: '', projects: [] }))
  it('the peer path (applyNodeMutation) can neither plant nor clear one', () => {
    const p = useProjects.getState().addProject('p', '/tmp/p')
    useProjects.getState().applyNodeMutation(p.id, { op: 'upsert', node: state({ id: 'x', pendingLaunch: armed }) })
    expect(useProjects.getState().getProject(p.id)!.nodes[0].pendingLaunch).toBeUndefined()
    useProjects.getState().commitCanvas(p.id, [state({ pendingLaunch: armed })], { x: 0, y: 0, zoom: 1 })
    useProjects.getState().applyNodeMutation(p.id, { op: 'upsert', node: state() })
    expect(useProjects.getState().getProject(p.id)!.nodes.find((n) => n.id === 'n1')!.pendingLaunch).toEqual(armed)
  })
})
