import { describe, expect, it, vi } from 'vitest'
import type { TrustedNodeLaunchLookup } from '../core/workspace-store'
import type { CanvasNodeState, Project, PtyCreateOptions } from '../shared/types'
import {
  authorizeRelayPtyCreate,
  type RelayPtyCreateAuthority,
  type TrustedProjectLaunchContext
} from './relay-pty-create'

const node = (id = 'term-local', extra: Partial<CanvasNodeState> = {}): CanvasNodeState => ({
  id,
  kind: 'terminal',
  position: { x: 0, y: 0 },
  size: { width: 640, height: 360 },
  title: 'Terminal',
  color: '#123456',
  group: null,
  ...extra
})

const hostile = (persistKey = 'term-local'): Record<string, unknown> => ({
  cols: 80,
  rows: 24,
  persistKey,
  viewerId: 'view-1',
  profileId: 'custom',
  shell: 'cmd.exe',
  shellArgs: ['/d', '/s', '/c', 'echo NODETERM_RELAY_ARGV_MARKER'],
  cwd: String.raw`C:\attacker`,
  agentId: 'custom:attacker',
  accountId: 'attacker-account',
  requireRemote: true,
  sshRemote: {
    controlPath: String.raw`C:\attacker\control`,
    conn: { host: 'attacker.example', user: 'mallory', extraArgs: '-o ProxyCommand=marker' },
    remoteCwd: '/attacker'
  },
  agentLaunchIntent: {
    kind: 'agent',
    action: 'start',
    agentId: 'claude',
    prompt: 'NODETERM_RELAY_ARGV_MARKER'
  },
  launchId: 'peer-launch-id',
  pendingLaunch: { launch: { kind: 'shell-command', command: 'NODETERM_RELAY_ARGV_MARKER' } },
  futureExecutable: 'NODETERM_RELAY_ARGV_MARKER'
})

function authority(options: {
  lookup?: TrustedNodeLaunchLookup
  project?: TrustedProjectLaunchContext | null
  defaultProfile?: string
  remote?: NonNullable<PtyCreateOptions['sshRemote']> | null
} = {}): RelayPtyCreateAuthority & {
  node: ReturnType<typeof vi.fn>
  project: ReturnType<typeof vi.fn>
  sshRemote: ReturnType<typeof vi.fn>
} {
  const lookup = options.lookup ?? { status: 'missing' }
  const project = options.project ?? null
  const remote = options.remote ?? null
  return {
    node: vi.fn(() => lookup),
    project: vi.fn(() => project),
    defaultTerminalProfileId: () => options.defaultProfile ?? 'windows-powershell',
    sshRemote: vi.fn(() => remote)
  }
}

