import { afterEach, describe, it, expect } from 'vitest'
import {
  addSelectionToGroup,
  alignNodes,
  arrangeNodes,
  commonParentId,
  createAccountLoginNode,
  createAnnotationNode,
  createBrowserNode,
  createCodexAccountLoginNode,
  createAgentNode,
  createCanvasControlTerminalNode,
  createDinoNode,
  createGroupNode,
  defaultBrowserTabs,
  duplicateNode,
  fitGroupToChildren,
  flowToNodeStates,
  groupSelectedNodes,
  NODE_COLORS,
  nodeStatesToFlow,
  nodeSshFor,
  reorderGroupWithinParent,
  reorderNodeBefore,
  reparentNode,
  resolveNewNodeAccount,
  selectedRootIds,
  ungroupNodes
} from './workspace'
import type { CanvasNode } from './workspace'
import type { NodeKind } from '@shared/types'
import type { AnnotationRect } from '../lib/annotation'
import { resetCodexIdentityCapsForTests } from './codexIdentity'
import { agentLaunchProgram, codexRemoteCommand } from '../../shared/agents/config'
import type { AgentId, AgentPermissionMode } from '@shared/agents/config'
import type { ActiveAgentLaunchPlan } from './permissionMode'

const launchPlan = (
  agentId: AgentId,
  mode: AgentPermissionMode
): ActiveAgentLaunchPlan =>
  ({ surface: 'canvas-new-agent', agentId, mode }) as ActiveAgentLaunchPlan

afterEach(() => resetCodexIdentityCapsForTests())

const term = (id: string, pos: { x: number; y: number }, parentId?: string): CanvasNode =>
  ({
    id,
    type: 'terminal',
    position: pos,
    width: 320,
    height: 240,
    data: { title: id, color: '#888', group: null },
    ...(parentId ? { parentId, extent: 'parent' as const } : {})
  }) as unknown as CanvasNode

const grp = (id: string, pos: { x: number; y: number }, parentId?: string): CanvasNode =>
  ({
    id,
    type: 'group',
    position: pos,
    width: 400,
    height: 300,
    data: { title: id, color: '#fff', group: null },
    ...(parentId ? { parentId, extent: 'parent' as const } : {})
  }) as unknown as CanvasNode

describe('reparentNode', () => {
  it('adds a top-level node to a group with a group-relative position', () => {
    const nodes = [term('t1', { x: 200, y: 150 }), grp('g1', { x: 50, y: 50 })]
    const out = reparentNode(nodes, 't1', 'g1')
    const t1 = out.find((n) => n.id === 't1')!
    expect(t1.parentId).toBe('g1')
    expect(t1.extent).toBe('parent')
    expect(t1.position).toEqual({ x: 150, y: 100 })
  })

  it('removes a node from its group, restoring the absolute position', () => {
    const nodes = [grp('g1', { x: 50, y: 50 }), term('t1', { x: 10, y: 10 }, 'g1')]
    const out = reparentNode(nodes, 't1', null)
    const t1 = out.find((n) => n.id === 't1')!
    expect(t1.parentId).toBeUndefined()
    expect(t1.extent).toBeUndefined()
    expect(t1.position).toEqual({ x: 60, y: 60 })
  })

  it('orders group nodes before their children', () => {
    const nodes = [term('t1', { x: 200, y: 150 }), grp('g1', { x: 50, y: 50 })]
    const out = reparentNode(nodes, 't1', 'g1')
    expect(out.findIndex((n) => n.id === 'g1')).toBeLessThan(out.findIndex((n) => n.id === 't1'))
  })

  it('is a no-op when the node is already in the target group', () => {
    const nodes = [grp('g1', { x: 50, y: 50 }), term('t1', { x: 10, y: 10 }, 'g1')]
    expect(reparentNode(nodes, 't1', 'g1')).toBe(nodes)
  })

  it('is a no-op when the node is missing or the target is not a group', () => {
    const nodes = [grp('g1', { x: 50, y: 50 }), term('t1', { x: 10, y: 10 })]
    expect(reparentNode(nodes, 'nope', 'g1')).toBe(nodes)
    expect(reparentNode(nodes, 't1', 't1')).toBe(nodes) // target is a terminal, not a group
  })
  it('moves a whole group subtree between nested containers without moving it in root space', () => {
    const nodes = [
      grp('outer', { x: 100, y: 80 }),
      grp('inner', { x: 30, y: 40 }, 'outer'),
      term('leaf', { x: 10, y: 12 }, 'inner'),
      grp('target', { x: 500, y: 200 })
    ]
    const out = reparentNode(nodes, 'inner', 'target')
    const inner = out.find((node) => node.id === 'inner')!
    expect(inner.parentId).toBe('target')
    expect(inner.position).toEqual({ x: -370, y: -80 })
    expect(out.find((node) => node.id === 'leaf')!.position).toEqual({ x: 10, y: 12 })
    expect(out.findIndex((node) => node.id === 'target')).toBeLessThan(
      out.findIndex((node) => node.id === 'inner')
    )
  })

  it('rejects parenting a group into itself or one of its descendants', () => {
    const nodes = [grp('outer', { x: 0, y: 0 }), grp('inner', { x: 20, y: 20 }, 'outer')]
    expect(reparentNode(nodes, 'outer', 'outer')).toBe(nodes)
    expect(reparentNode(nodes, 'outer', 'inner')).toBe(nodes)
  })
})

describe('addSelectionToGroup', () => {
  it('adds selected sibling objects to the already selected group', () => {
    const nodes = [
      grp('target', { x: 100, y: 80 }),
      term('a', { x: 500, y: 200 }),
      term('b', { x: 700, y: 300 })
    ]
    const out = addSelectionToGroup(nodes, ['target', 'a', 'b'], 'target')
    expect(out.find((node) => node.id === 'a')!.parentId).toBe('target')
    expect(out.find((node) => node.id === 'b')!.parentId).toBe('target')
    // Root-space positions are unchanged: the frame was re-fitted around its new children, so
    // frame origin + child offset still lands on the node's old absolute position.
    const target = out.find((node) => node.id === 'target')!
    const a = out.find((node) => node.id === 'a')!
    expect(target.position.x + a.position.x).toBe(500)
    expect(target.position.y + a.position.y).toBe(200)
  })

  it('moves only a selected subtree root and rejects cycles through reparenting', () => {
    const nodes = [
      grp('target', { x: 500, y: 200 }),
      grp('outer', { x: 100, y: 80 }),
      term('leaf', { x: 10, y: 12 }, 'outer')
    ]
    const out = addSelectionToGroup(nodes, ['target', 'outer', 'leaf'], 'target')
    expect(out.find((node) => node.id === 'outer')!.parentId).toBe('target')
    expect(out.find((node) => node.id === 'leaf')!.parentId).toBe('outer')
    const nested = [grp('outer', { x: 0, y: 0 }), grp('target', { x: 20, y: 20 }, 'outer')]
    expect(addSelectionToGroup(nested, ['outer', 'target'], 'target')).toBe(nested)
  })

  it('is a no-op without a valid target or movable selected object', () => {
    const nodes = [grp('target', { x: 0, y: 0 }), term('inside', { x: 10, y: 10 }, 'target')]
    expect(addSelectionToGroup(nodes, ['target', 'inside'], 'target')).toBe(nodes)
    expect(addSelectionToGroup(nodes, ['target'], 'missing')).toBe(nodes)
  })
})

describe('selectedRootIds', () => {
  it('normalizes box-selected group subtrees to their selected roots', () => {
    const nodes = [
      grp('outer', { x: 0, y: 0 }),
      grp('inner', { x: 10, y: 10 }, 'outer'),
      term('leaf', { x: 5, y: 5 }, 'inner'),
      grp('sibling', { x: 500, y: 0 })
    ]
    expect(selectedRootIds(nodes, ['outer', 'inner', 'leaf', 'sibling'])).toEqual([
      'outer',
      'sibling'
    ])
  })

  it('drops unknown ids and preserves independent selection order', () => {
    const nodes = [term('a', { x: 0, y: 0 }), term('b', { x: 10, y: 10 })]
    expect(selectedRootIds(nodes, ['missing', 'b', 'a'])).toEqual(['b', 'a'])
  })
})

