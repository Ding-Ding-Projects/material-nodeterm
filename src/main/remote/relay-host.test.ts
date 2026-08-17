// The merge gate for Stage 4c Task 5 (docs/remote-sessions.md): a bridged relay peer is a
// FIRST-CLASS CorePlatform client of this desktop's core.
//
// Nothing is faked here except the electron shell boundary (electron + ./main-window, mocked exactly
// as platform-electron.test.ts / peer-integration.test.ts do) and the relay WIRE (an in-process
// RelayTransport pair — the same fake relay-trust.test.ts drives). The E2EE handshake, the tunnel,
// the trust gate, electronPlatform, the peer registry (with the real Stage-2 UiSinkRegistry
// backpressure), the presence hub and the canvas reflector are all the REAL, wired objects.
//
// OBLIGATION 2 (the merge gate, first test below): the peer sink's bufferedAmount() must report the
// RELAY SOCKET's real buffered bytes. Stage 2's per-client backpressure and the 8 MB WS_DROP_WATER
// drop-and-redraw ceiling key on that ONE number. A sink that returns a constant 0 passes every
// other test in this file and silently disables the ceiling: a slow peer then queues pty output
// without bound, nothing pauses the pty or drops its backlog, and the HOST'S MEMORY GROWS UNTIL THE
// PROCESS DIES.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h: {
  handlers: Record<string, (...a: any[]) => unknown>
  sent: Array<{ id?: number; channel: string; args: any[] }>
  clientIds: number[]
} = { handlers: {}, sent: [], clientIds: [] }

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ud', getVersion: () => '9.9.9', isPackaged: false },
  ipcMain: {
    handle: (ch: string, fn: (...a: any[]) => unknown) => {
      h.handlers[ch] = fn
    },
    on: (ch: string, fn: (...a: any[]) => void) => {
      h.handlers[ch] = fn
    }
  },
  webContents: {
    fromId: (id: number) =>
      id === 1
        ? {
            isDestroyed: () => false,
            send: (ch: string, ...args: any[]) => h.sent.push({ id, channel: ch, args })
          }
        : undefined
  },
  shell: { openExternal: vi.fn(async () => {}) }
}))

vi.mock('../main-window', () => ({
  sendToMain: (ch: string, ...args: any[]) => h.sent.push({ channel: ch, args }),
  mainWindowClientIds: () => h.clientIds
}))

// The on-disk pin store, in memory (relay-trust's default mutation path).
import { emptyApprovedDevices, type ApprovedDevices } from './approved-devices-core'
let disk: ApprovedDevices = emptyApprovedDevices()
vi.mock('./approved-devices', () => ({
  loadApprovedDevices: async () => disk,
  mutateApprovedDevices: async (mutation: (store: ApprovedDevices) => ApprovedDevices) => {
    disk = mutation(disk)
    return disk
  }
}))

import { connectRelayHost, killRelayHostsByPeerKey, type RelayHostSession } from './relay-host'
import { connectRelay, type RelayTransport } from './relay-socket'
import { createTrustGate, type TrustGate } from './relay-trust'
import { genKeyPair, publicKeyToB64 } from './e2ee'
import { electronPlatform, type ElectronPlatform } from '../platform-electron'
import {
  authorizeRelayPtyCreate,
  type RelayPtyCreateAuthority
} from '../relay-pty-create'
import { peerRegistry, unregisterPeerSink, wirePeerRegistry } from '../peer-registry'
import { presenceHub } from '../../core/presence/hub'
import { initCanvasSync } from '../../core/canvas-sync'
import { initPlatform, resetPlatformForTests } from '../../core/platform'
import { IPC } from '../../shared/ipc'
import { decodePtyData, E_UNAUTHORIZED } from '../../shared/rpc'
import type { CanvasNodeState, Workspace } from '../../shared/types'

const decoder = new TextDecoder()

/** Everything the boot wiring feeds the registry (index.ts wires the real PtyManager here). */
let flow: Array<{ id: number; sid: string; resume: boolean; owner: string }> = []
let gone: number[] = []
let capture = 'CURRENT SCREEN'
let platform: ElectronPlatform
let relayPtyAuthority: RelayPtyCreateAuthority

function responseFor(frames: string[], id: number): any {
  return frames
    .map((frame) => JSON.parse(frame))
    .find((message) => message.t === 'res' && message.id === id)
}

/**
 * A host session bridged to a REAL peer relay socket over an in-process transport pair. `buffered`
 * is the host transport's ws.bufferedAmount — the number the sink must surface.
 */
