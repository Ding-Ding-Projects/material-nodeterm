import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasNodeState, NodeTerminalApi, Project } from '@shared/types'
import {
  captureProjectEndRequest,
  planSessionKill,
  projectDeleteGenerationCurrent,
  projectEndDestination,
  removeAcknowledgedStoredNodes,
  settleProjectSessionDestroys,
  settleSessionDestroys
} from './sessionKill'
import {
  bindProjectToSession,
  createSession,
  projectSessionScope,
  resetSessionsForTest,
  setActiveSession
} from '../session/session'

beforeEach(() => resetSessionsForTest())

const project = (id: string, nodeIds: string[], over: Partial<Project> = {}): Project =>
  ({
    id,
    name: id,
    color: '#fff',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: nodeIds.map((n) => ({ id: n, kind: 'terminal', title: n, position: { x: 0, y: 0 } })),
    ...over
  }) as unknown as Project

const ssh = (id: string, nodeIds: string[], over: Partial<Project> = {}): Project =>
  project(id, nodeIds, {
    ssh: { server: { host: 'box', user: 'enes', port: 22 } as never, remoteCwd: '/srv' },
    ...over
  })

describe('planSessionKill', () => {
  it('finds the owner across every project, closed ones included', () => {
    const plan = planSessionKill('c', [project('p1', ['a']), project('p2', ['c'], { closed: true })], 'p1')
    expect(plan.ownerProjectId).toBe('p2')
  })

  it('reports no owner for an orphan', () => {
    expect(planSessionKill('ghost', [project('p1', ['a'])], 'p1').ownerProjectId).toBeNull()
  })

  it('kills an ORPHAN on the host when the scope is an SSH project', () => {
    // The whole point. `transport.destroy` reaches a remote session only through a LIVE client
    // carrying `sshRemote`; an orphan has no node and therefore no client, so destroy alone would
    // touch the local socket and leave the host's `nt-ghost` running — after a confirm that said
    // otherwise.
    const plan = planSessionKill('ghost', [ssh('s1', ['a'])], 's1')
    expect(plan).toEqual({ ownerProjectId: null, remoteProjectId: 's1' })
  })

  it('kills a NON-ACTIVE project´s session on the host too', () => {
    // Same trap one step along: an unmounted node has no live client either. This is the case the
    // sessions sidebar has always got wrong; it never listed another machine's sessions, and this
    // panel's whole purpose is to.
    const plan = planSessionKill('b', [ssh('s1', ['a']), ssh('s2', ['b'], { closed: true })], 's1')
    expect(plan).toEqual({ ownerProjectId: 's2', remoteProjectId: 's1' })
  })

  it('routes the remote kill through the ACTIVE project, never the owner', () => {
    // The panel shows ONE machine — the active project's — and the sweep that produced these rows
    // ran over that project's master. The owner's own connection may be down, or on another host.
    expect(planSessionKill('b', [ssh('s1', ['a']), ssh('s2', ['b'])], 's1').remoteProjectId).toBe('s1')
  })

  it('never reaches for a host when the scope is this machine', () => {
    // A local sweep lists LOCAL sessions. A local `nt-b` whose node belongs to an SSH project is
    // the stranded local fallback `requireRemote` exists to prevent — killing it on the host would
    // leave it running here.
    const plan = planSessionKill('b', [project('p1', ['a']), ssh('s2', ['b'])], 'p1')
    expect(plan).toEqual({ ownerProjectId: 's2', remoteProjectId: null })
  })

  it('survives an unknown active project', () => {
    expect(planSessionKill('a', [project('p1', ['a'])], '').remoteProjectId).toBeNull()
  })
})

describe('settleSessionDestroys', () => {
  it('publishes no removable ids until every destroy acknowledgement has settled', async () => {
    let resolveEnded!: () => void
    let rejectUnknown!: (error: Error) => void
    const destroy = vi.fn((nodeId: string) =>
      nodeId === 'ended'
        ? new Promise<void>((resolve) => {
            resolveEnded = resolve
          })
        : new Promise<void>((_resolve, reject) => {
            rejectUnknown = reject
          })
    )
    let outcome: Awaited<ReturnType<typeof settleSessionDestroys>> | undefined
    const pending = settleSessionDestroys(['ended', 'unknown'], destroy).then((value) => {
      outcome = value
      return value
    })

    await Promise.resolve()
    expect(outcome).toBeUndefined()
    resolveEnded()
    rejectUnknown(new Error('reply lost'))

    await expect(pending).resolves.toEqual({
      confirmed: ['ended'],
      failed: [{ nodeId: 'unknown', message: 'reply lost' }]
    })
  })

  it('removes only acknowledged sessions and keeps rejected outcomes retryable', async () => {
    const destroy = vi.fn(async (nodeId: string) => {
      if (nodeId === 'unknown') throw new Error('session-host connection closed before reply')
    })

    await expect(settleSessionDestroys(['ended', 'unknown', 'also-ended'], destroy)).resolves.toEqual({
      confirmed: ['ended', 'also-ended'],
      failed: [
        { nodeId: 'unknown', message: 'session-host connection closed before reply' }
      ]
    })
    expect(destroy.mock.calls.map(([nodeId]) => nodeId)).toEqual([
      'ended',
      'unknown',
      'also-ended'
    ])

    // A rejected result did not tombstone the renderer-side action; a later acknowledgement can
    // confirm the same id and make it eligible for removal.
    await expect(settleSessionDestroys(['unknown'], async () => {})).resolves.toEqual({
      confirmed: ['unknown'],
      failed: []
    })
  })

  it.each([
    'pty destroy refused: invalid node id',
    'pty destroy refused: rate limit exceeded; retry later'
  ])('keeps a core-refused node out of the Canvas removal set: %s', async (message) => {
    await expect(
      settleSessionDestroys(['kept-node'], async () => {
        throw new Error(message)
      })
    ).resolves.toEqual({
      confirmed: [],
      failed: [{ nodeId: 'kept-node', message }]
    })
  })
})

