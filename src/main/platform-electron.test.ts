import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h: {
  handlers: Record<string, (...a: any[]) => unknown>
  sent: Array<{ id?: number; channel: string; args: any[] }>
  clientIds: number[]
} = { handlers: {}, sent: [], clientIds: [] }

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/ud',
    getVersion: () => '9.9.9',
    isPackaged: false,
  },
  ipcMain: {
    handle: (ch: string, fn: (...a: any[]) => unknown) => {
      h.handlers[ch] = fn
    },
    on: (ch: string, fn: (...a: any[]) => void) => {
      h.handlers[ch] = fn
    },
  },
  webContents: {
    fromId: (id: number) =>
      id === 1
        ? { isDestroyed: () => false, send: (ch: string, ...args: any[]) => h.sent.push({ id, channel: ch, args }) }
        : undefined,
  },
  shell: { openExternal: vi.fn(async () => {}) },
}))

vi.mock('./main-window', () => ({
  sendToMain: (ch: string, ...args: any[]) => h.sent.push({ channel: ch, args }),
  mainWindowClientIds: () => h.clientIds,
}))

import { electronPlatform } from './platform-electron'
import {
  registerPeerSink,
  unregisterPeerSink,
  peerRegistry,
  wirePeerRegistry,
  type UiSink
} from './peer-registry'
import { decodePtyData } from '../shared/rpc'
import { allocateRelayClientId } from '../core/presence/hub'
import { IPC } from '../shared/ipc'

/** A relay peer id, as allocateRelayClientId() would mint it (≥ 1_000_000 — never a webContents id). */
const PEER = 1_000_000

/** A fake peer sink recording everything the platform pushed at it. */
function peerSink() {
  const text: string[] = []
  const binary: Uint8Array[] = []
  const sink: UiSink = {
    sendText: (json) => text.push(json),
    sendBinary: (buf) => binary.push(buf),
    bufferedAmount: () => 0
  }
  return { text, binary, sink }
}

beforeEach(() => {
  h.handlers = {}
  h.sent = []
  h.clientIds = []
  wirePeerRegistry({
    setFlow: () => {},
    captureForResync: async () => '',
    onPeerGone: () => {}
  })
})

afterEach(() => {
  // No cross-test leak: whatever a test registered is torn down (presence leave + registry prune).
  for (const id of peerRegistry().ids()) unregisterPeerSink(id)
})

describe('electronPlatform', () => {
  it('exposes app paths and version', () => {
    const p = electronPlatform()
    expect(p.userDataDir).toBe('/tmp/ud')
    expect(p.appVersion).toBe('9.9.9')
    expect(p.isPackaged).toBe(false)
  })

  it('strips the ipc event from handle/on and forwards sender id in handleWithSender', async () => {
    const p = electronPlatform()
    p.handle('c1', (a: number) => a + 1)
    expect(await h.handlers['c1']({ sender: { id: 1 } }, 41)).toBe(42)
    p.handleWithSender('c2', (senderId: number, a: string) => `${senderId}:${a}`)
    expect(await h.handlers['c2']({ sender: { id: 7 } }, 'x')).toBe('7:x')
  })

  it('clientIds reports the live main window (empty while there is no window)', () => {
    const p = electronPlatform()
    expect(p.clientIds()).toEqual([])
    h.clientIds = [5]
    expect(p.clientIds()).toEqual([5])
  })

  it('sendTo drops silently when the webContents is gone', () => {
    const p = electronPlatform()
    p.sendTo(1, 'ev', 'a')
    p.sendTo(999, 'ev', 'b') // must not throw
    expect(h.sent).toEqual([{ id: 1, channel: 'ev', args: ['a'] }])
  })
})

/**
 * The seam that makes a relay peer a FIRST-CLASS client of this desktop's core: a peer has no
 * webContents, so before this every sendTo/broadcast aimed at one silently no-op'd (the host saw the
 * phone, the phone saw nothing). All three members are now peer-aware — and, with no peer
 * registered, bit-identical to the webContents-only code they replaced.
 */
