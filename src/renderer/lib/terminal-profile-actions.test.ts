import { describe, expect, it, vi } from 'vitest'
import type { CanvasNodeState, WindowsTerminalProfile } from '@shared/types'
import { flowToNodeStates, nodeStatesToFlow, type CanvasNode } from '../state/workspace'
import { openDestructiveGate, useDestructiveGate } from '../state/destructiveGate'
import {
  assessTerminalProfileRestart,
  canOfferTerminalProfiles,
  recycleThenApplyTerminalProfile,
  runExclusiveTerminalProfileRestart,
  terminalProfileExecutionEnvironment,
  terminalProfileRestartOriginMatches,
  terminalProfileChoices
} from './terminal-profile-actions'

const profiles: WindowsTerminalProfile[] = [
  { id: 'pwsh', label: 'PowerShell 7', kind: 'pwsh', available: true },
  {
    id: 'wsl:Missing Linux',
    label: 'WSL — Missing Linux',
    kind: 'wsl',
    available: false,
    unavailableReason: 'The distribution is no longer installed.'
  },
  { id: 'git-bash', label: 'Git Bash', kind: 'git-bash', available: false }
]

describe('terminal profile UI actions', () => {
  it('offers local Windows profiles only for a local non-SSH session with the optional API', () => {
    expect(canOfferTerminalProfiles(true, 'local', false)).toBe(true)
    expect(canOfferTerminalProfiles(false, 'local', false)).toBe(false)
    expect(canOfferTerminalProfiles(true, 'relay', false)).toBe(false)
    expect(canOfferTerminalProfiles(true, 'server', false)).toBe(false)
    expect(canOfferTerminalProfiles(true, 'local', true)).toBe(false)
  })

  it('keeps unavailable profiles disabled and explains why', () => {
    expect(terminalProfileChoices(profiles)).toEqual([
      { id: 'pwsh', label: 'PowerShell 7', disabled: false, hint: undefined },
      {
        id: 'wsl:Missing Linux',
        label: 'WSL — Missing Linux',
        disabled: true,
        hint: 'The distribution is no longer installed.'
      },
      {
        id: 'git-bash',
        label: 'Git Bash',
        disabled: true,
        hint: 'This profile is unavailable on this machine.'
      }
    ])
  })

  it('does not change node state until recycle confirmation resolves', async () => {
    let resolveRecycle!: () => void
    const recycle = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRecycle = resolve
        })
    )
    const apply = vi.fn()

    const target = { profileId: 'pwsh', cwd: 'C:\\work tree' }
    const pending = recycleThenApplyTerminalProfile('term-1', 'pwsh', target, recycle, apply)
    expect(recycle).toHaveBeenCalledWith('term-1', target)
    expect(apply).not.toHaveBeenCalled()

    resolveRecycle()
    await pending
    expect(apply).toHaveBeenCalledWith('term-1', 'pwsh')
  })

  it.each([
    ['target preflight rejects', new Error('Command Prompt is unavailable')],
    ['backend teardown is uncertain', new Error('persistent session could not be stopped')]
  ])('leaves the old profile and respawn state untouched when %s', async (_case, error) => {
    const apply = vi.fn()

    await expect(
      recycleThenApplyTerminalProfile(
        'term-1',
        'cmd',
        { profileId: 'cmd', cwd: '' },
        () => Promise.reject(error),
        apply
      )
    ).rejects.toBe(error)
    expect(apply).not.toHaveBeenCalled()
  })

  it('applies a replacement after an honest confirmed-absence result', async () => {
    const recycle = vi.fn().mockResolvedValue(undefined)
    const apply = vi.fn()

    await recycleThenApplyTerminalProfile(
      'term-removed-profile',
      'pwsh',
      { profileId: 'pwsh', cwd: '' },
      recycle,
      apply
    )

    expect(recycle).toHaveBeenCalledWith('term-removed-profile', {
      profileId: 'pwsh',
      cwd: ''
    })
    expect(apply).toHaveBeenCalledWith('term-removed-profile', 'pwsh')
  })

  it('cancelling the destructive gate is a complete profile-restart no-op', async () => {
    const recycle = vi.fn().mockResolvedValue(undefined)
    const apply = vi.fn()
    useDestructiveGate.setState({ request: null })
    openDestructiveGate({
      title: 'Restart with Command Prompt',
      description: 'The live process and persistent session will end.',
      onConfirm: () => {
        void recycleThenApplyTerminalProfile(
          'term-1',
          'cmd',
          { profileId: 'cmd', cwd: '' },
          recycle,
          apply
        )
      }
    })

    useDestructiveGate.getState().close()
    await Promise.resolve()

    expect(useDestructiveGate.getState().request).toBeNull()
    expect(recycle).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })

  it('retains the applied profile across the renderer save and reload boundary', async () => {
    const initial: CanvasNodeState = {
      id: 'term-1',
      kind: 'terminal',
      position: { x: 0, y: 0 },
      size: { width: 640, height: 440 },
      title: 'Terminal',
      color: '#fff',
      group: null,
      shell: 'C:\\Legacy Shell\\legacy.exe',
      terminalProfileId: 'custom'
    }
    let nodes = nodeStatesToFlow([initial])

    await recycleThenApplyTerminalProfile(
      'term-1',
      'cmd',
      { profileId: 'cmd', cwd: '' },
      async () => {},
      (persistKey, selectedProfileId) => {
        nodes = nodes.map((node) =>
          node.id === persistKey
            ? ({
                ...node,
                data: {
                  ...node.data,
                  shell: undefined,
                  terminalProfileId: selectedProfileId,
                  respawnNonce: ((node.data.respawnNonce as number | undefined) ?? 0) + 1
                }
              } as CanvasNode)
            : node
        )
      }
    )

    const saved = flowToNodeStates(nodes)
    expect(saved[0].shell).toBeUndefined()
    expect(saved[0].terminalProfileId).toBe('cmd')
    expect(nodeStatesToFlow(saved)[0].data.terminalProfileId).toBe('cmd')
  })

  it('keeps preflight, teardown, state apply and respawn in transactional order', async () => {
    const events: string[] = []
    const target = { profileId: 'git-bash', cwd: 'C:\\repo' }

    await recycleThenApplyTerminalProfile(
      'term-1',
      target.profileId,
      target,
      async (_persistKey, receivedTarget) => {
        expect(receivedTarget).toBe(target)
        events.push('preflight', 'kill')
      },
      () => events.push('apply-profile', 'respawn')
    )

    expect(events).toEqual(['preflight', 'kill', 'apply-profile', 'respawn'])
  })

  it('allows only one immediate profile restart transaction per node', async () => {
    const pendingNodeIds = new Set<string>()
    const pendingSnapshots: string[][] = []
    let finishFirst!: () => void
    const firstTransaction = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve
        })
    )
    const secondTransaction = vi.fn().mockResolvedValue(undefined)
    const onPendingChange = (ids: ReadonlySet<string>) => pendingSnapshots.push([...ids].sort())

    const first = runExclusiveTerminalProfileRestart(
      pendingNodeIds,
      'term-1',
      onPendingChange,
      firstTransaction
    )
    await expect(
      runExclusiveTerminalProfileRestart(
        pendingNodeIds,
        'term-1',
        onPendingChange,
        secondTransaction
      )
    ).rejects.toThrow('already in progress')

    expect(firstTransaction).toHaveBeenCalledTimes(1)
    expect(secondTransaction).not.toHaveBeenCalled()
    expect(pendingSnapshots).toEqual([['term-1']])

    finishFirst()
    await first
    expect(pendingSnapshots).toEqual([['term-1'], []])
  })

  it('serializes two immediate confirmations from the destructive-gate surface', async () => {
    const pendingNodeIds = new Set<string>()
    const recycle = vi.fn()
    const apply = vi.fn()
    const failures: unknown[] = []
    let finishRecycle!: () => void
    recycle.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRecycle = resolve
        })
    )
    useDestructiveGate.setState({ request: null })
    openDestructiveGate({
      title: 'Restart with Command Prompt',
      description: 'The live process and persistent session will end.',
      onConfirm: () => {
        void runExclusiveTerminalProfileRestart(
          pendingNodeIds,
          'term-1',
          () => undefined,
          () =>
            recycleThenApplyTerminalProfile(
              'term-1',
              'cmd',
              { profileId: 'cmd', cwd: 'C:\\project' },
              recycle,
              apply
            )
        ).catch((error: unknown) => failures.push(error))
      }
    })

    const confirm = useDestructiveGate.getState().request?.onConfirm
    expect(confirm).toBeTypeOf('function')
    confirm?.()
    confirm?.()
    await Promise.resolve()

    expect(recycle).toHaveBeenCalledTimes(1)
    expect(recycle).toHaveBeenCalledWith('term-1', {
      profileId: 'cmd',
      cwd: 'C:\\project'
    })
    expect(apply).not.toHaveBeenCalled()
    expect(failures).toHaveLength(1)
    expect(String(failures[0])).toContain('already in progress')

    finishRecycle()
    await Promise.resolve()
    await Promise.resolve()
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('authorizes a captured restart only while both active and hydrated projects match', () => {
    expect(terminalProfileRestartOriginMatches('project-a', 'project-a', 'project-a')).toBe(true)
    expect(terminalProfileRestartOriginMatches('project-a', 'project-b', 'project-a')).toBe(false)
    expect(terminalProfileRestartOriginMatches('project-a', 'project-a', 'project-b')).toBe(false)
    expect(terminalProfileRestartOriginMatches(null, null, null)).toBe(true)
    expect(terminalProfileRestartOriginMatches(null, 'project-a', null)).toBe(false)
  })

  it('distinguishes native Windows, explicit WSL distributions and custom wsl.exe', () => {
    expect(terminalProfileExecutionEnvironment('pwsh')).toBe('windows')
    expect(terminalProfileExecutionEnvironment('git-bash')).toBe('windows')
    expect(terminalProfileExecutionEnvironment('wsl:Ubuntu 24.04')).toBe('wsl:Ubuntu 24.04')
    expect(terminalProfileExecutionEnvironment('custom', '"C:\\Windows\\System32\\wsl.exe"')).toBe(
      'wsl:custom'
    )
    expect(terminalProfileExecutionEnvironment('hostile:id')).toBe('unknown')
  })

  it('fails closed for an agent whose custom launch command is no longer configured', () => {
    expect(
      assessTerminalProfileRestart({
        currentProfileId: 'pwsh',
        targetProfileId: 'cmd',
        agent: { agentId: 'custom:removed' }
      })
    ).toEqual({
      disabled: true,
      reasonCode: 'custom-agent-not-configured',
      reason:
        'This custom agent is no longer configured. Restore its launch command before restarting; the live process was not changed.'
    })
  })

  it('disables cross-environment agent switches before destructive confirmation', () => {
    expect(
      assessTerminalProfileRestart({
        currentProfileId: 'pwsh',
        targetProfileId: 'wsl:Ubuntu',
        agent: { agentId: 'claude', priorSessionId: 'session-1' }
      })
    ).toEqual({
      disabled: true,
      reasonCode: 'agent-cross-environment',
      reason:
        'Agent profile switching between Windows and WSL, or between WSL distributions, is unavailable because the target CLI and conversation store cannot be verified before ending this session.'
    })
    expect(
      assessTerminalProfileRestart({
        currentProfileId: 'wsl:Ubuntu',
        targetProfileId: 'wsl:Debian',
        agent: { agentId: 'claude', priorSessionId: 'session-1' }
      }).disabled
    ).toBe(true)
  })

  it('allows a resumable built-in agent within Windows or the same WSL distribution', () => {
    expect(
      assessTerminalProfileRestart({
        currentProfileId: 'pwsh',
        targetProfileId: 'git-bash',
        agent: { agentId: 'claude', priorSessionId: 'session-1' }
      })
    ).toEqual({ disabled: false })
    expect(
      assessTerminalProfileRestart({
        currentProfileId: 'wsl:Ubuntu',
        targetProfileId: 'wsl:Ubuntu',
        agent: { agentId: 'codex', priorSessionId: 'thread-1' }
      })
    ).toEqual({ disabled: false })
  })

  it('does not apply agent environment restrictions to plain terminals', () => {
    expect(
      assessTerminalProfileRestart({
        currentProfileId: 'pwsh',
        targetProfileId: 'wsl:Ubuntu'
      })
    ).toEqual({ disabled: false })
  })

  it('warns before a built-in or custom agent must start a new conversation', () => {
    expect(
      assessTerminalProfileRestart({
        currentProfileId: 'pwsh',
        targetProfileId: 'cmd',
        agent: { agentId: 'claude' }
      })
    ).toEqual({
      disabled: false,
      warningCode: 'new-built-in-conversation',
      warning:
        'No recoverable agent session ID is available. Restarting will start a new conversation.'
    })
    expect(
      assessTerminalProfileRestart({
        currentProfileId: 'pwsh',
        targetProfileId: 'cmd',
        agent: {
          agentId: 'custom:reviewer',
          customLaunchCmd: 'reviewer --interactive'
        }
      })
    ).toEqual({
      disabled: false,
      warningCode: 'new-custom-conversation',
      warning:
        'Custom agents cannot resume a prior conversation. Restarting will start a new conversation with the current custom launch command.'
    })
  })
})
