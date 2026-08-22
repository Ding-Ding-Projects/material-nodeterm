import { describe, expect, it } from 'vitest'
import { describeProjectChange } from './project-diff'

const file = (nodes: unknown[], extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ name: 'Proj', nodes, ...extra })

describe('describeProjectChange', () => {
  it('records nothing for an unchanged save — the autosave cadence must not fill the log', () => {
    const a = file([{ id: 'n1', kind: 'terminal', title: 'Build' }])
    expect(describeProjectChange(a, a, 'Proj')).toBeNull()
  })

  it('the first snapshot of a run is a creation, not an edit of nothing', () => {
    const after = file([{ id: 'n1', kind: 'terminal', title: 'Build' }])
    expect(describeProjectChange(null, after, 'Proj')).toEqual({
      label: 'Created project Proj',
      action: 'created'
    })
  })

  it('names an added node and files it under created', () => {
    const before = file([{ id: 'n1', kind: 'terminal', title: 'Build' }])
    const after = file([
      { id: 'n1', kind: 'terminal', title: 'Build' },
      { id: 'n2', kind: 'sticky', title: 'Notes' }
    ])
    expect(describeProjectChange(before, after, 'Proj')).toEqual({
      label: 'Added 1 node (Notes)',
      action: 'created'
    })
  })

  it('names a deleted node and files it under deleted', () => {
    const before = file([
      { id: 'n1', kind: 'terminal', title: 'Build' },
      { id: 'n2', kind: 'sticky', title: 'Notes' }
    ])
    const after = file([{ id: 'n1', kind: 'terminal', title: 'Build' }])
    expect(describeProjectChange(before, after, 'Proj')).toEqual({
      label: 'Deleted 1 node (Notes)',
      action: 'deleted'
    })
  })

  it('an edit to an existing node is an edit, named by that node', () => {
    const before = file([{ id: 'n1', kind: 'terminal', title: 'Build', x: 0 }])
    const after = file([{ id: 'n1', kind: 'terminal', title: 'Build', x: 40 }])
    expect(describeProjectChange(before, after, 'Proj')).toEqual({
      label: 'Edited 1 node (Build)',
      action: 'updated'
    })
  })

  it('one save carrying several kinds of change lists them all, prioritising created', () => {
    const before = file([
      { id: 'n1', title: 'Build' },
      { id: 'n2', title: 'Notes' }
    ])
    const after = file([
      { id: 'n1', title: 'Build', x: 10 },
      { id: 'n3', title: 'Docs' }
    ])
    const change = describeProjectChange(before, after, 'Proj')
    expect(change?.action).toBe('created')
    expect(change?.label).toContain('Added 1 node (Docs)')
    expect(change?.label).toContain('Deleted 1 node (Notes)')
    expect(change?.label).toContain('Edited 1 node (Build)')
  })

  it('caps a bulk change rather than producing an unreadable subject', () => {
    const before = file([])
    const after = file(
      Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, title: `Node ${i}` }))
    )
    const change = describeProjectChange(before, after, 'Proj')
    expect(change?.label).toBe('Added 9 nodes (Node 0, Node 1, Node 2 and 6 more)')
  })

  it('falls back to the node kind, then the id, when a node has no title', () => {
    const before = file([])
    const after = file([{ id: 'n1', kind: 'browser' }, { id: 'n2' }])
    expect(describeProjectChange(before, after, 'Proj')?.label).toBe(
      'Added 2 nodes (browser and n2)'
    )
  })

  it('reports a rename when the nodes are identical', () => {
    const nodes = [{ id: 'n1', title: 'Build' }]
    const before = JSON.stringify({ name: 'Old', nodes })
    const after = JSON.stringify({ name: 'New', nodes })
    expect(describeProjectChange(before, after, 'Old')).toEqual({
      label: 'Renamed project to New',
      action: 'updated'
    })
  })

  it('reports a board change when only the kanban moved', () => {
    const nodes = [{ id: 'n1', title: 'Build' }]
    const before = file(nodes, { kanban: { columns: [] } })
    const after = file(nodes, { kanban: { columns: [{ id: 'c1', title: 'To do' }] } })
    expect(describeProjectChange(before, after, 'Proj')).toEqual({
      label: 'Updated the board in Proj',
      action: 'updated'
    })
  })

  it('an unreadable snapshot is generic, NEVER "every node deleted"', () => {
    const after = file([{ id: 'n1', title: 'Build' }])
    const change = describeProjectChange('{ not json', after, 'Proj')
    expect(change).toEqual({ label: 'Saved project Proj', action: 'updated' })
    expect(change?.action).not.toBe('deleted')
  })
})
