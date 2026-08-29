import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasMutation, CanvasNodeState } from '@shared/types'
import { useSettings } from './settings'
import {
  applyMutationToFlow,
  createAccountLoginNode,
  createAgentNode,
  createSshTerminalNode,
  createTerminalNode,
  flowToNodeStates,
  nodeStatesToFlow,
  type CanvasNode
} from './workspace'

const originalSettings = useSettings.getState().settings
const originalBase = useSettings.getState().base
const localWindowsDesktop = { sessionSource: 'local' as const }

function setRendererCapability(platform: string, desktopProfilesAvailable: boolean): void {
  vi.stubGlobal('navigator', { platform, userAgent: platform })
  vi.stubGlobal('window', {
    nodeTerminal: desktopProfilesAvailable
      ? {
          terminalProfiles: {
            list: async () => [],
            refresh: async () => []
          }
        }
      : {}
  })
}

function setDefaultTerminalProfileId(id: string | undefined): void {
  useSettings.setState((state) => ({
    settings: Object.assign({}, state.settings, { defaultTerminalProfileId: id }),
    base: Object.assign({}, state.base, { defaultTerminalProfileId: id })
  }))
}

function state(
  id: string,
  terminalProfileId?: string,
  ssh?: CanvasNodeState['ssh']
): CanvasNodeState {
  return {
    id,
    kind: 'terminal',
    position: { x: 0, y: 0 },
    size: { width: 640, height: 440 },
    title: id,
    color: '#fff',
    group: null,
    terminalProfileId,
    ssh
  }
}

beforeEach(() => {
  setDefaultTerminalProfileId('auto')
  setRendererCapability('Win32', true)
})

afterEach(() => {
  useSettings.setState({ settings: originalSettings, base: originalBase })
  vi.unstubAllGlobals()
})

describe('terminal profile snapshots on node creation', () => {
  it('snapshots the configured default on new local terminal and agent nodes', () => {
    setDefaultTerminalProfileId('pwsh')

    expect(
      createTerminalNode(0, undefined, undefined, undefined, undefined, localWindowsDesktop).data
        .terminalProfileId
    ).toBe('pwsh')
    expect(
      createAgentNode(
        'codex',
        1,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        localWindowsDesktop
      ).data.terminalProfileId
    ).toBe('pwsh')
    expect(
      createAccountLoginNode('account-1', 2, undefined, undefined, localWindowsDesktop).data
        .terminalProfileId
    ).toBe('pwsh')
  })

  it('lets an explicit profile selection override the configured default', () => {
    const terminal = createTerminalNode(0, undefined, undefined, undefined, undefined, {
      sessionSource: 'local',
      terminalProfileId: 'cmd'
    })
    const agent = createAgentNode(
      'codex',
      1,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { sessionSource: 'local', terminalProfileId: 'git-bash' }
    )

    expect(terminal.data.terminalProfileId).toBe('cmd')
    expect(agent.data.terminalProfileId).toBe('git-bash')
  })

  it('never stamps a local Windows profile onto SSH-project or saved-SSH nodes', () => {
    const ssh = {
      server: { host: 'example.test', user: 'dev' },
      remoteCwd: '/srv/app'
    } as NonNullable<Parameters<typeof createTerminalNode>[4]>
    const terminal = createTerminalNode(0, undefined, undefined, undefined, ssh, {
      sessionSource: 'local',
      terminalProfileId: 'cmd'
    })
    const agent = createAgentNode(
      'codex',
      1,
      undefined,
      undefined,
      undefined,
      ssh,
      undefined,
      undefined,
      { sessionSource: 'local', terminalProfileId: 'git-bash' }
    )
    const savedSsh = createSshTerminalNode(
      {
        id: 'saved-ssh',
        label: 'Saved SSH',
        host: 'example.test',
        user: 'dev'
      } as Parameters<typeof createSshTerminalNode>[0],
      2
    )
    const accountLogin = createAccountLoginNode('account-1', 3, undefined, ssh, {
      sessionSource: 'local',
      terminalProfileId: 'pwsh'
    })

    expect(terminal.data.terminalProfileId).toBeUndefined()
    expect(agent.data.terminalProfileId).toBeUndefined()
    expect(savedSsh.data.terminalProfileId).toBeUndefined()
    expect(accountLogin.data.terminalProfileId).toBeUndefined()
  })

  it.each(['relay', 'server'] as const)(
    'does not stamp the default or an explicit profile onto %s-session nodes',
    (sessionSource) => {
      const terminal = createTerminalNode(0, undefined, undefined, undefined, undefined, {
        sessionSource
      })
      const agent = createAgentNode(
        'codex',
        1,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { sessionSource, terminalProfileId: 'git-bash' }
      )

      expect(terminal.data.terminalProfileId).toBeUndefined()
      expect(agent.data.terminalProfileId).toBeUndefined()
    }
  )

  it('does not stamp profiles without the local Windows desktop capability', () => {
    setRendererCapability('Linux x86_64', true)
    expect(
      createTerminalNode(0, undefined, undefined, undefined, undefined, {
        sessionSource: 'local',
        terminalProfileId: 'cmd'
      }).data.terminalProfileId
    ).toBeUndefined()

    setRendererCapability('Win32', false)
    expect(
      createAgentNode(
        'codex',
        1,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { sessionSource: 'local', terminalProfileId: 'git-bash' }
      ).data.terminalProfileId
    ).toBeUndefined()
  })

  it('fails closed when the caller omits session context', () => {
    expect(createTerminalNode(0).data.terminalProfileId).toBeUndefined()
    expect(createAgentNode('codex', 1).data.terminalProfileId).toBeUndefined()
  })
})