describe('authorizeRelayPtyCreate', () => {
  it('cold-reopens an existing node with its host snapshot, never peer executable state', () => {
    const a = authority({
      defaultProfile: 'cmd', // changed later; the node snapshot must still win
      lookup: {
        status: 'found',
        projectId: 'project-1',
        node: node('term-local', {
          cwd: String.raw`C:\trusted\node`,
          agentId: 'codex',
          accountId: 'host-account'
        }),
        localExec: { terminalProfileId: 'pwsh' },
        projectCwd: String.raw`C:\trusted\project`
      }
    })

    const decision = authorizeRelayPtyCreate(a, hostile(), { sharedProjectId: 'project-1' })

    expect(decision).toEqual({
      ok: true,
      options: {
        cols: 80,
        rows: 24,
        persistKey: 'term-local',
        viewerId: 'view-1',
        cwd: String.raw`C:\trusted\node`,
        agentId: 'codex',
        accountId: 'host-account',
        profileId: 'pwsh'
      }
    })
    expect(JSON.stringify(decision)).not.toContain('NODETERM_RELAY_ARGV_MARKER')
    expect(a.project).not.toHaveBeenCalled()
    expect(a.sshRemote).not.toHaveBeenCalled()
  })

  it('preserves a trusted legacy per-node shell instead of replacing it with today’s default', () => {
    const a = authority({
      lookup: {
        status: 'found',
        projectId: 'project-1',
        node: node(),
        // Old mixed records exist; the renderer's compatibility rule gives shell precedence.
        localExec: { shell: 'fish', terminalProfileId: 'cmd' }
      }
    })

    expect(authorizeRelayPtyCreate(a, hostile(), { sharedProjectId: 'project-1' })).toEqual({
      ok: true,
      options: {
        cols: 80,
        rows: 24,
        persistKey: 'term-local',
        viewerId: 'view-1',
        shell: 'fish'
      }
    })
  })

  it('uses the host current default when a legacy existing node has no snapshot', () => {
    const a = authority({
      defaultProfile: 'git-bash',
      lookup: { status: 'found', projectId: 'project-1', node: node() }
    })

    const decision = authorizeRelayPtyCreate(a, hostile(), { sharedProjectId: 'project-1' })
    expect(decision).toMatchObject({ ok: true, options: { profileId: 'git-bash' } })
    expect(JSON.stringify(decision)).not.toContain('NODETERM_RELAY_ARGV_MARKER')
  })

  it('accepts only a session-introduced new local id and snapshots the host default/project cwd', () => {
    const introduced = node('brand-new', {
      cwd: String.raw`C:\peer\requested`,
      agentId: 'gemini',
      accountId: 'host-visible-account'
    })
    const a = authority({
      defaultProfile: 'windows-powershell',
      project: { projectId: 'project-1', cwd: String.raw`C:\host\project` }
    })

    const decision = authorizeRelayPtyCreate(a, hostile('brand-new'), {
      sharedProjectId: 'project-1',
      introducedNode: { projectId: 'project-1', node: introduced }
    })

    expect(decision).toEqual({
      ok: true,
      options: {
        cols: 80,
        rows: 24,
        persistKey: 'brand-new',
        viewerId: 'view-1',
        cwd: String.raw`C:\host\project`,
        agentId: 'gemini',
        accountId: 'host-visible-account',
        profileId: 'windows-powershell'
      }
    })
    expect(JSON.stringify(decision)).not.toContain('NODETERM_RELAY_ARGV_MARKER')
  })

  it('does not promote malformed introduced agent/account metadata into process state', () => {
    const introduced = node('brand-new', {
      agentId: '../../attacker',
      accountId: '../attacker'
    })
    const a = authority({
      project: { projectId: 'project-1', cwd: String.raw`C:\host\project` }
    })

    expect(authorizeRelayPtyCreate(a, hostile('brand-new'), {
      sharedProjectId: 'project-1',
      introducedNode: { projectId: 'project-1', node: introduced }
    })).toEqual({
      ok: true,
      options: {
        cols: 80,
        rows: 24,
        persistKey: 'brand-new',
        viewerId: 'view-1',
        cwd: String.raw`C:\host\project`,
        profileId: 'windows-powershell'
      }
    })
  })

  it.each([
    ['unknown id', {}, 'the terminal is not present in authoritative host state'],
    [
      'removed/reused id',
      { retiredPersistKey: true },
      'this relay session already removed that terminal identity'
    ],
    [
      'cross-project introduction',
      { introducedNode: { projectId: 'project-2', node: node() } },
      'the introduced terminal is outside this relay session project'
    ]
  ])('fails closed for a %s', (_label, source, message) => {
    const a = authority({ project: { projectId: 'project-2', cwd: '/trusted' } })
    expect(
      authorizeRelayPtyCreate(a, hostile(), {
        sharedProjectId: 'project-1',
        ...source
      })
    ).toEqual({ ok: false, message })
  })

  it('replaces a forged SSH plan with the live trusted project binding', () => {
    const projectSsh = {
      server: { host: 'trusted.example', user: 'alice', port: 2222 },
      remoteCwd: '/srv/project'
    } satisfies NonNullable<Project['ssh']>
    const trustedRemote: NonNullable<PtyCreateOptions['sshRemote']> = {
      controlPath: '/trusted/control.sock',
      conn: projectSsh.server,
      remoteCwd: '/srv/node',
      hookEndpointPath: '/trusted/hooks.env',
      tmuxConfPath: '/trusted/tmux.conf',
      remoteHome: '/home/alice'
    }
    const a = authority({
      lookup: {
        status: 'found',
        projectId: 'ssh-project',
        node: node('remote-node', { cwd: '/srv/node', sshRemoteTmux: true }),
        projectSsh
      },
      remote: trustedRemote
    })

    const decision = authorizeRelayPtyCreate(a, hostile('remote-node'), {
      sharedProjectId: 'ssh-project'
    })

    expect(decision).toEqual({
      ok: true,
      options: {
        cols: 80,
        rows: 24,
        persistKey: 'remote-node',
        viewerId: 'view-1',
        cwd: '/srv/node',
        sshRemote: trustedRemote,
        requireRemote: true
      }
    })
    expect(a.sshRemote).toHaveBeenCalledWith('ssh-project', projectSsh, '/srv/node')
    expect(JSON.stringify(decision)).not.toContain('attacker')
    expect(JSON.stringify(decision)).not.toContain('NODETERM_RELAY_ARGV_MARKER')
  })

  it('fails before the PTY handler when an SSH project has no trusted live binding', () => {
    const projectSsh = {
      server: { host: 'trusted.example', user: 'alice' },
      remoteCwd: '/srv/project'
    } satisfies NonNullable<Project['ssh']>
    const a = authority({
      lookup: {
        status: 'found',
        projectId: 'ssh-project',
        node: node('remote-node', { sshRemoteTmux: true }),
        projectSsh
      },
      remote: null
    })

    expect(
      authorizeRelayPtyCreate(a, hostile('remote-node'), { sharedProjectId: 'ssh-project' })
    ).toEqual({
      ok: false,
      message: 'the terminal belongs to an SSH project whose trusted host binding is unavailable'
    })
  })

  it('treats lookup uncertainty as a refusal, never as evidence that the node is new', () => {
    const a = authority({
      lookup: { status: 'unavailable', reason: 'project-source-unavailable' },
      project: { projectId: 'project-1', cwd: '/trusted' }
    })
    expect(
      authorizeRelayPtyCreate(a, hostile(), {
        sharedProjectId: 'project-1',
        introducedNode: { projectId: 'project-1', node: node() }
      })
    ).toEqual({
      ok: false,
      message: 'the host could not establish authoritative terminal state (project-source-unavailable)'
    })
    expect(a.project).not.toHaveBeenCalled()
  })
})