function openHostAgainstFakeRelay(opts?: {
  bufferedAmount?: () => number
  sharedProjectId?: string
}): {
  session: RelayHostSession
  peerKeyB64: string
  textFrames: string[]
  binaryFrames: Uint8Array[]
  resyncs: string[]
  pending: RelayHostSession[]
  opens: RelayHostSession[]
  closes: () => number
  peerSendsTunnelText: (json: string) => void
  /** The relay drops the socket under the host (what a vanished peer looks like). */
  dropSocket: () => void
  /** Both humans press Confirm; resolves once the peer is a platform client. */
  openMutually: () => Promise<void>
} {
  const hostKeys = genKeyPair()
  const peerKeys = genKeyPair()
  const bufferedAmount = opts?.bufferedAmount ?? ((): number => 0)

  let hostOnMsg: ((d: unknown) => void) | null = null
  let peerOnMsg: ((d: unknown) => void) | null = null
  let hostOnClose: (() => void) | null = null
  let peerOnClose: (() => void) | null = null

  const hostT: RelayTransport = {
    get bufferedAmount() {
      return bufferedAmount()
    },
    send: (d) => peerOnMsg?.(d),
    close: () => peerOnClose?.(),
    onMessage: (cb) => {
      hostOnMsg = cb
    },
    onClose: (cb) => {
      hostOnClose = cb
    }
  }
  const peerT: RelayTransport = {
    bufferedAmount: 0,
    send: (d) => hostOnMsg?.(d),
    close: () => hostOnClose?.(),
    onMessage: (cb) => {
      peerOnMsg = cb
    },
    onClose: (cb) => {
      peerOnClose = cb
    }
  }

  const pending: RelayHostSession[] = []
  const opens: RelayHostSession[] = []
  let closes = 0

  // The host FIRST: it waits passively for the peer's e2ee_hello.
  const session = connectRelayHost({
    url: 'wss://relay.example',
    token: 'tok',
    ourKeys: hostKeys,
    platform,
    transport: hostT,
    sharedProjectId: opts?.sharedProjectId,
    onPeerPending: (s) => pending.push(s),
    onOpen: (s) => opens.push(s),
    onClose: () => {
      closes++
    }
  })

  const textFrames: string[] = []
  const binaryFrames: Uint8Array[] = []
  const resyncs: string[] = []
  let peerGate: TrustGate | null = null
  let peerStore: ApprovedDevices = emptyApprovedDevices()

  const peerSocket = connectRelay({
    url: 'wss://relay.example',
    token: 'tok',
    role: 'client',
    ourKeys: peerKeys,
    theirPubB64: publicKeyToB64(hostKeys.publicKey),
    transport: peerT,
    onReady: () => {},
    onRpc: () => {},
    onFrame: () => {},
    onClose: () => {},
    onTunnel: (kind, payload) => {
      if (kind === 'binary') {
        binaryFrames.push(payload)
        return
      }
      const json = decoder.decode(payload)
      if (peerGate?.onTunnelText(json)) return // the host's own trust confirm
      textFrames.push(json)
      const m = JSON.parse(json)
      if (m.t === 'ev' && String(m.channel).startsWith('pty:resync:')) resyncs.push(String(m.args[0]))
    }
  })

  peerGate = createTrustGate({
    peerKeyB64: peerSocket.peerPublicKeyB64()!,
    sessionId: 'peer-side',
    sas: () => peerSocket.sas(),
    sendConfirm: (json) => peerSocket.sendTunnelText(json),
    onOpen: () => {},
    mutate: async (mutation) => {
      peerStore = mutation(peerStore)
      return peerStore
    }
  })

  return {
    session,
    peerKeyB64: publicKeyToB64(peerKeys.publicKey),
    textFrames,
    binaryFrames,
    resyncs,
    pending,
    opens,
    closes: () => closes,
    peerSendsTunnelText: (json) => {
      peerSocket.sendTunnelText(json)
    },
    dropSocket: () => hostOnClose?.(),
    openMutually: async () => {
      session.confirm() // this human
      peerGate!.confirmHere() // the other human, over the ENCRYPTED tunnel
      await vi.waitFor(() => expect(session.clientId()).not.toBeNull())
    }
  }
}

beforeEach(() => {
  h.handlers = {}
  h.sent = []
  h.clientIds = [1] // the main window (a webContents client)
  disk = emptyApprovedDevices()
  flow = []
  gone = []
  capture = 'CURRENT SCREEN'
  relayPtyAuthority = {
    node: () => ({ status: 'missing' }),
    project: () => null,
    defaultTerminalProfileId: () => 'auto',
    sshRemote: () => null
  }
  platform = electronPlatform({
    authorizeRelayPtyCreate: (raw, source) =>
      authorizeRelayPtyCreate(relayPtyAuthority, raw, source)
  })
  initPlatform(platform)
  // The BOOT wiring (src/main/index.ts:120) — wired once, with the real PtyManager in production.
  wirePeerRegistry({
    setFlow: (id, sid, resume, owner) => flow.push({ id, sid, resume, owner }),
    captureForResync: async () => capture,
    onPeerGone: (id) => gone.push(id)
  })
  presenceHub.registerIpc()
  initCanvasSync()
})

afterEach(() => {
  for (const id of peerRegistry().ids()) unregisterPeerSink(id)
  for (const pe of presenceHub.peers()) presenceHub.leave(pe.clientId)
  resetPlatformForTests()
})

