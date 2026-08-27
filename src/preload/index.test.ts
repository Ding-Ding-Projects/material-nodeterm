// The preload bridge's passphrase surface. This is the ONLY place the renderer-facing
// (requestId, value) argument order and the channel names are glued to ipcRenderer, and a swap
// or a renamed channel here was green under every other test while breaking the live dialog.
// electron is mocked (a preload script cannot run outside Electron); the assertion target is
// the exact invoke/on wiring the real contextBridge would expose.
import { describe, expect, it, vi } from 'vitest'
import { IPC } from '../shared/ipc'
import type { NodeTerminalApi, SshPassphraseRequest } from '../shared/types'

const h = vi.hoisted(() => ({
  invoke: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  exposed: {} as Record<string, unknown>
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      h.exposed[key] = value
    }
  },
  ipcRenderer: {
    invoke: h.invoke,
    send: h.send,
    on: h.on,
    removeListener: h.removeListener
  },
  webUtils: { getPathForFile: vi.fn() }
}))

// Side-effect import: runs the preload script, which exposes the api through the mock above.
import './index'

const api = h.exposed.nodeTerminal as NodeTerminalApi

async function loadPreloadForPlatform(platform: NodeJS.Platform): Promise<NodeTerminalApi> {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  try {
    Object.defineProperty(process, 'platform', { configurable: true, value: platform })
    h.exposed = {}
    vi.resetModules()
    await import('./index')
    return h.exposed.nodeTerminal as NodeTerminalApi
  } finally {
    if (descriptor) Object.defineProperty(process, 'platform', descriptor)
  }
}