describe('settleProjectSessionDestroys', () => {
  it('uses the bound relay API, retaining rejection and never acknowledging through local', async () => {
    const localDestroy = vi.fn(async () => {})
    const relayDestroy = vi
      .fn<(nodeId: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('relay host outcome unknown'))
      .mockResolvedValueOnce(undefined)
    const local = createSession(
      'local',
      { pty: { destroy: localDestroy } } as unknown as NodeTerminalApi,
      'This PC'
    )
    setActiveSession(local.id)
    const relay = createSession(
      'relay',
      { pty: { destroy: relayDestroy } } as unknown as NodeTerminalApi,
      'Relay host'
    )
    bindProjectToSession('relay-project', relay.id)

    await expect(
      settleProjectSessionDestroys('relay-project', ['relay-node'])
    ).resolves.toEqual({
      confirmed: [],
      failed: [{ nodeId: 'relay-node', message: 'relay host outcome unknown' }]
    })
    expect(relayDestroy).toHaveBeenCalledWith('relay-node')
    expect(localDestroy).not.toHaveBeenCalled()

    await expect(
      settleProjectSessionDestroys('relay-project', ['relay-node'])
    ).resolves.toEqual({ confirmed: ['relay-node'], failed: [] })
    expect(relayDestroy).toHaveBeenCalledTimes(2)
    expect(localDestroy).not.toHaveBeenCalled()
  })
})

describe('acknowledged project-node reconciliation', () => {
  const terminal = (id: string): CanvasNodeState => ({
    id,
    kind: 'terminal',
    title: id,
    position: { x: 0, y: 0 },
    size: { width: 640, height: 420 },
    color: '#fff',
    group: null
  })

  it('keeps the confirmation-open A project, session and targets after the canvas switches to B', async () => {
    const destroyA = vi.fn(async () => {})
    const destroyB = vi.fn(async () => {})
    const sessionA = createSession(
      'relay',
      { pty: { destroy: destroyA } } as unknown as NodeTerminalApi,
      'Relay A'
    )
    const sessionB = createSession(
      'relay',
      { pty: { destroy: destroyB } } as unknown as NodeTerminalApi,
      'Relay B'
    )
    bindProjectToSession('A', sessionA.id)
    bindProjectToSession('B', sessionB.id)
    setActiveSession(sessionA.id)
    const request = captureProjectEndRequest(
      'A',
      projectSessionScope('A'),
      'A',
      [{ id: 'a-terminal' }],
      ['a-terminal']
    )

    // This is the time between opening the confirm and clicking Confirm.
    setActiveSession(sessionB.id)
    await settleSessionDestroys(request.targets.map((node) => node.id), (nodeId) =>
      request.scope.session.api.pty.destroy(nodeId)
    )

    expect(request.projectId).toBe('A')
    expect(request.scope.session.id).toBe(sessionA.id)
    expect(request.targets).toEqual([{ id: 'a-terminal' }])
    expect(destroyA).toHaveBeenCalledWith('a-terminal')
    expect(destroyB).not.toHaveBeenCalled()
  })

  it('applies a delayed A acknowledgement to stored A after A → B, never to live B', () => {
    const destination = projectEndDestination(
      { projectId: 'A', sessionId: 'relay-A' },
      {
        projectId: 'A',
        sessionId: 'relay-A',
        activeProjectId: 'B',
        loadedProjectId: 'B'
      }
    )
    const storedA = [terminal('a-ended'), terminal('a-kept')]
    const liveB = [terminal('b-live')]

    expect(destination).toBe('stored')
    expect(removeAcknowledgedStoredNodes(storedA, new Set(['a-ended']))).toEqual([
      terminal('a-kept')
    ])
    expect(liveB).toEqual([terminal('b-live')])
  })

  it('routes an inactive → active acknowledgement to the live canvas', () => {
    expect(
      projectEndDestination(
        { projectId: 'A', sessionId: 'relay-A' },
        {
          projectId: 'A',
          sessionId: 'relay-A',
          activeProjectId: 'A',
          loadedProjectId: 'A'
        }
      )
    ).toBe('live')
  })

  it('retains the node when the project was rebound to a different core', () => {
    expect(
      projectEndDestination(
        { projectId: 'A', sessionId: 'relay-old' },
        {
          projectId: 'A',
          sessionId: 'relay-new',
          activeProjectId: 'A',
          loadedProjectId: 'A'
        }
      )
    ).toBe('retain')
  })

  it('refuses to delete a reopened project generation that gained a terminal while kills waited', () => {
    const captured = project('A', ['old-node'], { closed: true })
    const reopenedWithNewNode = {
      ...captured,
      closed: false,
      nodes: [...captured.nodes, terminal('new-node')]
    }

    expect(
      projectDeleteGenerationCurrent(captured, reopenedWithNewNode, 'relay-A', 'relay-A')
    ).toBe(false)
    expect(reopenedWithNewNode.nodes.map((node) => node.id)).toEqual(['old-node', 'new-node'])
  })
})