describe('commonParentId', () => {
  it('is null when every id is top-level', () => {
    const nodes = [term('t1', { x: 0, y: 0 }), grp('g1', { x: 5, y: 5 })]
    expect(commonParentId(nodes, ['t1', 'g1'])).toBeNull()
  })
  it('is the group id when every id is a child of the same group', () => {
    const nodes = [grp('g1', { x: 0, y: 0 }), term('t1', { x: 10, y: 10 }, 'g1'), term('t2', { x: 20, y: 20 }, 'g1')]
    expect(commonParentId(nodes, ['t1', 't2'])).toBe('g1')
  })
  it('is undefined for a mixed set (framed + loose, or two frames) or no matching ids', () => {
    const nodes = [
      grp('g1', { x: 0, y: 0 }),
      term('t1', { x: 10, y: 10 }, 'g1'),
      term('loose', { x: 500, y: 0 })
    ]
    expect(commonParentId(nodes, ['t1', 'loose'])).toBeUndefined()
    expect(commonParentId(nodes, ['nope'])).toBeUndefined()
  })
})

describe('arrange/align inside a frame', () => {
  // Children of one frame arrange in the frame's coordinate space — the gap this closes: after
  // grouping, the frame's contents could not be tidied from the canvas-control CLI.
  const framed = () => [
    grp('g1', { x: 100, y: 100 }),
    term('a', { x: 5, y: 5 }, 'g1'),
    term('b', { x: 400, y: 300 }, 'g1'), // scattered inside the frame
    term('c', { x: 900, y: 40 }, 'g1')
  ]

  it('arranges a frame\'s children in a row without touching the frame or top-level nodes', () => {
    const out = arrangeNodes(framed(), ['a', 'b', 'c'], { layout: 'row', gap: 40 })
    const pos = (id: string) => out.find((n) => n.id === id)!.position
    // Row starts at the bounding-box top-left of the children (relative coords), y shared.
    expect(pos('a')).toEqual({ x: 5, y: 5 })
    expect(pos('b')).toEqual({ x: 5 + 320 + 40, y: 5 })
    expect(pos('c')).toEqual({ x: 5 + (320 + 40) * 2, y: 5 })
  })

  it('refuses a set spanning two containers (no-op)', () => {
    const nodes = [
      grp('g1', { x: 0, y: 0 }),
      term('a', { x: 10, y: 10 }, 'g1'),
      term('loose', { x: 800, y: 0 })
    ]
    expect(arrangeNodes(nodes, ['a', 'loose'], { layout: 'row' })).toBe(nodes)
    expect(alignNodes(nodes, ['a', 'loose'], 'left')).toBe(nodes)
  })

  it('aligns a frame\'s children to a shared left edge', () => {
    const out = alignNodes(framed(), ['a', 'b', 'c'], 'left')
    const xs = ['a', 'b', 'c'].map((id) => out.find((n) => n.id === id)!.position.x)
    expect(new Set(xs)).toEqual(new Set([5])) // all snapped to the leftmost (a.x = 5)
  })
})

describe('fitGroupToChildren', () => {
  it('shrinks the frame to hug its children and keeps them fixed on canvas', () => {
    // Frame is oversized (400×300) but its two children sit in a small cluster.
    const nodes = [
      grp('g1', { x: 100, y: 100 }),
      term('a', { x: 20, y: 40 }, 'g1'), // abs (120,140), 320×240
      term('b', { x: 60, y: 20 }, 'g1') // abs (160,120)
    ]
    const out = fitGroupToChildren(nodes, 'g1')
    const g = out.find((n) => n.id === 'g1')!
    const a = out.find((n) => n.id === 'a')!
    const b = out.find((n) => n.id === 'b')!
    // Children keep their ABSOLUTE canvas positions (frame origin + relative pos unchanged).
    expect({ x: g.position.x + a.position.x, y: g.position.y + a.position.y }).toEqual({ x: 120, y: 140 })
    expect({ x: g.position.x + b.position.x, y: g.position.y + b.position.y }).toEqual({ x: 160, y: 120 })
    // Frame hugs the child bbox with the standard pad (28) + header (34) on top.
    const GROUP_PAD = 28
    const GROUP_HEADER = 34
    const minX = 120, minY = 120
    const maxX = 160 + 320, maxY = 140 + 240
    expect(g.position).toEqual({ x: minX - GROUP_PAD, y: minY - GROUP_PAD - GROUP_HEADER })
    expect(g.width).toBe(maxX - minX + GROUP_PAD * 2)
    expect(g.height).toBe(maxY - minY + GROUP_PAD * 2 + GROUP_HEADER)
  })

  it('is a no-op for a missing id, a non-group, or an empty frame', () => {
    const nodes = [grp('g1', { x: 0, y: 0 }), term('t1', { x: 0, y: 0 })]
    expect(fitGroupToChildren(nodes, 'nope')).toBe(nodes)
    expect(fitGroupToChildren(nodes, 't1')).toBe(nodes)
    expect(fitGroupToChildren(nodes, 'g1')).toBe(nodes) // g1 has no children
  })
})