describe('preload IPC wiring', () => {
  it('exposes Windows terminal profile detection on its exact channels', async () => {
    if (process.platform === 'win32') {
      expect(api.terminalProfiles).toBeDefined()
      await api.terminalProfiles!.list()
      await api.terminalProfiles!.refresh()
      expect(h.invoke).toHaveBeenCalledWith(IPC.terminalProfilesList)
      // `refresh(customExecutable?)` always forwards its parameter, so an argument-less call
      // still invokes with an explicit undefined — assert the real two-argument shape rather
      // than a one-argument call that never happens.
      expect(h.invoke).toHaveBeenCalledWith(IPC.terminalProfilesRefresh, undefined)
    } else {
      expect(api.terminalProfiles).toBeUndefined()
    }
  })

  it('forwards the selected profile id unchanged when creating a PTY', async () => {
    const options = { profileId: 'wsl:Ubuntu 24.04', cols: 120, rows: 40 }
    await api.pty.create(options)
    expect(h.invoke).toHaveBeenCalledWith(IPC.ptyCreate, options)
  })

  // `executeLaunchIntent` is deliberately NOT exposed on any platform (commit 1c305ec2, "fix(windows):
  // restore typing in ordinary terminals"). Preload used to advertise it on win32, so the renderer's
  // `supportsStructuredLaunch` check (which asks only whether the function exists) answered yes on
  // every Windows install — while `registerLaunchIntentIpc` is never called from the main process and
  // `PtyManager` has no `executeLaunchIntent` method at all, so every launch down that route rejected
  // with "No handler registered for 'pty:execute-launch-intent'". A bridge member is a capability
  // CLAIM, and one main cannot answer is worse than a missing one — restore this only alongside the
  // manager method and the registered handler, never before.
  it('never advertises the unimplemented delayed launch intent, on any platform', async () => {
    const windowsApi = await loadPreloadForPlatform('win32')
    expect(windowsApi.pty.executeLaunchIntent).toBeUndefined()
    expect('executeLaunchIntent' in windowsApi.pty).toBe(false)

    const nonWindowsApi = await loadPreloadForPlatform('linux')
    expect(nonWindowsApi.pty.executeLaunchIntent).toBeUndefined()
    expect('executeLaunchIntent' in nonWindowsApi.pty).toBe(false)
  })

  it('awaits pty destroy through invoke and propagates a rejected backend acknowledgement', async () => {
    h.invoke.mockRejectedValueOnce(new Error('session host outcome unknown'))

    await expect(api.pty.destroy('node-1', { everySocket: true })).rejects.toThrow(
      'session host outcome unknown'
    )
    expect(h.invoke).toHaveBeenCalledWith(IPC.ptyDestroy, 'node-1', true)
    expect(h.send).not.toHaveBeenCalledWith(IPC.ptyDestroy, 'node-1', true)
  })

  it('awaits pty recycle through invoke so cwd mutation can wait for the host', async () => {
    h.invoke.mockRejectedValueOnce(new Error('recycle outcome unknown'))

    await expect(api.pty.recycle('node-2')).rejects.toThrow('recycle outcome unknown')
    expect(h.invoke).toHaveBeenCalledWith(IPC.ptyRecycle, 'node-2')
    expect(h.send).not.toHaveBeenCalledWith(IPC.ptyRecycle, 'node-2')
  })

  it('exposes a distinct awaited desktop recycle-confirmation path', async () => {
    expect(api.pty.recycleConfirmed).toBeDefined()
    const target = { profileId: 'wsl:Ubuntu 24.04', cwd: 'C:\\work tree' }
    await api.pty.recycleConfirmed!('node-profile-switch', target)
    expect(h.invoke).toHaveBeenCalledWith(IPC.ptyRecycleConfirmed, 'node-profile-switch', target)

    await api.pty.recycleConfirmed!('node-profile-switch-legacy')
    expect(h.invoke).toHaveBeenCalledWith(IPC.ptyRecycleConfirmed, 'node-profile-switch-legacy')
  })

  it('awaits the main-process clipboard acknowledgement on the request-response channel', async () => {
    h.invoke.mockResolvedValueOnce(false)

    await expect(
      api.clipboard.writeText('colour value', { reportFailure: false })
    ).resolves.toBe(false)
    expect(h.invoke).toHaveBeenCalledWith(IPC.clipboardWrite, 'colour value')
    expect(h.send).not.toHaveBeenCalledWith(IPC.clipboardWrite, 'colour value')
  })

  it('resolves false instead of leaking a rejected clipboard invocation', async () => {
    h.invoke.mockRejectedValueOnce(new Error('main process unavailable'))

    await expect(api.clipboard.writeText('safe fallback')).resolves.toBe(false)
    expect(h.invoke).toHaveBeenCalledWith(IPC.clipboardWrite, 'safe fallback')
  })
describe('preload sshProject passphrase wiring', () => {
  it('routes foreground process termination through request IPC', async () => {
    await api.pty.terminateForeground('node-1', 'claude')
    expect(h.invoke).toHaveBeenCalledWith(IPC.ptyTerminateForeground, 'node-1', 'claude')
  })

  it('exposes GitHub issue data and host-control namespaces on their exact channels', async () => {
    await api.githubIssues.query({ projectId: 'p1', columnId: null, pageSize: 50 })
    await api.githubControl.saveToken('write-only-secret')
    expect(h.invoke).toHaveBeenCalledWith(IPC.githubIssuesQuery, {
      projectId: 'p1', columnId: null, pageSize: 50
    })
    expect(h.invoke).toHaveBeenCalledWith(IPC.githubControlSaveToken, 'write-only-secret')
  })

  it('submitPassphrase invokes the submit channel with (requestId, value) in that order', async () => {
    await api.sshProject.submitPassphrase('req-1', 'hunter2')
    expect(h.invoke).toHaveBeenCalledWith(IPC.sshPassphraseSubmit, 'req-1', 'hunter2')
    // Cancel path: null must travel as null (main reads null as an ACTIVE decline).
    await api.sshProject.submitPassphrase('req-2', null)
    expect(h.invoke).toHaveBeenCalledWith(IPC.sshPassphraseSubmit, 'req-2', null)
  })

  it('onPassphraseRequest subscribes the request channel and forwards the payload', () => {
    const got: SshPassphraseRequest[] = []
    const off = api.sshProject.onPassphraseRequest((e) => got.push(e))
    const call = h.on.mock.calls.find((c) => c[0] === IPC.sshPassphraseRequest)
    expect(call).toBeTruthy()
    const handler = call![1] as (e: unknown, payload: unknown) => void
    const payload = { requestId: 'r9', identityFile: '/k', retry: true }
    handler({}, payload)
    expect(got).toEqual([payload])
    off()
    expect(h.removeListener).toHaveBeenCalledWith(IPC.sshPassphraseRequest, handler)
  })

  // The desktop half of the session-memory surface. `remote` is the renderer's own "this scope is
  // an SSH host" claim and one of the TWO independent sources the core service ORs to decide which
  // machine answers; `projectId` is the only thing naming that machine. A preload that normalized
  // either (dropped a `false`, defaulted the object, reordered the args) would route a remote query
  // into a LOCAL sweep and publish this machine's sessions under the host's name — invisible to
  // every other test, since core is handed a perfectly well-formed query.
  it('sessionMemory forwards the query verbatim on both channels', async () => {
    const q = { projectId: 'p1', remote: true }
    await api.sessionMemory.read(q)
    await api.sessionMemory.host(q)
    expect(h.invoke).toHaveBeenCalledWith(IPC.sessionMemory, { projectId: 'p1', remote: true })
    expect(h.invoke).toHaveBeenCalledWith(IPC.sessionMemoryHost, { projectId: 'p1', remote: true })
    // An explicit `remote: false` is a claim too, and must not be normalized away.
    await api.sessionMemory.read({ projectId: 'p2', remote: false })
    expect(h.invoke).toHaveBeenCalledWith(IPC.sessionMemory, { projectId: 'p2', remote: false })
  })

  // The recorder's release leg is a `false`, and main reads it as `active === true`. A preload
  // that dropped the argument, or sent on the wrong channel, would leave ⌘W/⌘M/⌘0 suppressed
  // app-wide after Settings closed — with every other test in the tree still green.
  it('shortcuts.setRecording sends both edges on its own channel', () => {
    api.shortcuts.setRecording(true)
    expect(h.send).toHaveBeenCalledWith(IPC.uiShortcutRecording, true)
    api.shortcuts.setRecording(false)
    expect(h.send).toHaveBeenCalledWith(IPC.uiShortcutRecording, false)
  })

  // Same story for the focus mirror, and its OWN channel matters: main keeps the two bits apart
  // (one suspends always, the other only under `terminal-first`), so a preload that folded the
  // mirror onto the recording channel would disable ⌘W/⌘M/⌘0 for every user the moment they
  // clicked into a terminal — with the whole suite still green.
  it('shortcuts.setTerminalFocused sends both edges on its own channel', () => {
    const before = h.send.mock.calls.length
    api.shortcuts.setTerminalFocused(true)
    api.shortcuts.setTerminalFocused(false)
    // The whole call list, not two `toHaveBeenCalledWith`s: what must be true is that the mirror
    // touched the terminal-focus channel and NOTHING else — folding it onto `ui:shortcut-recording`
    // would disable ⌘W/⌘M/⌘0 for every user the moment they clicked into a terminal, and a
    // per-call assertion would stay green through exactly that.
    expect(h.send.mock.calls.slice(before)).toEqual([
      [IPC.uiTerminalFocus, true],
      [IPC.uiTerminalFocus, false]
    ])
  })

  it('onPassphraseDismiss subscribes the dismiss channel and forwards the requestId', () => {
    const got: { requestId: string }[] = []
    const off = api.sshProject.onPassphraseDismiss((e) => got.push(e))
    const call = h.on.mock.calls.find((c) => c[0] === IPC.sshPassphraseDismiss)
    expect(call).toBeTruthy()
    const handler = call![1] as (e: unknown, payload: unknown) => void
    handler({}, { requestId: 'r7' })
    expect(got).toEqual([{ requestId: 'r7' }])
    off()
    expect(h.removeListener).toHaveBeenCalledWith(IPC.sshPassphraseDismiss, handler)
  })

  it('forwards pairing attempt ownership on both start and targeted stop', async () => {
    const attemptId = '33333333-3333-4333-8333-333333333333'

    await api.pairing.start(attemptId)
    await api.pairing.stop(attemptId)

    expect(h.invoke).toHaveBeenCalledWith(IPC.pairingStart, attemptId)
    expect(h.invoke).toHaveBeenCalledWith(IPC.pairingStop, attemptId)
  })

  // Every method routes to its own exact channel with `projectId` forwarded first — the vault
  // lives at THAT project's <cwd>/.nodeterm/vault.json (core/password-manager/vault-store.ts),
  // so a swapped/collapsed channel here would silently read or mutate the wrong project's vault.
  it('routes every passwordManager method to its exact channel with projectId forwarded', async () => {
    const pid = 'proj-1'

    await api.passwordManager.status(pid)
    expect(h.invoke).toHaveBeenCalledWith(IPC.passwordManagerStatus, pid)

    await api.passwordManager.createVault(pid, 'pw')
    expect(h.invoke).toHaveBeenCalledWith(IPC.passwordManagerCreateVault, pid, 'pw')

    await api.passwordManager.unlock(pid, 'pw')
    expect(h.invoke).toHaveBeenCalledWith(IPC.passwordManagerUnlock, pid, 'pw')

    await api.passwordManager.lock(pid)
    expect(h.invoke).toHaveBeenCalledWith(IPC.passwordManagerLock, pid)

    const changePw = { currentPassword: 'old', newPassword: 'new' }
    await api.passwordManager.changePassword(pid, changePw)
    expect(h.invoke).toHaveBeenCalledWith(IPC.passwordManagerChangePassword, pid, changePw)

    const createManager = { name: 'Work logins' }
    await api.passwordManager.createManager(pid, createManager)
    expect(h.invoke).toHaveBeenCalledWith(IPC.passwordManagerCreateManager, pid, createManager)

    const renameManager = { id: 'mgr-1', name: 'Renamed' }
    await api.passwordManager.renameManager(pid, renameManager)
    expect(h.invoke).toHaveBeenCalledWith(IPC.passwordManagerRenameManager, pid, renameManager)

    const bindGroup = { id: 'mgr-1', groupId: 'grp-1' }
    await api.passwordManager.bindManagerGroup(pid, bindGroup)
    expect(h.invoke).toHaveBeenCalledWith(IPC.passwordManagerBindManagerGroup, pid, bindGroup)

    await api.passwordManager.releaseGroupBinding(pid, 'grp-1')
    expect(h.invoke).toHaveBeenCalledWith(IPC.passwordManagerReleaseGroupBinding, pid, 'grp-1')

    await api.passwordManager.deleteManager(pid, 'mgr-1')
    expect(h.invoke).toHaveBeenCalledWith(IPC.passwordManagerDeleteManager, pid, 'mgr-1')

    const createCred = { managerId: 'mgr-1', label: 'GitHub', username: 'u', password: 'p' }
    await api.passwordManager.createCredential(pid, createCred)
    expect(h.invoke).toHaveBeenCalledWith(IPC.passwordManagerCreateCredential, pid, createCred)

    const renameCred = { managerId: 'mgr-1', credentialId: 'cred-1', label: 'GitHub (work)' }
    await api.passwordManager.renameCredential(pid, renameCred)
    expect(h.invoke).toHaveBeenCalledWith(IPC.passwordManagerRenameCredential, pid, renameCred)

    const updateSecret = { managerId: 'mgr-1', credentialId: 'cred-1', password: 'new-pw' }
    await api.passwordManager.updateCredentialSecret(pid, updateSecret)
    expect(h.invoke).toHaveBeenCalledWith(IPC.passwordManagerUpdateCredentialSecret, pid, updateSecret)

    const removeCred = { managerId: 'mgr-1', credentialId: 'cred-1' }
    await api.passwordManager.removeCredential(pid, removeCred)
    expect(h.invoke).toHaveBeenCalledWith(IPC.passwordManagerRemoveCredential, pid, removeCred)

    await api.passwordManager.revealCredential(pid, 'mgr-1', 'cred-1')
    expect(h.invoke).toHaveBeenCalledWith(IPC.passwordManagerRevealCredential, pid, 'mgr-1', 'cred-1')

    await api.passwordManager.credentialCode(pid, 'mgr-1', 'cred-1')
    expect(h.invoke).toHaveBeenCalledWith(IPC.passwordManagerCredentialCode, pid, 'mgr-1', 'cred-1')
  })
})
})