describe('relay host — obligation 2: the sink reports the relay socket’s REAL buffered bytes', () => {
  it('a slow peer trips the 8 MB ceiling and is dropped-and-redrawn, stalling neither a fast peer nor the desktop window', async () => {
    const slowBytes = { n: 0 }
    const slow = openHostAgainstFakeRelay({ bufferedAmount: () => slowBytes.n })
    await slow.openMutually()
    const fast = openHostAgainstFakeRelay() // a healthy link: nothing ever queues
    await fast.openMutually()

    const slowId = slow.session.clientId()!
    const fastId = fast.session.clientId()!

    // 1. pty output reaches the peer as a BINARY rpc.ts frame, over the E2EE tunnel.
    platform.sendTo(slowId, IPC.ptyData('s1'), 'hello')
    expect(decodePtyData(slow.binaryFrames[0])).toEqual({ sessionId: 's1', data: 'hello' })

    // 2. Past WS_DROP_WATER (8 MB) the chunk is DROPPED — bounded memory, not an unbounded backlog.
    //    This can ONLY happen if the sink surfaced the socket's real buffered bytes.
    slowBytes.n = 9_000_000
    platform.sendTo(slowId, IPC.ptyData('s1'), 'flood')
    expect(slow.binaryFrames).toHaveLength(1)

    // 3. The drowning peer stalls nobody: the fast peer and the desktop's own window keep streaming,
    //    and the SHARED pty is never paused for the dropped peer.
    platform.sendTo(fastId, IPC.ptyData('s1'), 'chunk')
    platform.sendTo(1, IPC.ptyData('s1'), 'chunk')
    expect(fast.binaryFrames).toHaveLength(1)
    expect(decodePtyData(fast.binaryFrames[0])).toEqual({ sessionId: 's1', data: 'chunk' })
    expect(h.sent.filter((x) => x.id === 1 && x.channel === IPC.ptyData('s1'))).toHaveLength(1)
    expect(flow).toEqual([])

    // 4. The socket drains → the peer is redrawn from tmux exactly once (current screen, not a
    //    replay of the 8 MB it missed).
    slowBytes.n = 1_000
    await vi.waitFor(() => expect(slow.resyncs).toEqual(['CURRENT SCREEN']))
    expect(fast.binaryFrames).toHaveLength(1) // untouched throughout
  })

  it('pauses the shared pty at the high-water mark and resumes below low, under the socket owner', async () => {
    const bytes = { n: 0 }
    const s = openHostAgainstFakeRelay({ bufferedAmount: () => bytes.n })
    await s.openMutually()
    const id = s.session.clientId()!

    bytes.n = 1_500_000 // above WS_HIGH_WATER (1 MB), below the drop ceiling
    platform.sendTo(id, IPC.ptyData('s1'), 'chunk')
    expect(flow).toEqual([{ id, sid: 's1', resume: false, owner: 'socket' }])

    bytes.n = 100_000 // drained below WS_LOW_WATER
    platform.sendTo(id, IPC.ptyData('s1'), 'chunk')
    expect(flow).toEqual([
      { id, sid: 's1', resume: false, owner: 'socket' },
      { id, sid: 's1', resume: true, owner: 'socket' }
    ])
  })
})