describe('groupSelectedNodes', () => {
  it('wraps the selection in a group frame with group-relative child positions', () => {
    const nodes = [term('t1', { x: 100, y: 100 }), term('t2', { x: 500, y: 300 })]
    const out = groupSelectedNodes(nodes, ['t1', 't2'], 0)
    const group = out[0]
    expect(group.type).toBe('group') // parent placed first (React Flow requirement)
    const t1 = out.find((n) => n.id === 't1')!
    expect(t1.parentId).toBe(group.id)
    expect(t1.extent).toBe('parent')
    // absolute position preserved: group position + relative child position
    expect(group.position.x + t1.position.x).toBe(100)
    expect(group.position.y + t1.position.y).toBe(100)
    // frame encloses both members (t2 spans to x=820, y=540)
    expect(group.position.x + (group.width as number)).toBeGreaterThanOrEqual(820)
    expect(group.position.y + (group.height as number)).toBeGreaterThanOrEqual(540)
  })

  it('groups a single node', () => {
    const out = groupSelectedNodes([term('t1', { x: 100, y: 100 })], ['t1'], 0)
    expect(out[0].type).toBe('group')
    expect(out.find((n) => n.id === 't1')!.parentId).toBe(out[0].id)
  })

  it('refuses an ancestor together with its descendant', () => {
    const nodes = [grp('g1', { x: 0, y: 0 }), term('t1', { x: 10, y: 10 }, 'g1')]
    expect(groupSelectedNodes(nodes, ['g1', 't1'], 1)).toBe(nodes)
  })
  it('refuses members that live in different containers', () => {
    const nodes = [
      grp('g1', { x: 0, y: 0 }),
      term('inside', { x: 10, y: 10 }, 'g1'),
      term('loose', { x: 900, y: 900 })
    ]
    expect(groupSelectedNodes(nodes, ['inside', 'loose'], 1)).toBe(nodes)
  })

  it('wraps sibling groups in a nested group while preserving root-space positions', () => {
    const nodes = [grp('a', { x: 100, y: 120 }), grp('b', { x: 600, y: 180 })]
    const out = groupSelectedNodes(nodes, ['a', 'b'], 2)
    const wrapper = out.find((node) => !nodes.some((old) => old.id === node.id))!
    const a = out.find((node) => node.id === 'a')!
    expect(wrapper.type).toBe('group')
    expect(a.parentId).toBe(wrapper.id)
    expect(wrapper.position.x + a.position.x).toBe(100)
    expect(wrapper.position.y + a.position.y).toBe(120)
    expect(out.indexOf(wrapper)).toBeLessThan(out.indexOf(a))
  })

  it("creates the wrapper inside the siblings' existing parent", () => {
    const nodes = [
      grp('outer', { x: 100, y: 80 }),
      grp('a', { x: 20, y: 30 }, 'outer'),
      grp('b', { x: 500, y: 60 }, 'outer')
    ]
    const out = groupSelectedNodes(nodes, ['a', 'b'], 3)
    const wrapper = out.find((node) => !nodes.some((old) => old.id === node.id))!
    const outer = out.find((node) => node.id === 'outer')!
    const a = out.find((node) => node.id === 'a')!
    expect(wrapper.parentId).toBe('outer')
    expect(a.parentId).toBe(wrapper.id)
    // Root space is unchanged: 'a' sat at (120, 110) before and must still sit there.
    expect(outer.position.x + wrapper.position.x + a.position.x).toBe(120)
    expect(outer.position.y + wrapper.position.y + a.position.y).toBe(110)
  })

  /**
   * The pure arithmetic above can be perfectly right while the canvas is wrong: a wrapper is
   * created at (minX - 28, minY - 62) RELATIVE to its new parent — routinely negative — and
   * carries `extent: 'parent'`. React Flow then clamps it into `[0, parentSize - wrapperSize]`,
   * which for a wrapper bigger than its parent is an inverted range: the frame snaps hundreds of
   * px away and drags the whole wrapped subtree with it. So assert the FRAME FITS, not just that
   * the offsets add up. Fails without the ancestor re-fit.
   */
  it('grows the parent frame so the new wrapper fits inside it', () => {
    const nodes = [
      grp('outer', { x: 100, y: 80 }),
      grp('a', { x: 20, y: 30 }, 'outer'),
      grp('b', { x: 500, y: 60 }, 'outer')
    ]
    const out = groupSelectedNodes(nodes, ['a', 'b'], 3)
    const outer = out.find((node) => node.id === 'outer')!
    const wrapper = out.find((node) => !nodes.some((old) => old.id === node.id))!
    expect(wrapper.position.x).toBeGreaterThanOrEqual(0)
    expect(wrapper.position.y).toBeGreaterThanOrEqual(0)
    expect(wrapper.position.x + (wrapper.width as number)).toBeLessThanOrEqual(
      outer.width as number
    )
    expect(wrapper.position.y + (wrapper.height as number)).toBeLessThanOrEqual(
      outer.height as number
    )
  })

  it('grows every ancestor frame, not just the immediate parent', () => {
    const nodes = [
      grp('root', { x: 0, y: 0 }),
      grp('outer', { x: 10, y: 10 }, 'root'),
      grp('a', { x: 20, y: 30 }, 'outer'),
      grp('b', { x: 500, y: 60 }, 'outer')
    ]
    const out = groupSelectedNodes(nodes, ['a', 'b'], 4)
    const root = out.find((node) => node.id === 'root')!
    const outer = out.find((node) => node.id === 'outer')!
    expect(outer.position.x).toBeGreaterThanOrEqual(0)
    expect(outer.position.x + (outer.width as number)).toBeLessThanOrEqual(root.width as number)
    expect(outer.position.y + (outer.height as number)).toBeLessThanOrEqual(root.height as number)
  })
})

describe('ungroupNodes', () => {
  it('removes the frame and restores children to absolute positions', () => {
    const nodes = [grp('g1', { x: 50, y: 50 }), term('t1', { x: 10, y: 10 }, 'g1')]
    const out = ungroupNodes(nodes, 'g1')
    expect(out.find((n) => n.id === 'g1')).toBeUndefined()
    const t1 = out.find((n) => n.id === 't1')!
    expect(t1.parentId).toBeUndefined()
    expect(t1.extent).toBeUndefined()
    expect(t1.position).toEqual({ x: 60, y: 60 })
  })

  it('round-trips with groupSelectedNodes', () => {
    const nodes = [term('t1', { x: 100, y: 100 }), term('t2', { x: 500, y: 300 })]
    const grouped = groupSelectedNodes(nodes, ['t1', 't2'], 0)
    const out = ungroupNodes(grouped, grouped[0].id)
    expect(out.find((n) => n.id === 't1')!.position).toEqual({ x: 100, y: 100 })
    expect(out.find((n) => n.id === 't2')!.position).toEqual({ x: 500, y: 300 })
  })

  it("promotes direct children into the removed group's parent without moving them", () => {
    const nodes = [
      grp('outer', { x: 100, y: 80 }),
      grp('inner', { x: 30, y: 40 }, 'outer'),
      term('leaf', { x: 10, y: 12 }, 'inner')
    ]
    const out = ungroupNodes(nodes, 'inner')
    const leaf = out.find((node) => node.id === 'leaf')!
    expect(leaf.parentId).toBe('outer')
    expect(leaf.position).toEqual({ x: 40, y: 52 })
  })

  it('is a no-op when the group is missing', () => {
    const nodes = [term('t1', { x: 0, y: 0 })]
    expect(ungroupNodes(nodes, 'nope')).toBe(nodes)
  })
})

describe('nested group persistence order', () => {
  it('hydrates every parent group before its descendants even from reversed persisted order', () => {
    const live = [
      grp('outer', { x: 100, y: 80 }),
      grp('inner', { x: 30, y: 40 }, 'outer'),
      term('leaf', { x: 10, y: 12 }, 'inner')
    ]
    const hydrated = nodeStatesToFlow(flowToNodeStates(live).reverse())
    expect(hydrated.findIndex((node) => node.id === 'outer')).toBeLessThan(
      hydrated.findIndex((node) => node.id === 'inner')
    )
    expect(hydrated.findIndex((node) => node.id === 'inner')).toBeLessThan(
      hydrated.findIndex((node) => node.id === 'leaf')
    )
  })

  it('hydrates groups with the label-only drag handle', () => {
    const [group] = nodeStatesToFlow(flowToNodeStates([grp('outer', { x: 0, y: 0 })]))
    expect(group.dragHandle).toBe('.group-node__label')
  })
})

describe('reorderGroupWithinParent', () => {
  it('moves a nested group subtree before a sibling without changing geometry or parenting', () => {
    const nodes = [
      grp('outer', { x: 0, y: 0 }),
      grp('a', { x: 10, y: 10 }, 'outer'),
      grp('a-child', { x: 5, y: 5 }, 'a'),
      grp('b', { x: 20, y: 20 }, 'outer'),
      term('inside-a', { x: 2, y: 3 }, 'a')
    ]
    const out = reorderGroupWithinParent(nodes, 'b', 'outer', 'a')
    expect(out.map((node) => node.id)).toEqual(['outer', 'b', 'a', 'a-child', 'inside-a'])
    expect(out.find((node) => node.id === 'b')).toMatchObject({
      parentId: 'outer',
      position: { x: 20, y: 20 }
    })
  })

  it('appends a whole group subtree after its last sibling', () => {
    const nodes = [
      grp('a', { x: 0, y: 0 }),
      grp('a-child', { x: 0, y: 0 }, 'a'),
      grp('b', { x: 0, y: 0 }),
      term('inside-a', { x: 0, y: 0 }, 'a')
    ]
    expect(reorderGroupWithinParent(nodes, 'a', null, null).map((node) => node.id)).toEqual([
      'b',
      'a',
      'a-child',
      'inside-a'
    ])
  })

  it('rejects cross-parent and invalid-target reorders', () => {
    const nodes = [
      grp('outer', { x: 0, y: 0 }),
      grp('a', { x: 0, y: 0 }, 'outer'),
      grp('b', { x: 0, y: 0 })
    ]
    expect(reorderGroupWithinParent(nodes, 'a', null, 'b')).toBe(nodes)
    expect(reorderGroupWithinParent(nodes, 'a', 'outer', 'missing')).toBe(nodes)
  })
})

