import { describe, it, expect, beforeEach } from 'vitest'
import { useProjects } from './projects'
import { registerWorkspaceDirty } from './workspaceDirty'

beforeEach(() => {
  useProjects.getState().hydrate({ version: 2, activeProjectId: '', projects: [] })
})

describe('setProjectCapability — the ONE strict setter', () => {
  it('on writes a literal true and records "kept"', () => {
    const p = useProjects.getState().addProject('foo', '/a/foo')
    useProjects.getState().setProjectCapability(p.id, 'agentBrowserControl', true)
    const after = useProjects.getState().projects.find((q) => q.id === p.id)!
    expect(after.agentBrowserControl).toBe(true)
    expect(after.capabilityAck).toEqual({ agentBrowserControl: 'kept' })
  })

  it('off DELETES the field — never a stored false — and records "declined"', () => {
    const p = useProjects.getState().addProject('foo', '/a/foo')
    useProjects.getState().setProjectCapability(p.id, 'agentBrowserControl', true)
    useProjects.getState().setProjectCapability(p.id, 'agentBrowserControl', false)
    const after = useProjects.getState().projects.find((q) => q.id === p.id)!
    expect('agentBrowserControl' in after).toBe(false)
    expect(after.agentBrowserControl).not.toBe(false)
    expect(after.capabilityAck).toEqual({ agentBrowserControl: 'declined' })
  })

  it('is a no-op for an unknown project id', () => {
    useProjects.getState().addProject('foo', '/a/foo')
    const before = useProjects.getState().projects
    useProjects.getState().setProjectCapability('nope', 'agentBrowserControl', true)
    expect(useProjects.getState().projects).toEqual(before)
  })

  it('schedules the workspace save (issue-318 shape): the setter alone must persist', () => {
    const calls: number[] = []
    const unregister = registerWorkspaceDirty(() => calls.push(1))
    try {
      const p = useProjects.getState().addProject('foo', '/a/foo')
      useProjects.getState().setProjectCapability(p.id, 'agentBrowserControl', true)
      expect(calls.length).toBeGreaterThan(0)
    } finally {
      unregister()
    }
  })
})

describe('recordProjectCapabilityAck', () => {
  it('records the answer and schedules a save', () => {
    const calls: number[] = []
    const unregister = registerWorkspaceDirty(() => calls.push(1))
    try {
      const p = useProjects.getState().addProject('foo', '/a/foo')
      useProjects.getState().recordProjectCapabilityAck(p.id, 'agentBrowserControl', 'kept')
      const after = useProjects.getState().projects.find((q) => q.id === p.id)!
      expect(after.capabilityAck).toEqual({ agentBrowserControl: 'kept' })
      expect(calls.length).toBeGreaterThan(0)
    } finally {
      unregister()
    }
  })

  it('a later answer overwrites an earlier one without touching the raw switch', () => {
    const p = useProjects.getState().addProject('foo', '/a/foo')
    useProjects.getState().recordProjectCapabilityAck(p.id, 'agentBrowserControl', 'declined')
    useProjects.getState().recordProjectCapabilityAck(p.id, 'agentBrowserControl', 'kept')
    const after = useProjects.getState().projects.find((q) => q.id === p.id)!
    expect(after.capabilityAck).toEqual({ agentBrowserControl: 'kept' })
    expect(after.agentBrowserControl).toBeUndefined()
  })
})
