import { beforeEach, describe, expect, it } from 'vitest'
import type { BridgeLink, CanvasMutation, CanvasNodeState } from '@shared/types'
import { useProjects } from '../state/projects'
import { commitActiveCanvas } from '../state/persistGuards'
import { receiveActiveEdgeMutation, type ActiveEdgeLists } from './team-edge-receive'

interface LiveEdge extends BridgeLink {
  selected: boolean
}

const node = (id: string): CanvasNodeState => ({
  id,
  kind: 'terminal',
  position: { x: 0, y: 0 },
  size: { width: 480, height: 320 },
  title: id,
  color: '#fff',
  group: ''
})

const toLink = (edge: LiveEdge): BridgeLink => ({
  id: edge.id,
  source: edge.source,
  target: edge.target
})

beforeEach(() => {
  useProjects.getState().hydrate({ version: 2, activeProjectId: '', projects: [] })
})

describe('foreground peer edge persistence', () => {
  it('drives live setters, adoption, dirty marking and the guarded whole-file commit', () => {
    const nodes = [node('a'), node('b')]
    const project = useProjects.getState().addProject('foreground')
    useProjects.getState().setActive(project.id)

    let live: ActiveEdgeLists<LiveEdge> = { bridges: [], ropes: [] }
    let adopted: ActiveEdgeLists<LiveEdge> | null = null
    let dirtyCount = 0
    let bridgeSetterCount = 0
    let ropeSetterCount = 0

    const receive = (mutation: CanvasMutation): void => {
      receiveActiveEdgeMutation(live, mutation, {
        toLink,
        rebuild: (_kind, link, previous) =>
          previous.find(
            (edge) =>
              edge.id === link.id && edge.source === link.source && edge.target === link.target
          ) ?? { ...link, selected: false },
        setBridges: (bridges) => {
          bridgeSetterCount++
          live = { ...live, bridges }
        },
        setRopes: (ropes) => {
          ropeSetterCount++
          live = { ...live, ropes }
        },
        adopt: (next) => {
          adopted = next
        },
        markDirty: () => {
          dirtyCount++
        }
      })
    }

    const persistForeground = (): void => {
      const store = useProjects.getState()
      expect(
        commitActiveCanvas(
          {
            nodesProjectId: project.id,
            activeProjectId: store.activeProjectId,
            nodes,
            viewport: { x: 10, y: 20, zoom: 1.25 },
            bridges: live.bridges.map(toLink),
            ropes: live.ropes.map(toLink)
          },
          store.commitCanvas
        )
      ).toBe(true)
    }

    const link = { id: 'peer-link', source: 'a', target: 'b' }
    receive({ op: 'edge-upsert', kind: 'bridge', edge: link })

    expect(live.bridges.map(toLink)).toEqual([link])
    expect(live.ropes).toEqual([])
    expect(bridgeSetterCount).toBe(1)
    expect(ropeSetterCount).toBe(0)
    expect(adopted).toEqual(live)
    expect(dirtyCount).toBe(1)
    persistForeground()
    expect(useProjects.getState().toWorkspace().projects[0].bridges).toEqual([link])

    receive({ op: 'edge-remove', kind: 'bridge', id: link.id })

    expect(live.bridges).toEqual([])
    expect(bridgeSetterCount).toBe(2)
    expect(ropeSetterCount).toBe(0)
    expect(adopted).toEqual(live)
    expect(dirtyCount).toBe(2)
    persistForeground()
    expect(useProjects.getState().toWorkspace().projects[0].bridges).toEqual([])
  })
})