describe('reorderNodeBefore', () => {
  const ids = (out: CanvasNode[]): string[] => out.filter((n) => n.type !== 'group').map((n) => n.id)

  it('reorders within the same container (moves dragged before target)', () => {
    const nodes = [term('a', { x: 0, y: 0 }), term('b', { x: 0, y: 0 }), term('c', { x: 0, y: 0 })]
    expect(ids(reorderNodeBefore(nodes, 'c', 'a'))).toEqual(['c', 'a', 'b'])
    expect(ids(reorderNodeBefore(nodes, 'a', 'c'))).toEqual(['b', 'a', 'c'])
  })

  it('keeps position unchanged for a same-container reorder', () => {
    const nodes = [term('a', { x: 5, y: 5 }), term('b', { x: 9, y: 9 })]
    const out = reorderNodeBefore(nodes, 'b', 'a')
    expect(out.find((n) => n.id === 'b')!.position).toEqual({ x: 9, y: 9 })
  })

  it('moves across containers (joins target group) and lands before the target', () => {
    const nodes = [
      grp('g1', { x: 50, y: 50 }),
      term('t1', { x: 10, y: 10 }, 'g1'),
      term('t2', { x: 200, y: 150 }) // ungrouped
    ]
    const out = reorderNodeBefore(nodes, 't2', 't1')
    const t2 = out.find((n) => n.id === 't2')!
    expect(t2.parentId).toBe('g1')
    expect(t2.position).toEqual({ x: 150, y: 100 }) // 200-50, 150-50
    expect(ids(out)).toEqual(['t2', 't1']) // t2 placed before t1
  })

  it('keeps group nodes first and is a no-op for same/ missing / group drags', () => {
    const nodes = [grp('g1', { x: 0, y: 0 }), term('a', { x: 0, y: 0 }), term('b', { x: 0, y: 0 })]
    expect(reorderNodeBefore(nodes, 'a', 'a')).toBe(nodes)
    expect(reorderNodeBefore(nodes, 'nope', 'a')).toBe(nodes)
    expect(reorderNodeBefore(nodes, 'g1', 'a')).toBe(nodes) // can't drag a group row
    const out = reorderNodeBefore(nodes, 'b', 'a')
    expect(out[0].id).toBe('g1')
  })
})

describe('reorderGroupWithinParent', () => {
  it('moves a nested group subtree before a sibling without changing geometry or parenting', () => {
    const nodes = [
      grp('outer', { x: 0, y: 0 }),
      grp('a', { x: 10, y: 10 }, 'outer'),
      grp('a-child', { x: 5, y: 5 }, 'a'),
      grp('b', { x: 20, y: 20 }, 'outer'),
      term('inside-a', { x: 2, y: 3 }, 'a')
    ]
    const out = reorderGroupWithinParent(nodes, 'b', 'outer', 'a')
    expect(out.map((node) => node.id)).toEqual(['outer', 'b', 'a', 'a-child', 'inside-a'])
    expect(out.find((node) => node.id === 'b')).toMatchObject({
      parentId: 'outer',
      position: { x: 20, y: 20 }
    })
  })

  it('appends a whole group subtree after its last sibling', () => {
    const nodes = [
      grp('a', { x: 0, y: 0 }),
      grp('a-child', { x: 0, y: 0 }, 'a'),
      grp('b', { x: 0, y: 0 }),
      term('inside-a', { x: 0, y: 0 }, 'a')
    ]
    expect(reorderGroupWithinParent(nodes, 'a', null, null).map((node) => node.id)).toEqual([
      'b',
      'a',
      'a-child',
      'inside-a'
    ])
  })

  it('rejects cross-parent and invalid-target reorders', () => {
    const nodes = [
      grp('outer', { x: 0, y: 0 }),
      grp('a', { x: 0, y: 0 }, 'outer'),
      grp('b', { x: 0, y: 0 })
    ]
    expect(reorderGroupWithinParent(nodes, 'a', null, 'b')).toBe(nodes)
    expect(reorderGroupWithinParent(nodes, 'a', 'outer', 'missing')).toBe(nodes)
  })
})

describe('group worktree serialization', () => {
  it('round-trips data.worktree on a group node', () => {
    const group = {
      id: 'group_1',
      type: 'group',
      position: { x: 0, y: 0 },
      width: 400,
      height: 300,
      data: {
        title: 'G',
        color: '#fff',
        group: null,
        worktree: {
          repoPath: '/repo',
          branch: 'feature/x',
          baseRef: 'main',
          path: '/wt/feature-x',
          createdByApp: true
        }
      }
    } as unknown as CanvasNode

    const states = flowToNodeStates([group])
    expect(states[0].worktree).toEqual(group.data.worktree)

    const back = nodeStatesToFlow(states)
    expect(back[0].data.worktree).toEqual(group.data.worktree)
  })

  it('leaves worktree undefined for unbound groups', () => {
    const group = {
      id: 'group_2', type: 'group', position: { x: 0, y: 0 }, width: 1, height: 1,
      data: { title: 'G', color: '#fff', group: null }
    } as unknown as CanvasNode
    expect(flowToNodeStates([group])[0].worktree).toBeUndefined()
  })
})

describe('resolveNewNodeAccount', () => {
  const accounts = [{ id: 'a1', label: 'work', createdAt: 0 }]
  it('prefers the explicit pick', () =>
    expect(resolveNewNodeAccount('a1', { defaultAccountId: 'a2' }, accounts)).toBe('a1'))
  it('falls back to the project default', () =>
    expect(resolveNewNodeAccount(undefined, { defaultAccountId: 'a1' }, accounts)).toBe('a1'))
  it('drops ids that no longer exist', () =>
    expect(resolveNewNodeAccount('gone', { defaultAccountId: 'gone' }, accounts)).toBeUndefined())
  it('undefined when nothing set', () =>
    expect(resolveNewNodeAccount(undefined, {}, accounts)).toBeUndefined())
  it('undefined when the project is undefined', () =>
    expect(resolveNewNodeAccount(undefined, undefined, accounts)).toBeUndefined())
})

describe('accountId on Claude node factories', () => {
  it('stamps accountId onto a Claude agent node', () => {
    const node = createAgentNode('claude', 0, undefined, undefined, undefined, undefined, 'a1')
    expect(node.data.accountId).toBe('a1')
  })
  it('does not stamp accountId onto a non-Claude agent node', () => {
    const node = createAgentNode('codex', 0, undefined, undefined, undefined, undefined, 'a1')
    expect(node.data.accountId).toBeUndefined()
    expect(node.data.codexAccountId).toBe('a1')
  })
  it('omits accountId when none is given', () => {
    const node = createAgentNode('claude', 0)
    expect(node.data.accountId).toBeUndefined()
  })
})

describe('Codex account node factories', () => {
  it('creates a login terminal inside only the selected CODEX_HOME', () => {
    const node = createCodexAccountLoginNode('codex-a', 0)
    expect(node.data).toMatchObject({
      title: 'Codex login',
      codexAccountId: 'codex-a'
    })
    // No `cd &&` chain locally: `&&` is a parse error in Windows PowerShell 5.1, and core already
    // starts an unset cwd in os.homedir(), so the bare command lands in home on every platform.
    expect(node.data.initialCommand).toMatch(/^codex /)
    expect(node.data.initialCommand).not.toContain('&&')
    expect(node.data.initialCommand).toContain('login --device-auth')
  })

  it('keeps the cd chain on SSH, where the cwd is the remote project dir and the shell is POSIX', () => {
    const node = createCodexAccountLoginNode('codex-a', 0, undefined, {
      server: { host: 'h', user: 'u' },
      remoteCwd: '/srv/app'
    } as Parameters<typeof createCodexAccountLoginNode>[3])
    expect(node.data.initialCommand).toMatch(/^cd "\$HOME" && codex /)
    expect(node.data.initialCommand).toContain('login --device-auth')
  })
})