describe('relay host — presence, canvas and RPC reach a bridged peer', () => {
  it('an open peer joins presence and receives presence:sync + a seq-stamped canvas:mut', async () => {
    presenceHub.join(1, 'desktop') // the desktop's own window
    const s = openHostAgainstFakeRelay()
    await s.openMutually()
    const id = s.session.clientId()!

    const frames = s.textFrames.map((j) => JSON.parse(j))
    const sync = frames.find((m) => m.channel === IPC.presenceSync)
    expect(sync).toBeTruthy()
    expect(sync.args[0].some((pe: any) => pe.clientId === 1)).toBe(true) // not blind: it sees the host
    // A peer desktop is a 'desktop' peer, and the host sees it join.
    expect(presenceHub.peers().find((pe) => pe.clientId === id)?.kind).toBe('desktop')

    // The canvas reflector fans a host-side mutation out to the peer, seq-stamped.
    s.textFrames.length = 0
    h.handlers[IPC.canvasMut](
      { sender: { id: 1 } },
      'proj',
      { op: 'upsert', node: { id: 'n1', position: { x: 0, y: 0 } }, seq: 999 }
    )
    const mut = s.textFrames.map((j) => JSON.parse(j)).find((m) => m.channel === IPC.canvasMut)
    expect(mut).toBeTruthy()
    expect(mut.args[1].seq).toBe(1)
  })

  it('a peer RPC reaches the core and its response goes back over the tunnel', async () => {
    platform.handle('fs:list', async (dir: string) => [`${dir}/a.ts`])
    const s = openHostAgainstFakeRelay()
    await s.openMutually()

    s.peerSendsTunnelText(JSON.stringify({ t: 'req', id: 1, method: 'fs:list', args: ['/w'] }))
    await vi.waitFor(() =>
      expect(JSON.parse(s.textFrames.at(-1)!)).toMatchObject({
        t: 'res',
        id: 1,
        ok: true,
        result: ['/w/a.ts']
      })
    )
  })

  it('cold-reopens an existing terminal with the host-local profile snapshot, not hostile relay argv', async () => {
    const created: Array<{ senderId: number; options: any }> = []
    relayPtyAuthority = {
      node: () => ({
        status: 'found',
        projectId: 'proj-1',
        node: {
          id: 'term-local',
          kind: 'terminal',
          position: { x: 0, y: 0 },
          size: { width: 640, height: 360 },
          title: 'Trusted terminal',
          color: '#123456',
          group: null,
          cwd: String.raw`C:\trusted\node`
        },
        localExec: { terminalProfileId: 'pwsh' },
        projectCwd: String.raw`C:\trusted\project`
      }),
      project: () => null,
      // Simulate the host default changing after this node was snapshotted and its process ended.
      defaultTerminalProfileId: () => 'cmd',
      sshRemote: () => null
    }
    platform.handleWithSender(IPC.ptyCreate, (senderId, options) => {
      created.push({ senderId, options })
      return { sessionId: 'trusted-session', fresh: true }
    })
    const s = openHostAgainstFakeRelay({ sharedProjectId: 'proj-1' })
    await s.openMutually()

    s.peerSendsTunnelText(JSON.stringify({
      t: 'req',
      id: 21,
      method: IPC.ptyCreate,
      args: [{
        cols: 80,
        rows: 24,
        persistKey: 'term-local',
        profileId: 'custom',
        shell: 'cmd.exe',
        shellArgs: ['/d', '/s', '/c', 'echo NODETERM_RELAY_ARGV_MARKER'],
        cwd: String.raw`C:\attacker`,
        sshRemote: {
          controlPath: String.raw`C:\attacker\control`,
          conn: { host: 'attacker.example', user: 'mallory' },
          remoteCwd: '/attacker'
        },
        agentLaunchIntent: {
          kind: 'agent', action: 'start', agentId: 'claude',
          prompt: 'NODETERM_RELAY_ARGV_MARKER'
        },
        launchId: 'peer-launch-id'
      }]
    }))

    await vi.waitFor(() => expect(responseFor(s.textFrames, 21)).toMatchObject({ ok: true }))
    expect(created).toHaveLength(1)
    expect(created[0]!.senderId).toBe(s.session.clientId())
    expect(created[0]!.options).toEqual({
      cols: 80,
      rows: 24,
      persistKey: 'term-local',
      cwd: String.raw`C:\trusted\node`,
      profileId: 'pwsh'
    })
    expect(JSON.stringify(created)).not.toContain('NODETERM_RELAY_ARGV_MARKER')
    expect(JSON.stringify(created)).not.toContain('attacker.example')
  })

  it('snapshots the host default only for an exact session-introduced local node, then retires its deleted id', async () => {
    const created: any[] = []
    relayPtyAuthority = {
      node: () => ({ status: 'missing' }),
      project: (projectId) =>
        projectId === 'proj-1'
          ? { projectId, cwd: String.raw`C:\trusted\project` }
          : null,
      defaultTerminalProfileId: () => 'windows-powershell',
      sshRemote: () => null
    }
    platform.handle(IPC.ptyCreate, (options) => {
      created.push(options)
      return { sessionId: 'new-session', fresh: true }
    })
    const s = openHostAgainstFakeRelay({ sharedProjectId: 'proj-1' })
    await s.openMutually()
    const introducedNode = {
      id: 'new-local',
      kind: 'terminal',
      position: { x: 1, y: 2 },
      size: { width: 640, height: 360 },
      title: 'New terminal',
      color: '#123456',
      group: null,
      cwd: String.raw`C:\peer\requested`,
      terminalProfileId: 'custom',
      shell: 'cmd.exe',
      pendingLaunch: {
        after: [],
        launchId: '00000000-0000-4000-8000-000000000000',
        launch: { kind: 'shell-command', command: 'NODETERM_RELAY_ARGV_MARKER' }
      }
    }
    s.peerSendsTunnelText(JSON.stringify({
      t: 'cast', method: IPC.canvasMut,
      args: ['proj-1', { op: 'upsert', node: introducedNode }]
    }))
    s.peerSendsTunnelText(JSON.stringify({
      t: 'req', id: 22, method: IPC.ptyCreate,
      args: [{
        cols: 90, rows: 30, persistKey: 'new-local',
        profileId: 'custom', shell: 'cmd.exe',
        shellArgs: ['/c', 'NODETERM_RELAY_ARGV_MARKER'],
        agentLaunchIntent: {
          kind: 'agent', action: 'start', agentId: 'claude',
          prompt: 'NODETERM_RELAY_ARGV_MARKER'
        }
      }]
    }))

    await vi.waitFor(() => expect(responseFor(s.textFrames, 22)).toMatchObject({ ok: true }))
    expect(created).toEqual([{
      cols: 90,
      rows: 30,
      persistKey: 'new-local',
      cwd: String.raw`C:\trusted\project`,
      profileId: 'windows-powershell'
    }])
    expect(JSON.stringify(created)).not.toContain('NODETERM_RELAY_ARGV_MARKER')

    // Remove and attempt to reuse the same id in the same approved session. The second upsert is
    // not reflected/tracked, and pty:create is refused before its handler.
    s.peerSendsTunnelText(JSON.stringify({
      t: 'cast', method: IPC.canvasMut, args: ['proj-1', { op: 'remove', id: 'new-local' }]
    }))
    s.peerSendsTunnelText(JSON.stringify({
      t: 'cast', method: IPC.canvasMut,
      args: ['proj-1', { op: 'upsert', node: introducedNode }]
    }))
    s.peerSendsTunnelText(JSON.stringify({
      t: 'req', id: 23, method: IPC.ptyCreate,
      args: [{ cols: 90, rows: 30, persistKey: 'new-local' }]
    }))

    await vi.waitFor(() =>
      expect(responseFor(s.textFrames, 23)).toMatchObject({
        ok: false,
        error: { code: 'E_FORBIDDEN' }
      })
    )
    expect(created).toHaveLength(1)
  })

  it('refuses a cross-project introduced id before PTY creation', async () => {
    const create = vi.fn()
    relayPtyAuthority = {
      node: () => ({ status: 'missing' }),
      project: (projectId) => ({ projectId, cwd: '/trusted' }),
      defaultTerminalProfileId: () => 'auto',
      sshRemote: () => null
    }
    platform.handle(IPC.ptyCreate, create)
    const s = openHostAgainstFakeRelay({ sharedProjectId: 'proj-1' })
    await s.openMutually()
    s.peerSendsTunnelText(JSON.stringify({
      t: 'cast', method: IPC.canvasMut,
      args: ['proj-2', {
        op: 'upsert',
        node: {
          id: 'cross-project', kind: 'terminal', position: { x: 0, y: 0 },
          size: { width: 640, height: 360 }, title: 'Cross', color: '#123456', group: null
        }
      }]
    }))
    s.peerSendsTunnelText(JSON.stringify({
      t: 'req', id: 24, method: IPC.ptyCreate,
      args: [{ cols: 80, rows: 24, persistKey: 'cross-project' }]
    }))

    await vi.waitFor(() =>
      expect(responseFor(s.textFrames, 24)).toMatchObject({ ok: false, error: { code: 'E_FORBIDDEN' } })
    )
    expect(create).not.toHaveBeenCalled()
  })

  it('derives SSH launch state from the host binding and refuses a disconnected binding', async () => {
    const trustedSsh = {
      server: { host: 'trusted.example', user: 'alice', port: 2222 },
      remoteCwd: '/srv/project'
    }
    const trustedRemote = {
      controlPath: '/trusted/control.sock',
      conn: trustedSsh.server,
      remoteCwd: '/srv/node',
      hookEndpointPath: '/trusted/hooks.env'
    }
    let connected = true
    relayPtyAuthority = {
      node: (persistKey) => ({
        status: 'found',
        projectId: 'ssh-project',
        node: {
          id: persistKey,
          kind: 'terminal',
          position: { x: 0, y: 0 },
          size: { width: 640, height: 360 },
          title: 'Remote',
          color: '#123456',
          group: null,
          cwd: '/srv/node',
          sshRemoteTmux: true
        },
        projectSsh: trustedSsh
      }),
      project: () => null,
      defaultTerminalProfileId: () => 'cmd',
      sshRemote: () => connected ? trustedRemote : null
    }
    const created: any[] = []
    platform.handle(IPC.ptyCreate, (options) => {
      created.push(options)
      return { sessionId: 'remote-session', fresh: true }
    })
    const s = openHostAgainstFakeRelay({ sharedProjectId: 'ssh-project' })
    await s.openMutually()
    const forged = {
      cols: 80,
      rows: 24,
      persistKey: 'ssh-node',
      profileId: 'custom',
      shell: 'cmd.exe',
      shellArgs: ['/c', 'NODETERM_RELAY_ARGV_MARKER'],
      sshRemote: {
        controlPath: '/attacker/control',
        conn: { host: 'attacker.example', user: 'mallory', extraArgs: '-o ProxyCommand=marker' },
        remoteCwd: '/attacker'
      }
    }
    s.peerSendsTunnelText(JSON.stringify({
      t: 'req', id: 25, method: IPC.ptyCreate, args: [forged]
    }))

    await vi.waitFor(() => expect(responseFor(s.textFrames, 25)).toMatchObject({ ok: true }))
    expect(created).toEqual([{
      cols: 80,
      rows: 24,
      persistKey: 'ssh-node',
      cwd: '/srv/node',
      sshRemote: trustedRemote,
      requireRemote: true
    }])
    expect(JSON.stringify(created)).not.toContain('NODETERM_RELAY_ARGV_MARKER')
    expect(JSON.stringify(created)).not.toContain('attacker.example')

    connected = false
    s.peerSendsTunnelText(JSON.stringify({
      t: 'req', id: 26, method: IPC.ptyCreate, args: [{ ...forged, persistKey: 'ssh-offline' }]
    }))
    await vi.waitFor(() =>
      expect(responseFor(s.textFrames, 26)).toMatchObject({ ok: false, error: { code: 'E_FORBIDDEN' } })
    )
    expect(created).toHaveLength(1)
  })

  it('a peer CAST is attributed to the peer clientId', async () => {
    const casts: Array<[number, string]> = []
    platform.onWithSender('pty:write', (clientId: number, data: string) => casts.push([clientId, data]))
    const s = openHostAgainstFakeRelay()
    await s.openMutually()
    const id = s.session.clientId()!

    s.peerSendsTunnelText(JSON.stringify({ t: 'cast', method: 'pty:write', args: ['ls\r'] }))
    await vi.waitFor(() => expect(casts).toEqual([[id, 'ls\r']]))
  })
})

