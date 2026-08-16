import { describe, expect, it, vi } from 'vitest'
import type { AgentLaunchIntent, PendingLaunch } from '@shared/types'
import { armedTerminalLaunchIntent } from './armed-launch-intent'
import { executePendingLaunchForSession } from './pending-launch-executor'

const LAUNCH_ID = '123e4567-e89b-42d3-a456-426614174000'
const semantic: AgentLaunchIntent = {
  kind: 'agent',
  action: 'start',
  agentId: 'gemini',
  prompt: "space ' & | % ! Unicode 開発"
}
// This is intentionally the historical renderer-authored form. Gemini's legacy creation path
// appends a positional prompt even though the new Windows planner can use stdin-after-start.
const legacyGemini = "gemini 'space '\\'' & | % ! Unicode 開発'"

function armedFor(launch: PendingLaunch['launch']): PendingLaunch {
  return { after: ['dep'], launchId: LAUNCH_ID, launch }
}

describe('armedTerminalLaunchIntent', () => {
  it('holds the semantic launch only for a local Windows desktop with the opaque executor', () => {
    expect(
      armedTerminalLaunchIntent(
        { initialCommand: legacyGemini, agentLaunchIntent: semantic },
        { offersTerminalProfiles: true, hasOpaqueExecutor: true }
      )
    ).toEqual(semantic)
  })

  it.each([
    ['Server Edition', false, false, {}],
    ['supported relay', false, false, {}],
    ['SSH project', true, true, { ssh: { server: { host: 'example' } } }],
    ['local SSH terminal', true, true, { sshRemoteTmux: { remoteCwd: '/repo' } }]
  ] as const)(
    'keeps the exact historical Gemini command for %s',
    (_surface, offersTerminalProfiles, hasOpaqueExecutor, remoteData) => {
      expect(
        armedTerminalLaunchIntent(
          {
            initialCommand: legacyGemini,
            agentLaunchIntent: semantic,
            ...remoteData
          },
          { offersTerminalProfiles, hasOpaqueExecutor }
        )
      ).toEqual({ kind: 'shell-command', command: legacyGemini })
    }
  )

  it.each(['Server Edition', 'SSH', 'relay']) (
    'executes the preserved agent command exactly once on %s',
    async () => {
      const launch = armedTerminalLaunchIntent(
        { initialCommand: legacyGemini, agentLaunchIntent: semantic },
        { offersTerminalProfiles: false, hasOpaqueExecutor: false }
      )
      expect(launch).toBeDefined()
      const sendLegacyShellCommand = vi.fn(async () => true)
      await expect(
        executePendingLaunchForSession(
          { sendLegacyShellCommand },
          {
            sessionId: 'legacy-session',
            pending: armedFor(launch as PendingLaunch['launch']),
            localWindowsProfile: false
          }
        )
      ).resolves.toEqual({ ok: true })
      expect(sendLegacyShellCommand).toHaveBeenCalledTimes(1)
      expect(sendLegacyShellCommand).toHaveBeenCalledWith(legacyGemini)
    }
  )

  it('cannot raw-fallback when a Windows pane advertises profiles but loses its executor', async () => {
    const launch = armedTerminalLaunchIntent(
      { initialCommand: legacyGemini, agentLaunchIntent: semantic },
      { offersTerminalProfiles: true, hasOpaqueExecutor: false }
    )
    expect(launch).toEqual({ kind: 'shell-command', command: legacyGemini })
    const sendLegacyShellCommand = vi.fn(async () => true)
    await expect(
      executePendingLaunchForSession(
        { sendLegacyShellCommand },
        {
          sessionId: 'windows-session',
          pending: armedFor(launch as PendingLaunch['launch']),
          localWindowsProfile: true
        }
      )
    ).resolves.toMatchObject({ ok: false, reason: 'unsupported-shell' })
    expect(sendLegacyShellCommand).not.toHaveBeenCalled()
  })
})