describe('canvas-control terminal compatibility', () => {
  it('promotes an exact direct Codex resume to an account-aware agent node', () => {
    const node = createCanvasControlTerminalNode(
      0,
      '/repo',
      undefined,
      'codex resume thread-a',
      undefined,
      'codex-a'
    )
    expect(node.data).toMatchObject({
      agentId: 'codex',
      codexAccountId: 'codex-a',
      cwd: '/repo',
      initialCommand: 'codex resume thread-a',
      agentLaunchIntent: {
        kind: 'agent',
        action: 'resume',
        agentId: 'codex',
        sessionId: 'thread-a'
      },
      agentSessionId: 'thread-a'
    })
  })

  it('keeps non-exact commands as plain terminal nodes', () => {
    const node = createCanvasControlTerminalNode(
      0,
      '/repo',
      undefined,
      'codex resume thread-a; echo done',
      undefined,
      'codex-a'
    )
    expect(node.data.agentId).toBeUndefined()
    expect(node.data.codexAccountId).toBeUndefined()
    expect(node.data.initialCommand).toBe('codex resume thread-a; echo done')
  })

  it('uses the managed launcher for a promoted resume only after shared identity is proven', () => {
    resetCodexIdentityCapsForTests({
      shared: true,
      launcherPath: 'C:\\nodeterm\\nodeterm-codex.cmd',
      remoteFlag: true,
      appServer: true
    })
    const node = createCanvasControlTerminalNode(
      0,
      '/repo',
      undefined,
      'codex resume thread-a',
      undefined,
      'codex-a'
    )
    expect(node.data.initialCommand).toBe('nodeterm-codex resume thread-a')
  })
})

describe('accountId serialization', () => {
  it('round-trips data.accountId on a terminal node', () => {
    const node = {
      id: 'term-1',
      type: 'terminal',
      position: { x: 0, y: 0 },
      width: 600,
      height: 400,
      data: { title: 'T', color: '#888', group: null, agentId: 'claude', accountId: 'a1' }
    } as unknown as CanvasNode
    const states = flowToNodeStates([node])
    expect(states[0].accountId).toBe('a1')
    const back = nodeStatesToFlow(states)
    expect(back[0].data.accountId).toBe('a1')
  })
  it('round-trips data.codexAccountId on a Codex terminal node', () => {
    const node = {
      id: 'codex-term-1',
      type: 'terminal',
      position: { x: 0, y: 0 },
      width: 600,
      height: 400,
      data: {
        title: 'Codex',
        color: '#888',
        group: null,
        agentId: 'codex',
        codexAccountId: 'codex-a'
      }
    } as unknown as CanvasNode
    const states = flowToNodeStates([node])
    expect(states[0].codexAccountId).toBe('codex-a')
    const back = nodeStatesToFlow(states)
    expect(back[0].data.codexAccountId).toBe('codex-a')
  })
  it('leaves accountId undefined when unset', () => {
    const node = {
      id: 'term-2', type: 'terminal', position: { x: 0, y: 0 }, width: 1, height: 1,
      data: { title: 'T', color: '#888', group: null }
    } as unknown as CanvasNode
    expect(flowToNodeStates([node])[0].accountId).toBeUndefined()
  })
})

describe('nodeSshFor', () => {
  const projectSsh = {
    server: { host: 'h', user: 'u' },
    remoteCwd: '/srv/app'
  } as unknown as NonNullable<Parameters<typeof nodeSshFor>[0]>

  it('is undefined for a local project, so nothing changes there', () => {
    expect(nodeSshFor(undefined)).toBeUndefined()
    expect(nodeSshFor(undefined, '/some/dir')).toBeUndefined()
  })

  it('threads the caller cwd through remoteCwd — the factories read a node cwd from there', () => {
    // Passing the project's ssh unchanged would silently replace an explicit --cwd with the
    // project root, which is the second half of this bug.
    expect(nodeSshFor(projectSsh, '/srv/app/sub')).toEqual({
      server: projectSsh.server,
      remoteCwd: '/srv/app/sub'
    })
  })

  it('falls back to the project root when no cwd is given', () => {
    expect(nodeSshFor(projectSsh)).toEqual({ server: projectSsh.server, remoteCwd: '/srv/app' })
    expect(nodeSshFor(projectSsh, '')).toEqual({ server: projectSsh.server, remoteCwd: '/srv/app' })
  })

  it('produces a node that actually runs on the host (remote tmux, remote cwd)', () => {
    const node = createAgentNode('claude', 0, undefined, undefined, undefined, nodeSshFor(projectSsh, '/srv/app/sub'))
    expect(node.data.sshRemoteTmux).toBe(true)
    expect(node.data.ssh).toEqual(projectSsh.server)
    expect(node.data.cwd).toBe('/srv/app/sub')
  })
})

describe('pendingLaunch round-trip', () => {
  // Unlike initialCommand (one-shot, deliberately NOT persisted), an armed node's held launch
  // must survive a reload — the station it waits on can take hours, and a restart in between
  // must not silently turn the node into an idle shell that never runs anything.
  it('persists the held launch and its dependencies', () => {
    const node = {
      id: 'term-3',
      type: 'terminal',
      position: { x: 0, y: 0 },
      width: 600,
      height: 400,
      data: {
        title: 'T',
        color: '#888',
        group: null,
        agentId: 'claude',
        pendingLaunch: { after: ['term-1', 'term-2'], command: 'claude "go"' }
      }
    } as unknown as CanvasNode
    const states = flowToNodeStates([node])
    expect(states[0].pendingLaunch).toEqual({ after: ['term-1', 'term-2'], command: 'claude "go"' })
    expect(nodeStatesToFlow(states)[0].data.pendingLaunch).toEqual({
      after: ['term-1', 'term-2'],
      command: 'claude "go"'
    })
  })

  it('stays undefined for an ordinary node', () => {
    const node = {
      id: 'term-4', type: 'terminal', position: { x: 0, y: 0 }, width: 1, height: 1,
      data: { title: 'T', color: '#888', group: null, initialCommand: 'claude' }
    } as unknown as CanvasNode
    const states = flowToNodeStates([node])
    expect(states[0].pendingLaunch).toBeUndefined()
    // initialCommand is still not persisted — arming is what makes a launch durable.
    expect((states[0] as { initialCommand?: string }).initialCommand).toBeUndefined()
  })
})

describe('createAccountLoginNode', () => {
  it('produces a terminal node that logs the given account in', () => {
    const node = createAccountLoginNode('acct-1', 0)
    expect(node.type).toBe('terminal')
    expect(node.data.title).toBe('Claude login')
    expect(node.data.accountId).toBe('acct-1')
    expect(node.data.initialCommand).toBe('claude /login')
  })
})

describe('dino node serialization', () => {
  it('round-trips a dino node and its highScore', () => {
    const dino = {
      id: 'dino-1',
      type: 'dino',
      position: { x: 10, y: 20 },
      width: 600,
      height: 200,
      data: { title: 'Dino', color: '#a2a2a2', group: null, highScore: 1337 }
    } as unknown as CanvasNode

    const states = flowToNodeStates([dino])
    expect(states[0].kind).toBe('dino')
    expect(states[0].highScore).toBe(1337)

    const back = nodeStatesToFlow(states)
    expect(back[0].type).toBe('dino')
    expect(back[0].data.highScore).toBe(1337)
  })

  it('createDinoNode produces a dino node with highScore 0', () => {
    const node = createDinoNode(0)
    expect(node.type).toBe('dino')
    expect(node.data.highScore).toBe(0)
    expect(node.width).toBe(600)
  })
})