describe('relay host — workspace:load is scoped to the shared project', () => {
  const threeProjectWorkspace = (): Workspace => ({
    version: 2,
    activeProjectId: 'proj-0',
    projects: [
      { id: 'proj-0', name: 'zero', color: '#000', nodes: [], viewport: { x: 0, y: 0, zoom: 1 } },
      { id: 'proj-1', name: 'one', color: '#111', nodes: [], viewport: { x: 0, y: 0, zoom: 1 } },
      { id: 'proj-2', name: 'two', color: '#222', nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }
    ]
  })

  it('an approved relay workspace:save is forbidden before the host save handler runs', async () => {
    const saved: Workspace[] = []
    platform.handle(IPC.workspaceSave, async (workspace: Workspace) => {
      saved.push(workspace)
    })
    const s = openHostAgainstFakeRelay({ sharedProjectId: 'proj-1' })
    await s.openMutually()

    s.peerSendsTunnelText(JSON.stringify({
      t: 'req',
      id: 6,
      method: IPC.workspaceSave,
      args: [threeProjectWorkspace()]
    }))

    await vi.waitFor(() =>
      expect(responseFor(s.textFrames, 6)).toEqual({
        t: 'res',
        id: 6,
        ok: false,
        error: {
          code: 'E_FORBIDDEN',
          message: 'machine-local desktop operation is not available to relay peers'
        }
      })
    )
    expect(saved).toEqual([])
  })

  it('an approved relay cannot invoke the host semantic launch API', async () => {
    const launches: unknown[] = []
    platform.handle(IPC.ptyExecuteLaunchIntent, async (request: unknown) => {
      launches.push(request)
      return { ok: true }
    })
    const s = openHostAgainstFakeRelay({ sharedProjectId: 'proj-1' })
    await s.openMutually()

    s.peerSendsTunnelText(JSON.stringify({
      t: 'req',
      id: 61,
      method: IPC.ptyExecuteLaunchIntent,
      args: [{ persistKey: 'term-1', launchId: 'host-only', launch: { kind: 'shell-command', command: 'cmd.exe /c marker' } }]
    }))

    await vi.waitFor(() =>
      expect(responseFor(s.textFrames, 61)).toEqual({
        t: 'res',
        id: 61,
        ok: false,
        error: {
          code: 'E_FORBIDDEN',
          message: 'machine-local desktop operation is not available to relay peers'
        }
      })
    )
    expect(launches).toEqual([])
  })

  it('returns ONLY the shared project (activeProjectId retargeted) over a scoped session', async () => {
    platform.handle(IPC.workspaceLoad, async () => threeProjectWorkspace())
    const s = openHostAgainstFakeRelay({ sharedProjectId: 'proj-1' })
    await s.openMutually()

    s.peerSendsTunnelText(JSON.stringify({ t: 'req', id: 7, method: IPC.workspaceLoad, args: [] }))
    await vi.waitFor(() => {
      const res = JSON.parse(s.textFrames.at(-1)!)
      expect(res).toMatchObject({ t: 'res', id: 7, ok: true })
      expect(res.result.projects.map((p: any) => p.id)).toEqual(['proj-1'])
      expect(res.result.activeProjectId).toBe('proj-1')
    })
  })

  it('leaves a NON-workspace method (git:status) untouched on a scoped session', async () => {
    platform.handle(IPC.gitStatus, async () => ({ branch: 'main', files: [] }))
    const s = openHostAgainstFakeRelay({ sharedProjectId: 'proj-1' })
    await s.openMutually()

    s.peerSendsTunnelText(JSON.stringify({ t: 'req', id: 8, method: IPC.gitStatus, args: ['/w'] }))
    await vi.waitFor(() =>
      expect(JSON.parse(s.textFrames.at(-1)!)).toMatchObject({
        t: 'res',
        id: 8,
        ok: true,
        result: { branch: 'main', files: [] }
      })
    )
  })

  it('with NO sharedProjectId returns the FULL workspace unchanged', async () => {
    platform.handle(IPC.workspaceLoad, async () => threeProjectWorkspace())
    const s = openHostAgainstFakeRelay() // unscoped — legacy behaviour
    await s.openMutually()

    s.peerSendsTunnelText(JSON.stringify({ t: 'req', id: 9, method: IPC.workspaceLoad, args: [] }))
    await vi.waitFor(() => {
      const res = JSON.parse(s.textFrames.at(-1)!)
      expect(res).toMatchObject({ t: 'res', id: 9, ok: true })
      expect(res.result.projects.map((p: any) => p.id)).toEqual(['proj-0', 'proj-1', 'proj-2'])
      expect(res.result.activeProjectId).toBe('proj-0')
    })
  })

  it.each([
    ['a scoped session', 'proj-1'],
    ['an unscoped session', undefined]
  ])('strips machine-local execution state for %s', async (_label, sharedProjectId) => {
    const workspace = threeProjectWorkspace()
    const localNode: CanvasNodeState = {
      id: 'term-1',
      kind: 'terminal',
      position: { x: 1, y: 2 },
      size: { width: 640, height: 360 },
      title: 'Keep this title',
      color: '#abcdef',
      group: null,
      cwd: 'C:\\work\\project',
      shell: 'pwsh.exe',
      terminalProfileId: 'wsl:Ubuntu 24.04',
      ssh: {
        host: 'example.internal',
        user: 'alice',
        extraArgs: '-o ProxyCommand=corp-proxy %h',
        execTrusted: true
      }
    }
    workspace.projects[1].nodes = [localNode]
    platform.handle(IPC.workspaceLoad, async () => workspace)
    const s = openHostAgainstFakeRelay({ sharedProjectId })
    await s.openMutually()

    s.peerSendsTunnelText(JSON.stringify({ t: 'req', id: 10, method: IPC.workspaceLoad, args: [] }))
    await vi.waitFor(() => {
      const res = JSON.parse(s.textFrames.at(-1)!)
      const project = res.result.projects.find((p: any) => p.id === 'proj-1')
      expect(project.nodes[0]).toMatchObject({
        id: 'term-1',
        title: 'Keep this title',
        cwd: 'C:\\work\\project',
        ssh: { host: 'example.internal', user: 'alice' }
      })
      expect(project.nodes[0].shell).toBeUndefined()
      expect(project.nodes[0].terminalProfileId).toBeUndefined()
      expect(project.nodes[0].ssh.extraArgs).toBeUndefined()
      expect(project.nodes[0].ssh.execTrusted).toBeUndefined()
    })

    // Sanitization belongs at egress; the trusted host workspace remains available to its renderer.
    expect(localNode.shell).toBe('pwsh.exe')
    expect(localNode.terminalProfileId).toBe('wsl:Ubuntu 24.04')
    expect(localNode.ssh?.extraArgs).toBe('-o ProxyCommand=corp-proxy %h')
    expect(localNode.ssh?.execTrusted).toBe(true)
  })

  it('sanitizes workspace:probe-folder results before they cross the approved relay', async () => {
    const probed: CanvasNodeState = {
      id: 'probe-term',
      kind: 'terminal',
      position: { x: 0, y: 0 },
      size: { width: 640, height: 360 },
      title: 'Probe',
      color: '#123456',
      group: null,
      shell: 'cmd.exe',
      terminalProfileId: 'custom',
      pendingLaunch: {
        after: [],
        launchId: '00000000-0000-4000-8000-000000000000',
        launch: { kind: 'shell-command', command: 'NODETERM_PROBE_MARKER' }
      },
      ssh: {
        host: 'trusted.example',
        user: 'alice',
        extraArgs: '-o ProxyCommand=NODETERM_PROBE_MARKER',
        execTrusted: true
      }
    }
    const project = {
      id: 'probe-project',
      name: 'Probed',
      color: '#123456',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [probed]
    }
    platform.handle(IPC.workspaceProbeFolder, async () => project)
    const s = openHostAgainstFakeRelay()
    await s.openMutually()

    s.peerSendsTunnelText(JSON.stringify({
      t: 'req', id: 27, method: IPC.workspaceProbeFolder, args: ['/trusted/project']
    }))

    await vi.waitFor(() => expect(responseFor(s.textFrames, 27)).toMatchObject({ ok: true }))
    expect(responseFor(s.textFrames, 27).result.nodes).toEqual([{
      id: 'probe-term',
      kind: 'terminal',
      position: { x: 0, y: 0 },
      size: { width: 640, height: 360 },
      title: 'Probe',
      color: '#123456',
      group: null,
      ssh: { host: 'trusted.example', user: 'alice' }
    }])
    expect(JSON.stringify(responseFor(s.textFrames, 27))).not.toContain('NODETERM_PROBE_MARKER')
    // Egress-only: the host object remains available to its native renderer/store.
    expect(probed.shell).toBe('cmd.exe')
    expect(probed.pendingLaunch).toBeDefined()
  })
})

