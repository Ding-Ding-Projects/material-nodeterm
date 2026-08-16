import { describe, expect, it, vi } from 'vitest'
import type { PendingLaunch } from '@shared/types'
import { executePendingLaunchForSession } from './pending-launch-executor'

const LAUNCH_ID = '123e4567-e89b-42d3-a456-426614174000'

const shellPending = (command = 'printf legacy'): PendingLaunch => ({
  after: ['dep'],
  launchId: LAUNCH_ID,
  launch: { kind: 'shell-command', command }
})

const agentPending = (): PendingLaunch => ({
  after: ['dep'],
  launchId: LAUNCH_ID,
  launch: {
    kind: 'agent',
    action: 'start',
    agentId: 'claude',
    prompt: "space ' & | % ! Unicode 開発"
  }
})

describe('executePendingLaunchForSession', () => {
  it('hands the exact stable id and semantic intent to the opaque desktop executor', async () => {
    const pending = agentPending()
    const executeLaunchIntent = vi.fn(async () => ({ ok: true as const }))
    const sendLegacyShellCommand = vi.fn(async () => true)

    await expect(
      executePendingLaunchForSession(
        { executeLaunchIntent, sendLegacyShellCommand },
        { sessionId: 'pty-generation-1', pending, localWindowsProfile: true }
      )
    ).resolves.toEqual({ ok: true })

    expect(executeLaunchIntent).toHaveBeenCalledTimes(1)
    expect(executeLaunchIntent).toHaveBeenCalledWith(
      'pty-generation-1',
      LAUNCH_ID,
      pending.launch
    )
    expect(sendLegacyShellCommand).not.toHaveBeenCalled()
  })

  it.each(['Server Edition', 'SSH', 'relay']) (
    'preserves the legacy shell-command delivery path for %s when the planner is absent',
    async () => {
      const pending = shellPending('printf one-shot')
      const sendLegacyShellCommand = vi.fn(async () => true)
      await expect(
        executePendingLaunchForSession(
          { sendLegacyShellCommand },
          { sessionId: 'legacy-session', pending, localWindowsProfile: false }
        )
      ).resolves.toEqual({ ok: true })
      expect(sendLegacyShellCommand).toHaveBeenCalledTimes(1)
      expect(sendLegacyShellCommand).toHaveBeenCalledWith('printf one-shot')
    }
  )

  it('surfaces a legacy delivery refusal without a second submission', async () => {
    const sendLegacyShellCommand = vi.fn(async () => false)
    await expect(
      executePendingLaunchForSession(
        { sendLegacyShellCommand },
        {
          sessionId: 'legacy-session',
          pending: shellPending(),
          localWindowsProfile: false
        }
      )
    ).resolves.toEqual({
      ok: false,
      reason: 'session-unavailable',
      message: 'The terminal session is not ready for this queued launch.'
    })
    expect(sendLegacyShellCommand).toHaveBeenCalledTimes(1)
  })

  it('fails closed when a local Windows profile lacks the opaque executor', async () => {
    const sendLegacyShellCommand = vi.fn(async () => true)
    await expect(
      executePendingLaunchForSession(
        { sendLegacyShellCommand },
        {
          sessionId: 'windows-session',
          pending: shellPending('calc & echo hostile'),
          localWindowsProfile: true
        }
      )
    ).resolves.toEqual({
      ok: false,
      reason: 'unsupported-shell',
      message: 'Queued launches are not available for this terminal session.'
    })
    expect(sendLegacyShellCommand).not.toHaveBeenCalled()
  })

  it('never degrades a semantic agent intent to raw text on a planner-free surface', async () => {
    const sendLegacyShellCommand = vi.fn(async () => true)
    await expect(
      executePendingLaunchForSession(
        { sendLegacyShellCommand },
        { sessionId: 'server-session', pending: agentPending(), localWindowsProfile: false }
      )
    ).resolves.toMatchObject({ ok: false, reason: 'unsupported-shell' })
    expect(sendLegacyShellCommand).not.toHaveBeenCalled()
  })

  it('propagates transport uncertainty so the caller can retry the same launch id', async () => {
    const pending = shellPending()
    const uncertain = new Error('private transport details')
    const executeLaunchIntent = vi.fn(async () => {
      throw uncertain
    })

    await expect(
      executePendingLaunchForSession(
        { executeLaunchIntent, sendLegacyShellCommand: async () => true },
        { sessionId: 'pty-generation-1', pending, localWindowsProfile: true }
      )
    ).rejects.toBe(uncertain)
    expect(executeLaunchIntent).toHaveBeenCalledWith(
      'pty-generation-1',
      LAUNCH_ID,
      pending.launch
    )
  })
})