describe('annotation node (issue #145 — line/arrow drawing tool)', () => {
  const rect: AnnotationRect = {
    position: { x: 40, y: 60 },
    size: { width: 200, height: 120 },
    dir: 'tl-br'
  }

  it('createAnnotationNode places a line at the drawn rect with a palette color', () => {
    const node = createAnnotationNode(rect, 'line', 1)
    expect(node.type).toBe('annotation')
    expect(node.position).toEqual({ x: 40, y: 60 })
    expect(node.width).toBe(200)
    expect(node.height).toBe(120)
    expect(node.data.annotationVariant).toBe('line')
    expect(node.data.annotationDir).toBe('tl-br')
    expect(node.data.title).toBe('Line')
    // Colored from the shared palette like every other node, never hard-coded.
    expect(node.data.color).toBe(NODE_COLORS[1 % NODE_COLORS.length])
  })

  it('createAnnotationNode places an arrow and records the opposite diagonal', () => {
    const node = createAnnotationNode({ ...rect, dir: 'tr-bl' }, 'arrow', 0)
    expect(node.data.annotationVariant).toBe('arrow')
    expect(node.data.annotationDir).toBe('tr-bl')
    expect(node.data.title).toBe('Arrow')
  })

  it('is NEVER an edge: it carries no source/target and is a plain node like a sticky or group', () => {
    const node = createAnnotationNode(rect, 'arrow', 0)
    expect(node).not.toHaveProperty('source')
    expect(node).not.toHaveProperty('target')
    expect(node).not.toHaveProperty('sourceHandle')
    expect(node).not.toHaveProperty('targetHandle')
  })

  it('round-trips an annotation node through the persisted-state serializers', () => {
    const node = createAnnotationNode(rect, 'arrow', 2)
    const states = flowToNodeStates([node])
    expect(states[0].kind).toBe('annotation')
    expect(states[0].annotationVariant).toBe('arrow')
    expect(states[0].annotationDir).toBe('tl-br')
    expect(states[0].position).toEqual({ x: 40, y: 60 })
    expect(states[0].size).toEqual({ width: 200, height: 120 })

    const back = nodeStatesToFlow(states)
    expect(back[0].type).toBe('annotation')
    expect(back[0].data.annotationVariant).toBe('arrow')
    expect(back[0].data.annotationDir).toBe('tl-br')
    expect(back[0].data.color).toBe(node.data.color)
  })

  it('falls back to a sane default box when a legacy/hand-edited record has no size', () => {
    // Mirrors the dino/chat migration tests above: a project.json is hand-editable, so a
    // malformed annotation record must still hydrate into something clickable rather than crash.
    const states = flowToNodeStates([
      { ...createAnnotationNode(rect, 'line', 0), width: undefined, height: undefined } as unknown as CanvasNode
    ])
    expect(states[0].size.width).toBeGreaterThan(0)
    expect(states[0].size.height).toBeGreaterThan(0)
  })

  it('duplicateNode keeps an annotation an annotation (not silently demoted to a terminal)', () => {
    const node = createAnnotationNode(rect, 'arrow', 0)
    const copy = duplicateNode(node)
    expect(copy.type).toBe('annotation')
    expect(copy.id).not.toBe(node.id)
    expect(copy.data.annotationVariant).toBe('arrow')
    expect(copy.data.annotationDir).toBe('tl-br')
    // Duplicating never carries execution/session state — irrelevant here, but the same contract
    // every other kind gets.
    expect(copy.data.initialCommand).toBeUndefined()
  })

  it('an empty colored area is just createGroupNode placed at the drawn rect — no new node kind', () => {
    // The "coloured area" tool deliberately reuses the existing group frame rather than inventing
    // a second decorative box kind: a group with zero children already renders as a plain dashed
    // colored frame (GroupNode.tsx), which IS the "area" the issue asks for.
    const group = createGroupNode(rect.position, rect.size, 0)
    expect(group.type).toBe('group')
    expect(group.position).toEqual(rect.position)
    expect(group.width).toBe(rect.size.width)
    expect(group.height).toBe(rect.size.height)
    expect(group.parentId).toBeUndefined()
  })
})

describe('chat node tombstone', () => {
  it('converts a persisted chat node into a sticky with the resume hint', () => {
    const flow = nodeStatesToFlow([
      {
        id: 'chat-1', kind: 'chat', x: 10, y: 20, width: 420, height: 520,
        title: 'API brainstorm', color: '#8b5cf6', chatSessionId: 'sess-abc123'
      } as any
    ])
    expect(flow).toHaveLength(1)
    const n = flow[0]
    expect(n.type).toBe('sticky')
    expect(n.position).toEqual({ x: 10, y: 20 })
    expect(n.data.title).toBe('API brainstorm')
    expect(String(n.data.text)).toContain('claude --resume sess-abc123')
  })
  it('converts a chat node without a session id into a plain explanatory sticky', () => {
    const flow = nodeStatesToFlow([{ id: 'chat-2', kind: 'chat', x: 0, y: 0 } as any])
    expect(flow[0].type).toBe('sticky')
    expect(String(flow[0].data.text)).toContain('removed')
    expect(String(flow[0].data.text)).not.toContain('--resume')
  })
})

describe('createAgentNode permission mode', () => {
  it('appends the flag for claude', () => {
    const node = createAgentNode(
      'claude', 0, undefined, undefined, undefined, undefined, undefined,
      launchPlan('claude', 'auto')
    )
    expect(node.data.initialCommand).toBe('claude --permission-mode auto')
  })

  it('stays bare in manual mode (legacy parity)', () => {
    const node = createAgentNode(
      'claude', 0, undefined, undefined, undefined, undefined, undefined,
      launchPlan('claude', 'manual')
    )
    expect(node.data.initialCommand).toBe('claude')
  })

  it('stays bare when no mode is passed at all (legacy parity)', () => {
    const node = createAgentNode('claude', 0)
    expect(node.data.initialCommand).toBe('claude')
  })

  it('keeps the flag after the initial prompt so the prompt stays claude argv', () => {
    const node = createAgentNode(
      'claude', 0, undefined, undefined, 'fix the bug', undefined, undefined,
      launchPlan('claude', 'auto')
    )
    expect(node.data.initialCommand).toBe("claude 'fix the bug' --permission-mode auto")
  })

  // opencode has no approval flag at all, and a custom agent is in no capability list. codex and
  // gemini DO have one, each spelled its own way — those composed commands are pinned in
  // workspace.agent-prompt.test.ts, next to grok's separator rule.
  it('never flags a non-capable agent', () => {
    const node = createAgentNode(
      'opencode', 0, undefined, undefined, undefined, undefined, undefined,
      launchPlan('opencode', 'auto')
    )
    expect(node.data.initialCommand).toBe('opencode')
    const custom = createAgentNode(
      'custom:x', 0, undefined, undefined, undefined, undefined, undefined,
      launchPlan('custom:x', 'auto')
    )
    expect(custom.data.initialCommand).toBe('custom:x')
  })

  it('uses native codex for an SSH project node', () => {
    const ssh = { server: { host: 'example.test', user: 'tester' } } as any
    const node = createAgentNode('codex', 0, undefined, undefined, undefined, ssh)
    expect(node.data.initialCommand).toBe('codex')
  })
})

describe('createAgentNode prompt injection', () => {
  it('uses --prompt for flag-prompt agents (opencode)', () => {
    const n = createAgentNode('opencode', 0, undefined, undefined, "rerank the results")
    expect(n.data.initialCommand).toBe("opencode --prompt 'rerank the results'")
  })
  it('shell-quotes a flag-prompt safely', () => {
    const n = createAgentNode('opencode', 0, undefined, undefined, "it's tricky")
    expect(n.data.initialCommand).toBe("opencode --prompt 'it'\\''s tricky'")
  })
  it('keeps argv injection byte-identical for codex and gemini', () => {
    expect(createAgentNode('codex', 0, undefined, undefined, 'do X').data.initialCommand).toBe(
      "codex 'do X'"
    )
    expect(createAgentNode('gemini', 0, undefined, undefined, 'do X').data.initialCommand).toBe("gemini 'do X'")
    resetCodexIdentityCapsForTests({
      shared: true,
      launcherPath: codexRemoteCommand(),
      remoteFlag: true,
      appServer: true
    })
    // A LOCAL shared-identity node reaches its launcher BY NAME, because pty-manager prepends
    // `codexLauncherDir()` to that one session's PATH (and explicitly does not when `sshRemote`
    // is set). Asserting the absolute `codexRemoteCommand()` here would pin the wrong contract
    // twice over: it is the REMOTE form, and the directory it names (`$HOME/.nodeterm/bin`) is
    // not even where the local launcher is installed (`userDataDir/codex-bin`) — nor would
    // `$HOME` expand for a local Windows spawn. The remote form is applied at the remote seam
    // instead, from the host's own preflight-resolved `sshRemote.codexLauncherPath`.
    expect(createAgentNode('codex', 0, undefined, undefined, 'do X').data.initialCommand).toBe(
      `${agentLaunchProgram('codex', 'codex', true)} 'do X'`
    )
    expect(agentLaunchProgram('codex', 'codex', true)).not.toBe(codexRemoteCommand())
  })
})