describe('relay host — GitHub issue RPCs are scoped to the shared project', () => {
  it('rejects every cross-project request before a GitHub handler can run', async () => {
    const reached: string[] = []
    const methods: Array<[string, unknown[]]> = [
      [IPC.githubIssuesSubscribe, [{ projectId: 'proj-2' }]],
      [IPC.githubIssuesQuery, [{ projectId: 'proj-2', columnId: null, pageSize: 50 }]],
      [IPC.githubIssuesRefresh, ['proj-2', true]],
      [IPC.githubIssuesMove, [{ projectId: 'proj-2', issueNumber: 7, toColumnId: null,
        expectedUpdatedAt: '2026-08-09T00:00:00Z' }]],
      [IPC.githubIssuesCreateLabels, ['proj-2']],
      [IPC.githubIssuesClearCache, ['proj-2']]
    ]
    for (const [method] of methods) platform.handle(method, async () => { reached.push(method) })
    const s = openHostAgainstFakeRelay({ sharedProjectId: 'proj-1' })
    await s.openMutually()

    for (let index = 0; index < methods.length; index++) {
      const [method, args] = methods[index]
      s.peerSendsTunnelText(JSON.stringify({ t: 'req', id: 100 + index, method, args }))
    }

    await vi.waitFor(() => expect(s.textFrames.filter((frame) => {
      const message = JSON.parse(frame)
      return message.t === 'res' && message.id >= 100
    })).toHaveLength(methods.length))
    const responses = s.textFrames.map((frame) => JSON.parse(frame))
      .filter((message) => message.t === 'res' && message.id >= 100)
    expect(responses.every((response) =>
      response.ok === false && response.error.code === 'E_FORBIDDEN')).toBe(true)
    expect(reached).toEqual([])
  })

  it('drops cross-project unsubscribe casts but permits the shared project', async () => {
    const calls: Array<[number, string]> = []
    platform.onWithSender(IPC.githubIssuesUnsubscribe, (uiId, projectId) => calls.push([uiId, projectId]))
    const s = openHostAgainstFakeRelay({ sharedProjectId: 'proj-1' })
    await s.openMutually()
    const uiId = s.session.clientId()!

    s.peerSendsTunnelText(JSON.stringify({
      t: 'cast', method: IPC.githubIssuesUnsubscribe, args: ['proj-2']
    }))
    s.peerSendsTunnelText(JSON.stringify({
      t: 'cast', method: IPC.githubIssuesUnsubscribe, args: ['proj-1']
    }))

    await vi.waitFor(() => expect(calls).toEqual([[uiId, 'proj-1']]))
  })
})