describe('electronPlatform + relay peers', () => {
  it('denies every raw relay request to the GitHub host-control namespace', async () => {
    const p = electronPlatform()
    p.handle('githubControl:approve', () => 'must-not-run')
    expect(await p.dispatch(PEER, {
      t: 'req', id: 9, method: 'githubControl:approve', args: []
    })).toEqual({
      t: 'res', id: 9, ok: false,
      error: { code: 'E_FORBIDDEN', message: 'host-control method is not available to relay peers' }
    })
  })

  it('default-denies machine-global credential and restoration handlers before invocation', async () => {
    const p = electronPlatform()
    const reached: string[] = []
    const authenticatorMethods: string[] = Object.values(IPC).flatMap((method) =>
      typeof method === 'string' && method.startsWith('authenticator:') ? [method] : []
    )
    expect(authenticatorMethods).toHaveLength(9)
    const passwordManagerMethods: string[] = Object.values(IPC).flatMap((method) =>
      typeof method === 'string' && method.startsWith('password-manager:') ? [method] : []
    )
    // 17 since `password-manager:list-credentials` (bc41b7aa). This count is a TRIPWIRE, not
    // bookkeeping: a new method arriving here is meant to make somebody decide whether a relay
    // peer may reach it. The decision for this one is NO. It returns credential labels and
    // timestamps, which is the user's data even though it is not the secret itself, and the
    // whole password-manager namespace stays on the viewing desktop.
    //
    // It had been failing since that commit and nobody saw it, because this repository's CI
    // deliberately runs no tests, so a red suite never turns a build red.
    expect(passwordManagerMethods).toHaveLength(17)
    const denied = [
      IPC.settingsLoad,
      IPC.schoolModeDisable,
      IPC.kidsModeChangePin,
      IPC.scheduledSettingsSetHaToken,
      IPC.licenseActivate,
      IPC.usageSetProviderCookie,
      IPC.toylockVerify,
      ...authenticatorMethods,
      ...passwordManagerMethods,
      IPC.contextLinkInfo,
      IPC.transcriptSearch,
      IPC.handoffBuild,
      IPC.historyRestore
    ]
    for (const method of denied) p.handle(method, () => reached.push(method))

    for (let i = 0; i < denied.length; i++) {
      await expect(p.dispatch(PEER, {
        t: 'req', id: 100 + i, method: denied[i]!, args: []
      })).resolves.toMatchObject({
        t: 'res', id: 100 + i, ok: false, error: { code: 'E_FORBIDDEN' }
      })
    }
    expect(reached).toEqual([])

    // The local renderer still reaches the same registration through Electron IPC. The allowlist
    // belongs only to the raw relay dispatch path; it must not disable the host's own UI.
    await h.handlers[IPC.authenticatorReveal]!({ sender: { id: 1 } }, 'entry-1')
    expect(reached).toEqual([IPC.authenticatorReveal])
  })

  // password-manager:reveal-credential / password-manager:credential-code decrypt this desktop's
  // stored credentials — exactly the class of namespace CLAUDE.md's "Relay RPC authorization is
  // an exact allowlist" section documents (same reasoning as authenticator:reveal above). A
  // mutually-approved relay peer gets shell-equivalent access to the joined project's files and
  // terminals, but must never unlock or read this desktop's vault. Prove the refusal happens
  // BEFORE the registered handler — i.e. before the vault store is even touched, not merely
  // before it answers.
  it('denies password-manager:reveal-credential to a relay peer before the handler is entered', async () => {
    const p = electronPlatform()
    let entered = false
    p.handle(IPC.passwordManagerRevealCredential, () => {
      entered = true
      return { ok: true, username: 'u', password: 'p' }
    })
    const res = await p.dispatch(PEER, {
      t: 'req',
      id: 42,
      method: IPC.passwordManagerRevealCredential,
      args: ['project-1', 'manager-1', 'cred-1']
    })
    expect(res).toMatchObject({ t: 'res', id: 42, ok: false, error: { code: 'E_FORBIDDEN' } })
    expect(entered).toBe(false)

    // Same registration reached normally through Electron IPC from the LOCAL renderer — the
    // allowlist governs only the raw relay dispatch path.
    await h.handlers[IPC.passwordManagerRevealCredential]!(
      { sender: { id: 1 } },
      'project-1',
      'manager-1',
      'cred-1'
    )
    expect(entered).toBe(true)
  })

  // WSL distribution management is machine-global in exactly the sense authenticator:* and
  // password-manager:* already are (CLAUDE.md, "Relay RPC authorization is an exact allowlist"):
  // a mutually-approved relay peer gets shell-equivalent access to the JOINED project, never to
  // this desktop's own machine-level state. Prove the refusal happens BEFORE the registered
  // handler is entered -- i.e. before wsl.exe is ever touched -- not merely before it answers.
  it('denies every wsl:* method to a relay peer before the handler is entered', async () => {
    const p = electronPlatform()
    const reached: string[] = []
    const wslMethods = [
      IPC.wslList,
      IPC.wslCatalogue,
      IPC.wslCreate,
      IPC.wslSleep,
      IPC.wslWake,
      IPC.wslDelete
    ]
    for (const method of wslMethods) p.handle(method, () => reached.push(method))

    for (let i = 0; i < wslMethods.length; i++) {
      await expect(p.dispatch(PEER, {
        t: 'req', id: 200 + i, method: wslMethods[i]!, args: []
      })).resolves.toMatchObject({
        t: 'res', id: 200 + i, ok: false, error: { code: 'E_FORBIDDEN' }
      })
    }
    expect(reached).toEqual([])

    // The local renderer still reaches the same registration through Electron IPC -- the
    // allowlist governs only the raw relay dispatch path.
    await h.handlers[IPC.wslList]!({ sender: { id: 1 } })
    expect(reached).toEqual([IPC.wslList])
  })

  it('clientIds = webContents ids ++ peer ids', () => {
    const p = electronPlatform()
    h.clientIds = [5]
    registerPeerSink(PEER, peerSink().sink)
    expect(p.clientIds()).toEqual([5, PEER])
  })

  it('sendTo dispatches a peer id to its sink and a webContents id natively', () => {
    const p = electronPlatform()
    const s = peerSink()
    registerPeerSink(PEER, s.sink)

    p.sendTo(PEER, 'presence:sync', [{ clientId: PEER }])
    expect(JSON.parse(s.text[0]!)).toEqual({
      t: 'ev',
      channel: 'presence:sync',
      args: [[{ clientId: PEER }]]
    })
    expect(h.sent).toEqual([]) // nothing of the peer's leaked onto the webContents path

    p.sendTo(1, 'ev', 'a')
    expect(h.sent).toEqual([{ id: 1, channel: 'ev', args: ['a'] }])
    expect(s.text).toHaveLength(1) // …and the webContents send did not reach the peer
  })

  it('strips execution overlays from external workspace changes only for peer sinks', () => {
    const p = electronPlatform()
    const s = peerSink()
    registerPeerSink(PEER, s.sink)
    const project = {
      id: 'p1',
      name: 'Local project',
      nodes: [{
        id: 'n1',
        shell: 'pwsh',
        terminalProfileId: 'wsl:Ubuntu',
        ssh: {
          host: 'example.test',
          extraArgs: '-o ProxyCommand=helper',
          execTrusted: true
        }
      }]
    }

    p.sendTo(PEER, IPC.workspaceExternalChange, project)
    const peerProject = JSON.parse(s.text[0]!).args[0]
    expect(peerProject.nodes[0]).toEqual({
      id: 'n1',
      ssh: { host: 'example.test' }
    })

    // The local renderer still receives the exact live object, including its machine-local
    // overlay. Sanitizing it would erase the user's profile/SSH configuration on the next save.
    p.sendTo(1, IPC.workspaceExternalChange, project)
    expect(h.sent[0]).toEqual({ id: 1, channel: IPC.workspaceExternalChange, args: [project] })
    expect(h.sent[0]!.args[0]).toBe(project)
    expect(project.nodes[0]!.terminalProfileId).toBe('wsl:Ubuntu')
  })

  it('sendTo routes a pty:data frame to the peer sink as BINARY', () => {
    const p = electronPlatform()
    const s = peerSink()
    registerPeerSink(PEER, s.sink)
    p.sendTo(PEER, 'pty:data:s1', 'hi')
    expect(s.binary).toHaveLength(1)
    expect(decodePtyData(s.binary[0]!)).toEqual({ sessionId: 's1', data: 'hi' })
  })

  it('broadcast reaches the main window AND every peer sink', () => {
    const p = electronPlatform()
    h.clientIds = [1]
    const s = peerSink()
    registerPeerSink(PEER, s.sink)
    p.broadcast('presence:peer', { op: 'join' })
    expect(h.sent).toContainEqual({ channel: 'presence:peer', args: [{ op: 'join' }] })
    expect(JSON.parse(s.text[0]!)).toEqual({
      t: 'ev',
      channel: 'presence:peer',
      args: [{ op: 'join' }]
    })
  })

  it('default-denies host-global outbound events while preserving the local renderer', () => {
    const p = electronPlatform()
    const s = peerSink()
    registerPeerSink(PEER, s.sink)

    const denied = [
      IPC.usageUpdate,
      IPC.licenseChanged,
      IPC.schoolModeChanged,
      IPC.kidsModeChanged,
      IPC.scheduledSettingsActiveChange,
      IPC.converterItem,
      IPC.ollamaChatStream,
      'future-credential:changed'
    ]
    for (const channel of denied) p.broadcast(channel, { secret: channel })
    p.sendTo(PEER, IPC.usageUpdate, { email: 'host@example.test' })

    expect(s.text).toEqual([])
    expect(s.binary).toEqual([])
    expect(h.sent).toEqual(
      denied.map((channel) => ({ channel, args: [{ secret: channel }] }))
    )
  })

  it('allows only reviewed dynamic relay event channels', () => {
    const p = electronPlatform()
    const s = peerSink()
    registerPeerSink(PEER, s.sink)

    p.sendTo(PEER, IPC.ptyExit('session-1'), 0)
    p.sendTo(PEER, IPC.githubIssuesChanged('project-1'), [42])
    p.sendTo(PEER, IPC.boardLogChanged('project-1'), 'project-1')
    p.sendTo(PEER, IPC.ptyExit(''), 0)
    p.sendTo(PEER, IPC.githubIssuesChanged(''), [99])

    expect(s.text.map((json) => JSON.parse(json).channel)).toEqual([
      IPC.ptyExit('session-1'),
      IPC.githubIssuesChanged('project-1'),
      IPC.boardLogChanged('project-1')
    ])
  })

  it('one peer whose sink throws does not starve the other peers, the window, or the emitter', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = electronPlatform()
    h.clientIds = [1]
    const dead: UiSink = {
      sendText: () => {
        throw new Error('EPIPE: relay socket half-closed')
      },
      sendBinary: () => {},
      bufferedAmount: () => 0
    }
    const alive = peerSink()
    registerPeerSink(PEER, dead)
    registerPeerSink(PEER + 1, alive.sink)

    // The exact 4c failure: a presence diff / canvas mutation fans out while peer B's socket is
    // dead. It must not unwind out of broadcast (that would blow up presenceHub.emit / the canvas
    // reflector on the HOST) and peer C must still be served.
    expect(() => p.broadcast('presence:peer', { op: 'join' })).not.toThrow()
    expect(h.sent).toContainEqual({ channel: 'presence:peer', args: [{ op: 'join' }] })
    expect(JSON.parse(alive.text[0]!)).toEqual({
      t: 'ev',
      channel: 'presence:peer',
      args: [{ op: 'join' }]
    })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('is BIT-IDENTICAL to the webContents-only path with no peer registered (merge gate)', () => {
    const p = electronPlatform()
    h.clientIds = [5]
    expect(p.clientIds()).toEqual([5]) // no peer artefact appended
    p.sendTo(1, 'ev', 'a')
    p.sendTo(999, 'ev', 'b') // unknown id → silent, exactly as before
    expect(h.sent).toEqual([{ id: 1, channel: 'ev', args: ['a'] }])
    h.sent.length = 0
    p.broadcast('x', 1)
    expect(h.sent).toEqual([{ channel: 'x', args: [1] }]) // exactly sendToMain, nothing else
  })
})

/**
 * The INBOUND half (4c): a peer has no webContents, so its RPC request can never travel through
 * ipcMain. It is answered from the platform's own recorded handler table — the SAME registrations
 * the local window gets, so the two surfaces can never drift.
 */
describe('electronPlatform.dispatch / cast (the peer inbound path)', () => {
  it('keeps local pty:create byte-identical but rewrites the relay copy before its handler', async () => {
    const rewritten = {
      cols: 80,
      rows: 24,
      persistKey: 'term-1',
      profileId: 'pwsh',
      cwd: String.raw`C:\trusted`
    }
    const authorize = vi.fn(async () => ({ ok: true as const, options: rewritten }))
    const p = electronPlatform({ authorizeRelayPtyCreate: authorize })
    const calls: Array<{ senderId: number; options: unknown }> = []
    p.handleWithSender(IPC.ptyCreate, (senderId, options) => {
      calls.push({ senderId, options })
      return { sessionId: 's1', fresh: true }
    })
    const hostile = {
      cols: 80,
      rows: 24,
      persistKey: 'term-1',
      profileId: 'custom',
      shell: 'cmd.exe',
      shellArgs: ['/c', 'NODETERM_RELAY_ARGV_MARKER']
    }

    // Native Electron IPC never enters dispatch: existing local custom/SSH behavior stays exact.
    await h.handlers[IPC.ptyCreate]({ sender: { id: 7 } }, hostile)
    expect(calls[0]).toEqual({ senderId: 7, options: hostile })
    expect(calls[0]!.options).toBe(hostile)

    await expect(
      p.dispatch(
        PEER,
        { t: 'req', id: 70, method: IPC.ptyCreate, args: [hostile] },
        { sharedProjectId: 'project-1' }
      )
    ).resolves.toMatchObject({ t: 'res', id: 70, ok: true })
    expect(authorize).toHaveBeenCalledWith(hostile, { sharedProjectId: 'project-1' })
    expect(calls[1]).toEqual({ senderId: PEER, options: rewritten })
    expect(JSON.stringify(calls[1])).not.toContain('NODETERM_RELAY_ARGV_MARKER')
  })

  it('fails relay pty:create closed when no host authority is configured', async () => {
    const p = electronPlatform()
    const handler = vi.fn()
    p.handle(IPC.ptyCreate, handler)

    await expect(
      p.dispatch(PEER, {
        t: 'req', id: 71, method: IPC.ptyCreate,
        args: [{ cols: 80, rows: 24, persistKey: 'term-1', shell: 'cmd.exe' }]
      })
    ).resolves.toEqual({
      t: 'res',
      id: 71,
      ok: false,
      error: { code: 'E_FORBIDDEN', message: 'relay terminal launch authority is unavailable' }
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('does not invoke the PTY handler when host authority refuses the relay launch', async () => {
    const p = electronPlatform({
      authorizeRelayPtyCreate: () => ({ ok: false, message: 'unknown terminal identity' })
    })
    const handler = vi.fn()
    p.handle(IPC.ptyCreate, handler)

    await expect(
      p.dispatch(PEER, {
        t: 'req', id: 72, method: IPC.ptyCreate,
        args: [{ cols: 80, rows: 24, persistKey: 'unknown' }]
      })
    ).resolves.toMatchObject({
      t: 'res', id: 72, ok: false,
      error: { code: 'E_FORBIDDEN', message: 'unknown terminal identity' }
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('fails PTY authority exceptions closed without exposing their private diagnostic', async () => {
    const p = electronPlatform({
      authorizeRelayPtyCreate: () => {
        throw new Error(String.raw`ENOENT C:\Users\host\private-shell.exe`)
      }
    })
    const handler = vi.fn()
    p.handle(IPC.ptyCreate, handler)

    await expect(
      p.dispatch(PEER, {
        t: 'req', id: 73, method: IPC.ptyCreate,
        args: [{ cols: 80, rows: 24, persistKey: 'term-1' }]
      })
    ).resolves.toEqual({
      t: 'res',
      id: 73,
      ok: false,
      error: {
        code: 'E_FORBIDDEN',
        message: 'host terminal authority could not validate this launch'
      }
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it.each([
    IPC.settingsLoad,
    IPC.settingsSave,
    IPC.terminalProfilesList,
    IPC.terminalProfilesRefresh,
    IPC.ptyRecycleConfirmed,
    IPC.ptyExecuteLaunchIntent,
    IPC.workspaceSave,
    IPC.remoteRevokePeer,
    IPC.remoteListApprovedPeers
  ])('refuses machine-local %s over relay while its local IPC handler still works', async (method) => {
    const p = electronPlatform()
    const localResult = { method, local: true }

    // Register through the broadest possible seam on purpose. This models a future refactor
    // accidentally moving a local-only handler from raw ipcMain onto CorePlatform: the dispatch
    // boundary must still fail closed, while the desktop renderer's native IPC path remains live.
    p.handle(method, () => localResult)
    expect(await h.handlers[method]({ sender: { id: 1 } })).toEqual(localResult)
    await expect(
      p.dispatch(PEER, { t: 'req', id: 90, method, args: [] })
    ).resolves.toEqual({
      t: 'res',
      id: 90,
      ok: false,
      error: {
        code: 'E_FORBIDDEN',
        message: 'machine-local desktop operation is not available to relay peers'
      }
    })
  })

  it('drops forged relay casts for machine-local launch channels before any listener runs', () => {
    const p = electronPlatform()
    const listener = vi.fn()
    p.on(IPC.ptyExecuteLaunchIntent, listener)

    p.cast(1_000_001, IPC.ptyExecuteLaunchIntent, [
      'session-1',
      'launch-1',
      { kind: 'agent', action: 'start', agentId: 'claude' }
    ])

    expect(listener).not.toHaveBeenCalled()
  })

  it('broadcast keeps the local external-change payload live but sanitizes every peer copy', () => {
    const p = electronPlatform()
    const s = peerSink()
    registerPeerSink(PEER, s.sink)
    const project = {
      id: 'p2',
      nodes: [{ id: 'n2', shell: 'cmd.exe', terminalProfileId: 'cmd' }]
    }

    p.broadcast(IPC.workspaceExternalChange, project)

    expect(h.sent[0]!.args[0]).toBe(project)
    expect(JSON.parse(s.text[0]!).args[0]).toEqual({ id: 'p2', nodes: [{ id: 'n2' }] })
  })

  it('dispatch answers a peer request from the recorded handler table, with the peer as sender', async () => {
    const p = electronPlatform()
    p.handle('fs:list', (dir: string) => [{ name: 'a.txt', dir: false, path: `${dir}/a.txt` }])
    p.handleWithSender('presence:hello', (senderId: number, id: unknown) => ({ senderId, id }))

    const peer = allocateRelayClientId()
    await expect(
      p.dispatch(peer, { t: 'req', id: 7, method: 'fs:list', args: ['/w'] })
    ).resolves.toEqual({
      t: 'res',
      id: 7,
      ok: true,
      result: [{ name: 'a.txt', dir: false, path: '/w/a.txt' }]
    })
    await expect(
      p.dispatch(peer, { t: 'req', id: 8, method: 'presence:hello', args: [{ name: 'A' }] })
    ).resolves.toEqual({ t: 'res', id: 8, ok: true, result: { senderId: peer, id: { name: 'A' } } })
  })

  it('an allowed method with no handler answers E_NO_HANDLER (never hangs the peer)', async () => {
    const p = electronPlatform()
    const res = await p.dispatch(PEER, { t: 'req', id: 1, method: IPC.fsExists, args: [] })
    expect(res).toMatchObject({ ok: false, error: { code: 'E_NO_HANDLER' } })
  })

  it('an unknown method is forbidden even if somebody registers it later', async () => {
    const p = electronPlatform()
    const fn = vi.fn(() => 'must-not-run')
    p.handle('future-credential:reveal', fn)
    const res = await p.dispatch(PEER, {
      t: 'req', id: 11, method: 'future-credential:reveal', args: []
    })
    expect(res).toMatchObject({ ok: false, error: { code: 'E_FORBIDDEN' } })
    expect(fn).not.toHaveBeenCalled()
  })

  it('a throwing handler answers an error frame, not a rejection', async () => {
    const p = electronPlatform()
    p.handle(IPC.fsRead, () => {
      throw new Error('nope')
    })
    const res = await p.dispatch(PEER, { t: 'req', id: 2, method: IPC.fsRead, args: [] })
    expect(res).toMatchObject({ ok: false, error: { code: 'E_HANDLER', message: 'nope' } })
  })

  it('a handler returning undefined answers null (JSON has no undefined)', async () => {
    const p = electronPlatform()
    p.handle(IPC.fsWrite, () => undefined)
    await expect(p.dispatch(PEER, { t: 'req', id: 3, method: IPC.fsWrite, args: [] })).resolves.toEqual({
      t: 'res',
      id: 3,
      ok: true,
      result: null
    })
  })

  it('cast fires every listener in registration order, with the peer as sender', () => {
    const p = electronPlatform()
    const seen: string[] = []
    p.on('pty:write', (sid: unknown) => seen.push(`on:${sid}`))
    p.onWithSender('pty:write', (senderId: number, sid: unknown) => seen.push(`ws:${senderId}:${sid}`))
    p.cast(1_000_001, 'pty:write', ['s1', 'x'])
    expect(seen).toEqual(['on:s1', 'ws:1000001:s1'])
  })

  it('one throwing cast listener does not swallow the peer keystroke for the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = electronPlatform()
    const seen: string[] = []
    p.on('pty:write', () => {
      throw new Error('attribution blew up')
    })
    p.onWithSender('pty:write', (_s: number, sid: unknown) => seen.push(`ws:${sid}`))
    expect(() => p.cast(PEER, 'pty:write', ['s1', 'x'])).not.toThrow()
    expect(seen).toEqual(['ws:s1'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('cast on a channel nobody listens to is a silent no-op', () => {
    const p = electronPlatform()
    expect(() => p.cast(PEER, 'nobody:home', [])).not.toThrow()
  })

  it('drops a forbidden raw cast before a registered listener can mutate host state', () => {
    const p = electronPlatform()
    const listener = vi.fn()
    p.on(IPC.settingsSave, listener)
    p.cast(PEER, IPC.settingsSave, [{ telemetryEnabled: false }])
    expect(listener).not.toHaveBeenCalled()
  })

  it('recording the table does not change what the LOCAL window gets (still ipcMain)', async () => {
    const p = electronPlatform()
    p.handle('c1', (a: number) => a + 1)
    p.on('c2', () => {})
    p.handleWithSender('c3', (senderId: number, a: string) => `${senderId}:${a}`)
    // Same ipcMain registrations, same event-stripping, same sender id as before this feature.
    expect(await h.handlers['c1']({ sender: { id: 1 } }, 41)).toBe(42)
    expect(await h.handlers['c3']({ sender: { id: 7 } }, 'x')).toBe('7:x')
    expect(Object.keys(h.handlers).sort()).toEqual(['c1', 'c2', 'c3'])
  })
})

/**
 * A relay guest is NOT the host's user. `project-setup:run` starts a script on the host, and
 * `project-setup:consent-submit` is the ANSWER to the host's own trust prompt — a guest reaching
 * both could trigger a run and then approve it themselves, with the host's human never touching
 * anything. BOTH legs of the peer surface are gated: `dispatch` (request/response — how `run` and
 * `cancel` arrive) and `cast` (fire-and-forget — how `consent-submit` arrives). Gating only the
 * first would leave the self-approval half wide open.
 */
describe('electronPlatform host-only admission (project-setup)', () => {
  const REFUSAL = {
    code: 'E_FORBIDDEN',
    message: 'host-control method is not available to relay peers'
  }
  const GATED = ['project-setup:run', 'project-setup:cancel', 'project-setup:consent-submit']

  it('refuses a peer dispatch of run/cancel/consent-submit without reaching the handler', async () => {
    const p = electronPlatform()
    const reached: string[] = []
    for (const ch of GATED) {
      p.handle(ch, () => {
        reached.push(ch)
        return 'must-not-run'
      })
    }
    let id = 0
    for (const ch of GATED) {
      id += 1
      expect(await p.dispatch(PEER, { t: 'req', id, method: ch, args: [] })).toEqual({
        t: 'res', id, ok: false, error: REFUSAL
      })
    }
    expect(reached).toEqual([])
  })

  it('refuses a peer CAST of consent-submit — the self-approval path', () => {
    const p = electronPlatform()
    const answers: unknown[][] = []
    p.on('project-setup:consent-submit', (...args: unknown[]) => answers.push(args))
    p.cast(PEER, 'project-setup:consent-submit', ['req-1', 'approve'])
    expect(answers).toEqual([])
  })

  it('still admits the harmless project-setup lifecycle channels', () => {
    const p = electronPlatform()
    const seen: string[] = []
    p.on('project-setup:subscribe', () => seen.push('sub'))
    p.cast(PEER, 'project-setup:subscribe', ['p1'])
    expect(seen).toEqual(['sub'])
  })

  it('the LOCAL window is unaffected — its ipcMain registration still answers', async () => {
    const p = electronPlatform()
    p.handle('project-setup:run', (projectId: string) => `ran:${projectId}`)
    expect(await h.handlers['project-setup:run']({ sender: { id: 1 } }, 'p1')).toBe('ran:p1')
  })
})
