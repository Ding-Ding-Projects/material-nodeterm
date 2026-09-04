import { describe, expect, it } from 'vitest'
import { fileToProject, projectToFile } from './workspace-files'
import type { Project } from '../shared/types'

// A child canvas owns its nodes directly; membership is the node list, not a list of ids.
const shop = () => ({
  id: 'shop-mv', kind: 'shop' as const, position: { x: 0, y: 0 }, size: { width: 480, height: 420 },
  title: 'Shop', color: '#6750a4', group: null, creationEventId: 'evt-shop',
  universeCanvasId: 'mv', universeScope: 'multiverse' as const, universeDepth: 1, nonDeletable: true
})

const project = (): Project => ({
  id: 'p1', name: 'Project', color: '#ffffff', viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  childCanvases: [{ id: 'mv', scope: 'multiverse', parentCanvasId: 'root', depth: 1, title: 'MV', order: 1, nodes: [shop()] }]
})

describe('persisted child canvas and Shop state', () => {
  it('round-trips child membership and Shop identity through the shared project file', () => {
    const file = projectToFile(project(), 1, '2026-08-26T00:00:00.000Z')
    expect(file.childCanvases?.[0].nodes.map((node) => node.id)).toEqual(['shop-mv'])
    const loaded = fileToProject(file, { id: 'p1' })
    expect(loaded.childCanvases?.[0].id).toBe('mv')
    expect(loaded.childCanvases?.[0].nodes[0].creationEventId).toBe('evt-shop')
  })

  it('rejects malformed child membership by omitting it rather than inventing a canvas', () => {
    const file = projectToFile(project(), 1, '2026-08-26T00:00:00.000Z')
    const noMembership = fileToProject({ ...file, childCanvases: [{ ...file.childCanvases![0], nodes: 42 as never }] }, { id: 'p1' })
    expect(noMembership.childCanvases).toBeUndefined()
    // A malformed member inside a real list drops that member, never the whole canvas.
    const badMember = fileToProject({ ...file, childCanvases: [{ ...file.childCanvases![0], nodes: [42 as never] }] }, { id: 'p1' })
    expect(badMember.childCanvases?.[0].id).toBe('mv')
    expect(badMember.childCanvases?.[0].nodes).toEqual([])
  })
})