describe('relay host — nothing is served before mutual approval', () => {
  it('a peer RPC BEFORE mutual approval is refused (no dispatch, no sink, no presence)', async () => {
    let created = 0
    platform.handle('pty:create', async () => {
      created++
      return { id: 'x' }
    })
    const s = openHostAgainstFakeRelay() // E2EE is up, approval is NOT given
    expect(s.pending).toHaveLength(1) // the SAS is known: ask the human
    expect(s.session.sas()).toMatch(/^\d{3} \d{3}$/)

    s.peerSendsTunnelText(
      JSON.stringify({ t: 'req', id: 1, method: 'pty:create', args: [{ cols: 80, rows: 24 }] })
    )
    await new Promise((r) => setTimeout(r, 20))

    // Answered (an unanswered request would hang the peer's await) but REFUSED.
    expect(JSON.parse(s.textFrames.at(-1)!)).toMatchObject({
      t: 'res',
      id: 1,
      ok: false,
      error: { code: E_UNAUTHORIZED }
    })
    expect(created).toBe(0)
    expect(s.session.clientId()).toBeNull()
    expect(peerRegistry().ids()).toEqual([])
    expect(presenceHub.peers()).toEqual([])
    expect(s.opens).toEqual([])
  })

  it('a peer CAST before mutual approval is DROPPED (no dispatch, no sink, no presence)', async () => {
    // The req case is covered above; a cast has no id to answer, so the code silently drops it. Prove
    // it never reaches a handler: a pre-approval pty:write must not run a command on this machine.
    const casts: Array<[number, string]> = []
    platform.onWithSender('pty:write', (clientId: number, data: string) => casts.push([clientId, data]))
    const s = openHostAgainstFakeRelay() // E2EE is up, approval is NOT given
    expect(s.pending).toHaveLength(1)

    s.peerSendsTunnelText(JSON.stringify({ t: 'cast', method: 'pty:write', args: ['rm -rf ~\r'] }))
    await new Promise((r) => setTimeout(r, 20))

    expect(casts).toEqual([]) // never dispatched
    expect(s.session.clientId()).toBeNull()
    expect(peerRegistry().ids()).toEqual([])
    expect(presenceHub.peers()).toEqual([])
    expect(s.opens).toEqual([])
  })

  it('ONE human confirming is not enough — the peer is still not a client', async () => {
    const s = openHostAgainstFakeRelay()
    s.session.confirm() // only this side
    await new Promise((r) => setTimeout(r, 20))
    expect(s.session.clientId()).toBeNull()
    expect(peerRegistry().ids()).toEqual([])
  })
})

