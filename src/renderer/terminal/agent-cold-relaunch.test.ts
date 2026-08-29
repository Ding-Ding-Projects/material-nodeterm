import { describe, expect, it, vi } from 'vitest'
import {
  agentColdRelaunchDecision,
  agentColdRelaunchRecoveryMessage,
  retryAgentColdRelaunch
} from './agent-cold-relaunch'

describe('agentColdRelaunchDecision', () => {
  it('resumes a built-in agent when its prior provider session id is valid', () => {
    expect(
      agentColdRelaunchDecision({
        agentId: 'claude',
        priorSessionId: 'session-123'
      })
    ).toEqual({
      reconstructable: true,
      command: 'claude --resume session-123',
      continuity: 'resume',
      continuationReview: false
    })
  })

  it('starts a built-in agent fresh when no prior provider session id exists', () => {
    expect(agentColdRelaunchDecision({ agentId: 'gemini' })).toEqual({
      reconstructable: true,
      command: 'gemini',
      continuity: 'fresh',
      continuationReview: false
    })
  })

  it('starts a built-in agent fresh when a hostile persisted session id is rejected', () => {
    expect(
      agentColdRelaunchDecision({
        agentId: 'opencode',
        priorSessionId: 'x; whoami'
      })
    ).toEqual({
      reconstructable: true,
      command: 'opencode',
      continuity: 'fresh',
      continuationReview: false
    })
  })

  it('preserves the shared-identity launcher for built-in resume and fresh launch', () => {
    expect(
      agentColdRelaunchDecision({
        agentId: 'codex',
        priorSessionId: 'thread-1',
        sharedIdentity: true
      })
    ).toEqual({
      reconstructable: true,
      command: 'nodeterm-codex resume thread-1',
      continuity: 'resume',
      continuationReview: false
    })
    expect(agentColdRelaunchDecision({ agentId: 'codex', sharedIdentity: true })).toEqual({
      reconstructable: true,
      command: 'nodeterm-codex',
      continuity: 'fresh',
      continuationReview: false
    })
  })

  it('relaunches a custom agent from its current configured command', () => {
    expect(
      agentColdRelaunchDecision({
        agentId: 'custom:reviewer',
        customLaunchCmd: '"C:\\Program Files\\Reviewer\\reviewer.exe" --interactive'
      })
    ).toEqual({
      reconstructable: true,
      command: '"C:\\Program Files\\Reviewer\\reviewer.exe" --interactive',
      continuity: 'fresh',
      continuationReview: false
    })
  })

  it('fails closed when a custom agent no longer has a configured command', () => {
    expect(agentColdRelaunchDecision({ agentId: 'custom:removed' })).toEqual({
      reconstructable: false,
      reason: 'custom-agent-not-configured'
    })
    expect(
      agentColdRelaunchDecision({
        agentId: 'custom:empty',
        customLaunchCmd: '   '
      })
    ).toEqual({
      reconstructable: false,
      reason: 'custom-agent-not-configured'
    })
  })

  it('marks a retained packet for review only when the relaunch is fresh', () => {
    expect(
      agentColdRelaunchDecision({
        agentId: 'codex',
        priorSessionId: 'session-1',
        continuationPacket: true
      })
    ).toMatchObject({ continuity: 'resume', continuationReview: false })
    expect(
      agentColdRelaunchDecision({
        agentId: 'codex',
        continuationPacket: true
      })
    ).toMatchObject({ continuity: 'fresh', continuationReview: true })
    expect(
      agentColdRelaunchDecision({
        agentId: 'custom:reviewer',
        customLaunchCmd: 'reviewer --interactive',
        continuationPacket: true
      })
    ).toMatchObject({ continuity: 'fresh', continuationReview: true })
  })

  it('does not recycle or respawn while the custom agent remains unreconstructable', async () => {
    const recycle = vi.fn().mockResolvedValue(undefined)
    const respawn = vi.fn()

    const result = await retryAgentColdRelaunch(
      {
        agentId: 'custom:removed',
        persistKey: 'node-1',
        profileId: 'pwsh',
        cwd: 'C:\\repo'
      },
      recycle,
      respawn
    )

    expect(result).toEqual({
      recovered: false,
      error: { code: 'custom-agent-not-configured' }
    })
    expect(recycle).not.toHaveBeenCalled()
    expect(respawn).not.toHaveBeenCalled()
  })

  it('preflights the exact current profile before recycling and only then respawns', async () => {
    const events: string[] = []
    let finishRecycle!: () => void
    const recycle = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          events.push('preflight-and-recycle')
          finishRecycle = resolve
        })
    )
    const respawn = vi.fn(() => events.push('respawn'))

    const pending = retryAgentColdRelaunch(
      {
        agentId: 'custom:reviewer',
        customLaunchCmd: 'reviewer --interactive',
        persistKey: 'node-1',
        profileId: 'wsl:Ubuntu 24.04',
        cwd: 'C:\\work tree'
      },
      recycle,
      respawn
    )

    expect(recycle).toHaveBeenCalledWith('node-1', {
      profileId: 'wsl:Ubuntu 24.04',
      cwd: 'C:\\work tree'
    })
    expect(respawn).not.toHaveBeenCalled()
    finishRecycle()
    await expect(pending).resolves.toEqual({ recovered: true, continuationReview: false })
    expect(events).toEqual(['preflight-and-recycle', 'respawn'])
  })

  it('carries the fresh-only continuation review bit through a confirmed retry', async () => {
    const respawn = vi.fn()
    await expect(
      retryAgentColdRelaunch(
        {
          agentId: 'codex',
          persistKey: 'node-1',
          cwd: 'C:\\work',
          continuationPacket: true
        },
        vi.fn().mockResolvedValue(undefined),
        respawn
      )
    ).resolves.toEqual({ recovered: true, continuationReview: true })
    expect(respawn).toHaveBeenCalledTimes(1)
  })

  it('keeps the blank generation and respawn state untouched when recycle is uncertain', async () => {
    const respawn = vi.fn()
    const result = await retryAgentColdRelaunch(
      {
        agentId: 'claude',
        priorSessionId: 'session-1',
        persistKey: 'node-1',
        profileId: 'cmd',
        cwd: ''
      },
      async () => {
        throw new Error('session-host reply was lost')
      },
      respawn
    )

    expect(result).toEqual({
      recovered: false,
      error: {
        code: 'confirmed-recycle-failed',
        detail: 'session-host reply was lost'
      }
    })
    expect(respawn).not.toHaveBeenCalled()
    if (result.recovered) throw new Error('Expected a recovery error')
    expect(agentColdRelaunchRecoveryMessage(result.error)).toContain('Nothing was restarted')
  })

  it('fails visibly when confirmed recycle is unavailable', async () => {
    const respawn = vi.fn()
    const result = await retryAgentColdRelaunch(
      {
        agentId: 'claude',
        persistKey: 'node-1',
        cwd: ''
      },
      undefined,
      respawn
    )

    expect(result).toEqual({
      recovered: false,
      error: { code: 'confirmed-recycle-unavailable' }
    })
    expect(respawn).not.toHaveBeenCalled()
  })

  it('preserves the one-argument confirmed-recycle contract outside Windows profiles', async () => {
    const recycle = vi.fn().mockResolvedValue(undefined)
    const respawn = vi.fn()

    await expect(
      retryAgentColdRelaunch(
        {
          agentId: 'gemini',
          persistKey: 'node-1',
          cwd: '/repo'
        },
        recycle,
        respawn
      )
    ).resolves.toEqual({ recovered: true, continuationReview: false })

    expect(recycle).toHaveBeenCalledWith('node-1')
    expect(recycle.mock.calls[0]).toHaveLength(1)
    expect(respawn).toHaveBeenCalledTimes(1)
  })
})
