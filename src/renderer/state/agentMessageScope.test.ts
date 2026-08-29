import { describe, expect, it } from 'vitest'
import { isSafeNodeId, resolveDeliveryScope, type ScopeProject } from './agentMessageScope'

const projects: ScopeProject[] = [
  { id: 'p1', nodes: [{ id: 'a1' }, { id: 'a2' }] },
  { id: 'p2', nodes: [{ id: 'b1' }] },
  { id: 'p3', nodes: [{ id: 'dup' }] },
  { id: 'p4', nodes: [{ id: 'dup' }] }
]

describe('isSafeNodeId', () => {
  it('accepts the tmux-safe charset', () => {
    expect(isSafeNodeId('abc-123_.node')).toBe(true)
  })
  it('rejects a NUL, a slash, and an empty string', () => {
    expect(isSafeNodeId('a\u0000b')).toBe(false)
    expect(isSafeNodeId('a/b')).toBe(false)
    expect(isSafeNodeId('')).toBe(false)
  })
})

describe('resolveDeliveryScope', () => {
  it('resolves same-project when sender and target share one project', () => {
    expect(resolveDeliveryScope(projects, 'p1', 'a1', 'a2')).toEqual({ kind: 'same-project', projectId: 'p1' })
  })

  it('refuses self-send before anything else, even for an unaddressable id', () => {
    expect(resolveDeliveryScope(projects, 'p1', 'x/y', 'x/y')).toEqual({
      kind: 'refused',
      reason: 'unaddressable-node-id',
      targetFound: false
    })
  })

  it('refuses self-send for a safe id', () => {
    expect(resolveDeliveryScope(projects, 'p1', 'a1', 'a1')).toEqual({
      kind: 'refused',
      reason: 'self-send',
      targetFound: true
    })
  })

  it('refuses cross-project and says the target was found elsewhere', () => {
    expect(resolveDeliveryScope(projects, 'p1', 'a1', 'b1')).toEqual({
      kind: 'refused',
      reason: 'cross-project',
      targetFound: true
    })
  })

  it('refuses cross-project and says the target was never found when it names nothing', () => {
    expect(resolveDeliveryScope(projects, 'p1', 'a1', 'nowhere')).toEqual({
      kind: 'refused',
      reason: 'cross-project',
      targetFound: false
    })
  })

  it('refuses ambiguous-target-node-id when the id names nodes in two different projects', () => {
    expect(resolveDeliveryScope(projects, 'p3', 'dup', 'dup')).toEqual({
      kind: 'refused',
      reason: 'self-send',
      targetFound: true
    })
    // A genuinely different sender inside one of the two claiming projects, targeting the
    // duplicated id, cannot have a single owner proved for it.
    const withSender: ScopeProject[] = projects.map((project) =>
      project.id === 'p3' ? { ...project, nodes: [...project.nodes, { id: 'sender' }] } : project
    )
    expect(resolveDeliveryScope(withSender, 'p3', 'sender', 'dup')).toEqual({
      kind: 'refused',
      reason: 'ambiguous-target-node-id',
      targetFound: true
    })
  })

  it('refuses unaddressable-node-id ahead of any project lookup', () => {
    expect(resolveDeliveryScope(projects, 'p1', 'a1', 'weird id')).toEqual({
      kind: 'refused',
      reason: 'unaddressable-node-id',
      targetFound: false
    })
  })
})