describe('relay host — teardown mirrors src/server/ws.ts', () => {
  it('a socket close runs the FULL teardown exactly once (leave + dropClient + prune)', async () => {
    const s = openHostAgainstFakeRelay()
    await s.openMutually()
    const id = s.session.clientId()!
    expect(peerRegistry().ids()).toContain(id)

    s.dropSocket()

    expect(presenceHub.peers().some((pe) => pe.clientId === id)).toBe(false) // 1. no ghost peer
    expect(gone).toEqual([id]) // 2. PtyManager.dropClient
    expect(peerRegistry().ids()).not.toContain(id) // 3. sink + backpressure pruned
    expect(s.session.clientId()).toBeNull()
    expect(s.closes()).toBe(1)

    // Idempotent: an explicit close() after the socket already went does not tear down twice.
    s.session.close()
    expect(gone).toEqual([id])
  })

  it('close() tears the peer down and is idempotent', async () => {
    const s = openHostAgainstFakeRelay()
    await s.openMutually()
    const id = s.session.clientId()!

    s.session.close()
    s.session.close()

    expect(gone).toEqual([id])
    expect(peerRegistry().ids()).toEqual([])
    expect(presenceHub.peers().some((pe) => pe.clientId === id)).toBe(false)
  })

  it('revoking a peer key CUTS the live session (not just the pin)', async () => {
    const s = openHostAgainstFakeRelay()
    await s.openMutually()
    const id = s.session.clientId()!

    killRelayHostsByPeerKey(s.peerKeyB64)

    expect(peerRegistry().ids()).not.toContain(id)
    expect(gone).toEqual([id])
    expect(presenceHub.peers().some((pe) => pe.clientId === id)).toBe(false)
    // A stranger's key cuts nothing.
    killRelayHostsByPeerKey('some-other-key')
  })
})
