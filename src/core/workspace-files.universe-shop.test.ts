import { describe, expect, it } from 'vitest'
import { fileToProject, projectToFile } from './workspace-files'
import type { Project } from '../shared/types'

const project = (): Project => ({
  id: 'p1', name: 'Project', color: '#ffffff', viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [{ id: 'shop-mv', kind: 'shop', position: { x: 0, y: 0 }, size: { width: 480, height: 420 }, title: 'Shop', color: '#6750a4', group: null, creationEventId: 'evt-shop', universeCanvasId: 'mv', universeScope: 'multiverse', universeDepth: 1, nonDeletable: true }],
  childCanvases: [{ id: 'mv', scope: 'multiverse', parentCanvasId: 'root', depth: 1, title: 'MV', order: 1, nodeIds: ['shop-mv'] }]
})

describe('persisted child canvas and Shop state', () => {
  it('round-trips child membership and Shop identity through the shared project file', () => {
    const file = projectToFile(project(), 1, '2026-08-26T00:00:00.000Z')
    expect(file.childCanvases?.[0].nodeIds).toEqual(['shop-mv'])
    const loaded = fileToProject(file, { id: 'p1' })
    expect(loaded.childCanvases?.[0].id).toBe('mv')
    expect(loaded.nodes[0].creationEventId).toBe('evt-shop')
  })

  it('rejects malformed child membership by omitting it rather than inventing a canvas', () => {
    const file = projectToFile(project(), 1, '2026-08-26T00:00:00.000Z')
    const loaded = fileToProject({ ...file, childCanvases: [{ ...file.childCanvases![0], nodeIds: [42 as never] }] }, { id: 'p1' })
    expect(loaded.childCanvases).toBeUndefined()
  })
})