describe('duplicateNode across every node kind', () => {
  /** Minimal node of a given kind. `data` carries whatever that kind needs to be itself. */
  const nodeOf = (kind: NodeKind, data: Record<string, unknown> = {}): CanvasNode =>
    ({
      id: `${kind}-source`,
      type: kind,
      position: { x: 100, y: 200 },
      width: 320,
      height: 240,
      data: { title: `a ${kind}`, color: '#888', group: null, ...data }
    }) as unknown as CanvasNode

  // `Record<NodeKind, …>` rather than an array: adding a kind to the union is a typecheck error
  // here until it is given an expected id prefix, so a new kind cannot join without being
  // covered. The prefixes are the ones the factories in workspace.ts actually mint.
  const EXPECTED_PREFIX: Record<NodeKind, string> = {
    terminal: 'term',
    sticky: 'sticky',
    group: 'group',
    editor: 'editor',
    diff: 'diff',
    video: 'video',
    web: 'web',
    browser: 'browser',
    subagent: 'subagent',
    loop: 'loop',
    scheduler: 'scheduler',
    dino: 'dino',
    annotation: 'annotation',
    // The service family. Each prefix is the kind's own name, and none of them is `term` — that is
    // the point, not an aesthetic: `SAFE_NODE_ID` in core/project-node-append.ts is /^term-…/ and it
    // decides whether an incoming id may register as a real terminal session, so a manager wearing
    // that prefix could be pushed through as a shell by a peer or the mobile append path.
    minecraft: 'minecraft',
    dockerhost: 'dockerhost',
    proxmox: 'proxmox',
    gitlab: 'gitlab',
    homeassistant: 'homeassistant',
    freepbx: 'freepbx'
  }
  const ALL_KINDS = Object.keys(EXPECTED_PREFIX) as NodeKind[]

  it.each(ALL_KINDS)('keeps a %s a %s, with a matching id prefix', (kind) => {
    // The prefix half is the regression: `kind` used to collapse everything except sticky/group/
    // annotation to `terminal`, so an editor/diff/video/web/browser/dino/Loop copy was minted a
    // `term-…` id — the exact shape `SAFE_NODE_ID` (core/project-node-append) accepts as a
    // registered TERMINAL session. The type itself always survived, on the `...node` spread.
    const copy = duplicateNode(nodeOf(kind))
    expect(copy.type).toBe(kind)
    expect(copy.id.startsWith(`${EXPECTED_PREFIX[kind]}-`)).toBe(true)
    expect(copy.id).not.toBe(`${kind}-source`)
  })

  it('falls back to a terminal only for a type that is not a kind at all', () => {
    // A hand-edited project.json or a record from a newer build reaches here as a plain string;
    // the removed `chat` kind is the real historical case.
    for (const bogus of ['chat', 'not-a-kind', '']) {
      const copy = duplicateNode({ ...nodeOf('terminal'), type: bogus } as unknown as CanvasNode)
      expect(copy.type).toBe('terminal')
      expect(copy.id.startsWith('term-')).toBe(true)
    }
    const noType = duplicateNode({ ...nodeOf('terminal'), type: undefined } as unknown as CanvasNode)
    expect(noType.type).toBe('terminal')
  })

  it('does not accept a prototype key as a node kind', () => {
    // The lookup is a Set, not `type in table`: `in` walks the prototype, so `constructor` and
    // `toString` would both pass as kinds — and would then be spliced into a minted node id.
    for (const key of ['constructor', 'toString', 'hasOwnProperty']) {
      const copy = duplicateNode({ ...nodeOf('terminal'), type: key } as unknown as CanvasNode)
      expect(copy.type).toBe('terminal')
      expect(copy.id.startsWith('term-')).toBe(true)
    }
  })

  it('keeps the content identity that makes a duplicate worth having', () => {
    const editor = duplicateNode(
      nodeOf('editor', { filePath: '/repo/src/a.ts', sshFs: true, fileMissing: true })
    )
    expect(editor.type).toBe('editor')
    expect(editor.data.filePath).toBe('/repo/src/a.ts')
    expect(editor.data.sshFs).toBe(true)
    // `fileMissing` is a fact about the FILESYSTEM, not about the source node: the file is just
    // as gone for the copy. Clearing it would make the copy claim a deleted file is there and
    // try to read it, which is strictly worse than the honest notice.
    expect(editor.data.fileMissing).toBe(true)

    const diff = duplicateNode(
      nodeOf('diff', {
        cwd: '/repo',
        filePath: 'src/a.ts',
        diffStaged: true,
        commitOid: 'abc1234def'
      })
    )
    expect(diff.type).toBe('diff')
    // A diff node is a VIEW of one commit's diff; a duplicate is a second view of the same one,
    // exactly as an editor duplicate is a second view of the same file.
    expect(diff.data.commitOid).toBe('abc1234def')
    expect(diff.data.cwd).toBe('/repo')
    expect(diff.data.filePath).toBe('src/a.ts')
    expect(diff.data.diffStaged).toBe(true)

    const web = duplicateNode(nodeOf('web', { url: 'https://example.com' }))
    expect(web.data.url).toBe('https://example.com')

    const video = duplicateNode(nodeOf('video', { filePath: '/repo/clip.mp4', sshFs: true }))
    expect(video.data.filePath).toBe('/repo/clip.mp4')
    expect(video.data.sshFs).toBe(true)

    const sticky = duplicateNode(nodeOf('sticky', { text: 'remember this' }))
    expect(sticky.data.text).toBe('remember this')

    // The project's record, seeded onto the node — a duplicate showing the same record is right.
    const dino = duplicateNode(nodeOf('dino', { highScore: 412 }))
    expect(dino.data.highScore).toBe(412)

    const annotation = duplicateNode(
      nodeOf('annotation', { annotationVariant: 'arrow', annotationDir: 'tr-bl' })
    )
    expect(annotation.data.annotationVariant).toBe('arrow')
    expect(annotation.data.annotationDir).toBe('tr-bl')
  })

  it('does not hand a browser copy the agent control grant on the source tab', () => {
    // `browserOwnerNodeId` is authority, not provenance: it is the agent allowed to drive this
    // tab through the Browser Plugin. An agent propagates its OWN grant when it opens a popup;
    // a user duplicating a node must not silently give that agent a tab it never opened. This was
    // live before — the copy was already a real browser node, so it already registered itself
    // with the source's owner (BrowserSurface → `browser.register`).
    const copy = duplicateNode(
      nodeOf('browser', { url: 'https://example.com', browserOwnerNodeId: 'term-agent-1' })
    )
    expect(copy.type).toBe('browser')
    expect(copy.data.url).toBe('https://example.com')
    expect(copy.data.browserOwnerNodeId).toBeUndefined()
  })

  it('copies a Loop node paused, with its config but not its run', () => {
    // Canvas's scheduler sweep fires every `loopEnabled` node, and the copy was already a real
    // scheduler node — so duplicating a RUNNING Loop already produced a second live scheduler
    // pushing the same prompt at the same agents on the same cadence, silently doubling the
    // traffic. The most consequential thing this change fixes.
    const copy = duplicateNode(
      nodeOf('scheduler', {
        loopTask: 'sweep the issues',
        loopIntervalMs: 900_000,
        loopTargetIds: ['term-a', 'term-b'],
        loopEnabled: true,
        loopNextRunAt: 1_770_000_000_000,
        loopLastRunAt: 1_769_999_000_000
      })
    )
    expect(copy.type).toBe('scheduler')
    // Config is what the user duplicating a Loop wants.
    expect(copy.data.loopTask).toBe('sweep the issues')
    expect(copy.data.loopIntervalMs).toBe(900_000)
    expect(copy.data.loopTargetIds).toEqual(['term-a', 'term-b'])
    // The run is not.
    expect(copy.data.loopEnabled).toBeFalsy()
    expect(copy.data.loopNextRunAt).toBeUndefined()
    expect(copy.data.loopLastRunAt).toBeUndefined()
  })

  it('never lets a copied frame claim the source frame worktree binding', () => {
    // A binding is 1:1 with one checkout on disk and the destructive Merge/Remove paths are keyed
    // on it, so a second claimant could remove the directory the ORIGINAL frame still works in.
    const source = nodeOf('group', {
      worktree: {
        repoPath: '/repo',
        branch: 'feature/x',
        baseRef: 'main',
        path: '/repo/.worktrees/x',
        createdByApp: true
      }
    })
    const copy = duplicateNode(source)
    expect(copy.type).toBe('group')
    expect(copy.data.worktree).toBeUndefined()
    // The source keeps its own binding — the copy must not cost the original anything.
    expect((source.data.worktree as { path: string }).path).toBe('/repo/.worktrees/x')
  })

  it('clears the one-shot respawn trigger', () => {
    // Local-only and never serialized: the number means something only as a CHANGE, so a copy
    // born holding the source's counter is stale from birth.
    const copy = duplicateNode(nodeOf('terminal', { respawnNonce: 7 }))
    expect(copy.data.respawnNonce).toBeUndefined()
  })

  it.each(ALL_KINDS)('clears execution identity on a %s copy too', (kind) => {
    // The pre-existing terminal contract, asserted for every kind now that every kind survives.
    const copy = duplicateNode(
      nodeOf(kind, {
        initialCommand: 'claude --resume src-session',
        agentLaunchIntent: { kind: 'agent', action: 'resume', agentId: 'claude', sessionId: 'src' },
        agentSessionId: 'src-session',
        pendingLaunch: { after: ['term-dep'], launchId: 'id-1', launch: { kind: 'agent' } },
        pendingLaunchError: 'delivery failed',
        pendingLaunchErrorKind: 'unknown'
      })
    )
    expect(copy.data.initialCommand).toBeUndefined()
    expect(copy.data.agentLaunchIntent).toBeUndefined()
    expect(copy.data.agentSessionId).toBeUndefined()
    expect(copy.data.pendingLaunch).toBeUndefined()
    expect(copy.data.pendingLaunchError).toBeUndefined()
    expect(copy.data.pendingLaunchErrorKind).toBeUndefined()
  })

  it.each(ALL_KINDS)('leaves the source %s untouched and lands the copy top-level', (kind) => {
    const source = nodeOf(kind, { filePath: '/repo/a.ts', initialCommand: 'run me' })
    const sourceData = source.data
    const copy = duplicateNode(source, 28)

    expect(copy.data).not.toBe(sourceData)
    expect(source.data).toBe(sourceData)
    expect(source.data.initialCommand).toBe('run me')
    expect(source.type).toBe(kind)
    expect(copy.position).toEqual({ x: 128, y: 228 })
    expect(copy.selected).toBe(true)
    expect(copy.parentId).toBeUndefined()
    expect(copy.extent).toBeUndefined()
  })

  it('mints distinct ids for copies of different kinds made in one tick', () => {
    const ids = ALL_KINDS.flatMap((kind) => [
      duplicateNode(nodeOf(kind)).id,
      duplicateNode(nodeOf(kind)).id
    ])
    expect(new Set(ids).size).toBe(ids.length)
  })

  // Current behavior, pinned rather than changed: duplicating a frame does NOT deep-copy its
  // subtree. `duplicateNode` places every copy at the top level, so the frame copy comes back
  // empty, and a co-selected child's copy lands beside it rather than inside it. Canvas's
  // `duplicateNodes` passes the raw selection (not `selectedRootIds`, which "Group selection"
  // does use), so a box-select that caught a frame and its children produces exactly this.
  // Separate from — and older than — the id-prefix bug fixed above; pinned so the shape is
  // known rather than assumed.
  it('duplicating a frame copies the frame only, never its children', () => {
    const child = term('term-child', { x: 20, y: 30 }, 'group-source')
    const frameCopy = duplicateNode(nodeOf('group'))
    expect(frameCopy.type).toBe('group')
    expect(frameCopy.parentId).toBeUndefined()
    // Nothing points at the copy: the child still belongs to the original frame.
    expect(child.parentId).toBe('group-source')

    // And a child duplicated alongside its frame is promoted to the top level, not re-parented
    // into the frame copy.
    const childCopy = duplicateNode(child)
    expect(childCopy.parentId).toBeUndefined()
    expect(childCopy.extent).toBeUndefined()
  })
})