describe('terminal profile workspace propagation', () => {
  it('round-trips a selected local profile through flow state', () => {
    const node = createTerminalNode(0, undefined, undefined, undefined, undefined, {
      sessionSource: 'local',
      terminalProfileId: 'wsl:Ubuntu 24.04'
    })

    const saved = flowToNodeStates([node])
    expect(saved[0].terminalProfileId).toBe('wsl:Ubuntu 24.04')
    expect(nodeStatesToFlow(saved)[0].data.terminalProfileId).toBe('wsl:Ubuntu 24.04')
  })

  it('keeps a legacy node unset instead of backfilling the current default during hydration', () => {
    setDefaultTerminalProfileId('pwsh')

    const [legacy] = nodeStatesToFlow([state('legacy')])
    expect(legacy.data.terminalProfileId).toBeUndefined()
    expect(flowToNodeStates([legacy])[0].terminalProfileId).toBeUndefined()
  })

  it('drops a profile from SSH state in both serialization directions', () => {
    const ssh = { host: 'example.test', user: 'dev' } as NonNullable<CanvasNodeState['ssh']>
    const [hydrated] = nodeStatesToFlow([state('ssh', 'pwsh', ssh)])
    expect(hydrated.data.terminalProfileId).toBeUndefined()

    const localWithSsh = {
      ...hydrated,
      data: { ...hydrated.data, terminalProfileId: 'cmd', ssh }
    } as CanvasNode
    expect(flowToNodeStates([localWithSsh])[0].terminalProfileId).toBeUndefined()
  })
})

describe('terminal profile peer-mutation boundary', () => {
  it('preserves the receiving machine\'s profile when a peer upserts the node', () => {
    const [local] = nodeStatesToFlow([state('term-1', 'pwsh')])
    const hostilePeerState = state('term-1', 'cmd')
    hostilePeerState.title = 'renamed by peer'
    const mutation: CanvasMutation = { op: 'upsert', node: hostilePeerState }

    const [updated] = applyMutationToFlow([local], mutation)
    expect(updated.data.title).toBe('renamed by peer')
    expect(updated.data.terminalProfileId).toBe('pwsh')
  })

  it('does not accept a profile on a node appended by a peer', () => {
    const mutation: CanvasMutation = { op: 'upsert', node: state('peer-new', 'cmd') }

    const [appended] = applyMutationToFlow([], mutation)
    expect(appended.data.terminalProfileId).toBeUndefined()
  })

  it('a Windows host replaces a hostile peer profile with its own default snapshot', () => {
    const mutation: CanvasMutation = { op: 'upsert', node: state('peer-new', 'cmd') }

    const [appended] = applyMutationToFlow([], mutation, 'pwsh')
    expect(appended.data.terminalProfileId).toBe('pwsh')
  })

  it('later host-default changes do not rewrite a profile already snapshotted for the node', () => {
    const first: CanvasMutation = { op: 'upsert', node: state('peer-new', 'cmd') }
    const accepted = applyMutationToFlow([], first, 'pwsh')
    const movedState = state('peer-new', 'windows-powershell')
    movedState.position = { x: 40, y: 10 }

    const [moved] = applyMutationToFlow(
      accepted,
      { op: 'upsert', node: movedState },
      'git-bash'
    )
    expect(moved.position).toEqual({ x: 40, y: 10 })
    expect(moved.data.terminalProfileId).toBe('pwsh')
  })

  it('clears the local profile if an inbound upsert makes the node SSH-backed', () => {
    const [local] = nodeStatesToFlow([state('term-1', 'pwsh')])
    const ssh = { host: 'example.test', user: 'dev' } as NonNullable<CanvasNodeState['ssh']>
    const mutation: CanvasMutation = { op: 'upsert', node: state('term-1', 'cmd', ssh) }

    const [updated] = applyMutationToFlow([local], mutation)
    expect(updated.data.ssh).toEqual(ssh)
    expect(updated.data.terminalProfileId).toBeUndefined()
  })
})
