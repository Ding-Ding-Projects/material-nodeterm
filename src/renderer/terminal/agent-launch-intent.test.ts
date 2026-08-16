import { describe, expect, it } from 'vitest'
import { coldAgentLaunchIntent } from './agent-launch-intent'

describe('coldAgentLaunchIntent', () => {
  it('resumes an exact builtin session without overloading the start id field', () => {
    expect(
      coldAgentLaunchIntent({
        agentId: 'claude',
        priorSessionId: 'session-123',
        customAgentConfigured: false,
        permissionMode: 'plan'
      })
    ).toEqual({
      kind: 'agent',
      action: 'resume',
      agentId: 'claude',
      sessionId: 'session-123',
      permissionMode: 'plan'
    })
  })

  it('starts a builtin fresh when no provider session is known', () => {
    expect(
      coldAgentLaunchIntent({
        agentId: 'codex',
        customAgentConfigured: false,
        permissionMode: 'auto'
      })
    ).toEqual({
      kind: 'agent',
      action: 'start',
      agentId: 'codex',
      permissionMode: 'auto'
    })
  })

  it('starts only an exact current custom configuration and never assigns builtin capabilities', () => {
    expect(
      coldAgentLaunchIntent({
        agentId: 'custom:trusted',
        priorSessionId: 'must-not-resume',
        customAgentConfigured: true,
        permissionMode: 'bypassPermissions'
      })
    ).toEqual({ kind: 'agent', action: 'start', agentId: 'custom:trusted' })
    expect(
      coldAgentLaunchIntent({
        agentId: 'custom:missing',
        customAgentConfigured: false
      })
    ).toBeNull()
  })
})