describe('browser tabs', () => {
  it('defaultBrowserTabs synthesizes one tab from a legacy url/title', () => {
    const tabs = defaultBrowserTabs('n1', 'https://example.com', 'Example')
    expect(tabs).toEqual([{ id: 'n1-tab-0', url: 'https://example.com', title: 'Example' }])
  })

  it('defaultBrowserTabs falls back to "New Tab" for an empty title', () => {
    const tabs = defaultBrowserTabs('n1', undefined, '')
    expect(tabs).toEqual([{ id: 'n1-tab-0', url: '', title: 'New Tab' }])
  })

  it('nodeStatesToFlow migrates a pre-tabs browser node into a one-tab array', () => {
    const flow = nodeStatesToFlow([
      {
        id: 'b1',
        kind: 'browser',
        position: { x: 0, y: 0 },
        size: { width: 640, height: 480 },
        title: 'My Site',
        color: '#000',
        group: null,
        url: 'https://example.com'
      }
    ])
    expect(flow[0].data.browserTabs).toEqual([{ id: 'b1-tab-0', url: 'https://example.com', title: 'My Site' }])
    expect(flow[0].data.browserActiveTabId).toBe('b1-tab-0')
  })

  it('nodeStatesToFlow preserves an already-persisted multi-tab array untouched', () => {
    const tabs = [
      { id: 't1', url: 'https://a.example', title: 'A' },
      { id: 't2', url: 'https://b.example', title: 'B' }
    ]
    const flow = nodeStatesToFlow([
      {
        id: 'b1',
        kind: 'browser',
        position: { x: 0, y: 0 },
        size: { width: 640, height: 480 },
        title: 'A',
        color: '#000',
        group: null,
        browserTabs: tabs,
        browserActiveTabId: 't2'
      }
    ])
    expect(flow[0].data.browserTabs).toEqual(tabs)
    expect(flow[0].data.browserActiveTabId).toBe('t2')
  })

  it('flowToNodeStates round-trips browserTabs/browserActiveTabId', () => {
    const node: CanvasNode = {
      id: 'b1',
      type: 'browser',
      position: { x: 0, y: 0 },
      width: 640,
      height: 480,
      data: {
        title: 'A',
        color: '#000',
        group: null,
        browserTabs: [{ id: 't1', url: 'https://a.example', title: 'A' }],
        browserActiveTabId: 't1'
      }
    }
    const states = flowToNodeStates([node])
    expect(states[0].browserTabs).toEqual([{ id: 't1', url: 'https://a.example', title: 'A' }])
    expect(states[0].browserActiveTabId).toBe('t1')
  })

  it('a non-browser node never gets a synthesized browserTabs array', () => {
    const flow = nodeStatesToFlow([
      {
        id: 't1',
        kind: 'terminal',
        position: { x: 0, y: 0 },
        size: { width: 640, height: 480 },
        title: 'Term',
        color: '#000',
        group: null
      }
    ])
    expect(flow[0].data.browserTabs).toBeUndefined()
  })
})

describe('flowToNodeStates — temporary nodes', () => {
  it('drops a temporary (popup) browser node from every save, and keeps it once promoted', () => {
    const kept = createBrowserNode(0, 'https://example.com/a')
    const popup = createBrowserNode(1, 'https://example.com/b', undefined, undefined, undefined, true)
    expect(popup.data.temporary).toBe(true)

    const saved = flowToNodeStates([kept, popup])
    expect(saved.map((n) => n.id)).toEqual([kept.id])

    // "Keep" clears the flag; the same node then persists like any other.
    const promoted = { ...popup, data: { ...popup.data, temporary: undefined } }
    expect(flowToNodeStates([kept, promoted]).map((n) => n.id)).toEqual([kept.id, popup.id])
  })
})
