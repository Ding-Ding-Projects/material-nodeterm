import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../shared/ipc'
import { initPlatform, resetPlatformForTests } from './platform'
import { fakePlatform, type FakePlatform } from './platform-fake'

const backend = vi.hoisted(() => ({
  supported: vi.fn(() => true),
  create: vi.fn(),
  capture: vi.fn(async () => ''),
  hasSession: vi.fn(async () => false),
  kill: vi.fn(async () => {}),
  list: vi.fn(async () => []),
  paneCommand: vi.fn(async () => null),
  sendKeys: vi.fn(async () => false)
}))

vi.mock('./session-host-backend', () => ({
  sessionHostSupported: backend.supported,
  createSessionHostPty: backend.create,
  sessionHostCapture: backend.capture,
  sessionHostHasSession: backend.hasSession,
  sessionHostKillSession: backend.kill,
  sessionHostListSessions: backend.list,
  sessionHostPaneCommand: backend.paneCommand,
  sessionHostSendKeys: backend.sendKeys
}))

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    throw new Error('direct node-pty spawn must not run in the session-host suite')
  })
}))

vi.mock('./pty-devices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pty-devices')>()),
  readPtyDevices: () => ({ ceiling: 511, inUse: 8 })
}))

function fakeSessionHostPty(ready = Promise.resolve({ fresh: true })) {
  let dataCb: ((data: string) => void) | undefined
  let exitCb: ((e: { exitCode: number }) => void) | undefined
  return {
    ready,
    onData: vi.fn((cb: (data: string) => void) => {
      dataCb = cb
    }),
    onExit: vi.fn((cb: (e: { exitCode: number }) => void) => {
      exitCb = cb
    }),
    emitData: (data: string) => dataCb?.(data),
    emitExit: (exitCode: number) => exitCb?.({ exitCode }),
    write: vi.fn(),
    resize: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    kill: vi.fn(),
    destroy: vi.fn()
  }
}

describe('PtyManager session-host parity', () => {
  let manager: import('./pty-manager').PtyManager | undefined
  let host: FakePlatform

  beforeEach(() => {
    host = fakePlatform()
    initPlatform(host)
    backend.supported.mockReturnValue(true)
    backend.create.mockReset().mockImplementation(() => fakeSessionHostPty())
    backend.capture.mockReset().mockResolvedValue('')
    backend.hasSession.mockReset().mockResolvedValue(false)
    backend.kill.mockReset().mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await manager?.killAll()
    manager = undefined
    resetPlatformForTests()
    vi.restoreAllMocks()
  })

  async function makeManager() {
    const { PtyManager } = await import('./pty-manager')
    manager = new PtyManager()
    return manager
  }

  it('asks the session host whether a no-tmux persisted session exists', async () => {
    const m = await makeManager()
    backend.hasSession.mockResolvedValue(true)

    await expect(m.sessionExists('node-a')).resolves.toBe(true)
    expect(backend.hasSession).toHaveBeenCalledWith('nt-node-a')
  })

  it('treats an unprobeable session host as possibly warm instead of cold-restoring on a guess', async () => {
    const m = await makeManager()
    backend.hasSession.mockRejectedValue(new Error('host connection unavailable'))

    await expect(m.sessionExists('node-a')).resolves.toBe(true)
  })

  it('captures a relay snapshot from the session host when tmux is absent', async () => {
    const m = await makeManager()
    backend.capture.mockResolvedValue('painted screen')

    await expect(m.captureSnapshot('node-a')).resolves.toBe('painted screen')
    expect(backend.capture).toHaveBeenCalledWith('nt-node-a', false)
  })

  it('passes the platform-resolved local shell into a session-host spawn', async () => {
    const m = await makeManager()
    m.createDetached(
      { cols: 80, rows: 24, persistKey: 'node-shell' },
      { onData: () => {}, onExit: () => {} }
    )

    expect(backend.create).toHaveBeenCalledTimes(1)
    const spawn = backend.create.mock.calls[0][1] as { shell: string; args: string[] }
    if (process.platform === 'win32') {
      expect(spawn.shell).not.toBe('bash')
      expect(spawn.shell.toLowerCase()).toMatch(/(?:pwsh|powershell|cmd)(?:\.exe)?$/)
    } else {
      expect(spawn.shell).toBe(process.env.SHELL || 'bash')
    }
    expect(spawn.args).toEqual([])
  })

  it('fails a create closed, parks racing followers, and publishes only the recovered session', async () => {
    let rejectReady!: (error: Error) => void
    const pendingReady = new Promise<{ fresh: boolean }>((_, reject) => {
      rejectReady = reject
    })
    const failed = fakeSessionHostPty(pendingReady)
    const recovered = fakeSessionHostPty()
    backend.create
      .mockImplementationOnce(() => failed)
      .mockImplementationOnce(() => recovered)
    const m = await makeManager()
    m.registerIpc()
    const create = host.handlers[IPC.ptyCreate]
    const options = { cols: 80, rows: 24, persistKey: 'node-retry' }

    const first = create(7, options) as Promise<unknown>
    const firstFailure = expect(first).rejects.toThrow('attach refused after connect')
    await vi.waitFor(() => expect(backend.create).toHaveBeenCalledTimes(1))
    // These requests arrive after the provisional Session is indexed but before ready settles.
    const followerA = create(8, options) as Promise<unknown>
    const followerB = create(9, options) as Promise<unknown>
    vi.useFakeTimers()
    try {
      failed.emitData('queued before the attach failure')
      rejectReady(new Error('attach refused after connect'))

      await firstFailure
      expect(failed.resume).not.toHaveBeenCalled()
      expect(failed.destroy).toHaveBeenCalledTimes(1)

      const [a, b] = (await Promise.all([followerA, followerB])) as Array<{
        sessionId: string
        fresh: boolean
        persistent: boolean
      }>
      expect(a.sessionId).toBe(b.sessionId)
      expect(a.persistent && b.persistent).toBe(true)
      expect([a.fresh, b.fresh].sort()).toEqual([false, true])
      expect(backend.create).toHaveBeenCalledTimes(2)

      // Neither queued bytes nor callbacks from the discarded generation may escape.
      failed.emitData('late old-generation bytes')
      failed.emitExit(1)
      await vi.advanceTimersByTimeAsync(100)
      expect(host.sent.some((message) => message.channel === IPC.ptyData('pty-1'))).toBe(false)
      expect(host.sent.some((message) => message.channel === IPC.ptyExit('pty-1'))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a deletion tombstone when its owner recovery attach fails', async () => {
    let rejectReady!: (error: Error) => void
    const pendingReady = new Promise<{ fresh: boolean }>((_, reject) => {
      rejectReady = reject
    })
    const failed = fakeSessionHostPty(pendingReady)
    backend.create.mockReturnValue(failed)
    const m = await makeManager()
    m.registerIpc()
    const create = host.handlers[IPC.ptyCreate]
    const options = { cols: 80, rows: 24, persistKey: 'node-protected' }

    // A confirmed delete leaves the owner able to recover, while other clients remain refused.
    await m.destroySession(7, 'node-protected')
    const ownerRecovery = create(7, options) as Promise<unknown>
    const recoveryFailure = expect(ownerRecovery).rejects.toThrow('recovery attach refused')
    await vi.waitFor(() => expect(backend.create).toHaveBeenCalledTimes(1))
    rejectReady(new Error('recovery attach refused'))
    await recoveryFailure

    await expect(create(8, options)).resolves.toEqual({
      sessionId: '',
      fresh: false,
      closed: { by: 7 }
    })
    expect(backend.create).toHaveBeenCalledTimes(1)
  })

  it('does not publish a session that exits in the same turn its ready resolves', async () => {
    let resolveReady!: (info: { fresh: boolean }) => void
    const pendingReady = new Promise<{ fresh: boolean }>((resolve) => {
      resolveReady = resolve
    })
    const exited = fakeSessionHostPty(pendingReady)
    backend.create.mockReturnValue(exited)
    const m = await makeManager()
    m.registerIpc()
    const create = host.handlers[IPC.ptyCreate]

    const result = create(7, {
      cols: 80,
      rows: 24,
      persistKey: 'node-exited-during-attach'
    }) as Promise<unknown>
    const failure = expect(result).rejects.toThrow(
      'session-host session exited before its attach completed'
    )
    await vi.waitFor(() => expect(backend.create).toHaveBeenCalledTimes(1))
    resolveReady({ fresh: true })
    exited.emitExit(0)

    await failure
  })

  it('retires a detached session-host shim and signals its sink when ready rejects', async () => {
    let rejectReady!: (error: Error) => void
    const pendingReady = new Promise<{ fresh: boolean }>((_, reject) => {
      rejectReady = reject
    })
    const failed = fakeSessionHostPty(pendingReady)
    backend.create.mockReturnValue(failed)
    const m = await makeManager()
    const onData = vi.fn()
    const onExit = vi.fn()

    expect(
      m.createDetached(
        { cols: 80, rows: 24, persistKey: 'relay-node' },
        { onData, onExit }
      )
    ).toBe('pty-1')
    rejectReady(new Error('relay attach failed'))
    await vi.waitFor(() => expect(failed.destroy).toHaveBeenCalledTimes(1))

    expect(onExit).toHaveBeenCalledWith(1)
    failed.emitData('late relay bytes')
    failed.emitExit(2)
    expect(onData).not.toHaveBeenCalled()
    expect(onExit).toHaveBeenCalledTimes(1)
  })
})

describe('resolveLocalSessionShell', () => {
  it('uses the Windows resolver when both explicit and configured shells are empty', async () => {
    const { resolveLocalSessionShell } = await import('./pty-manager')
    const windowsShell = vi.fn(() => String.raw`C:\Windows\System32\cmd.exe`)

    expect(
      resolveLocalSessionShell(undefined, '', {
        platform: 'win32',
        windowsShell,
        posixShell: '/bin/should-not-win'
      })
    ).toBe(String.raw`C:\Windows\System32\cmd.exe`)
    expect(windowsShell).toHaveBeenCalledTimes(1)
  })

  it('keeps an explicit program above a configured shell and every platform fallback', async () => {
    const { resolveLocalSessionShell } = await import('./pty-manager')
    const windowsShell = vi.fn(() => 'cmd.exe')

    expect(
      resolveLocalSessionShell('/opt/custom-shell', '/bin/configured', {
        platform: 'win32',
        windowsShell
      })
    ).toBe('/opt/custom-shell')
    expect(windowsShell).not.toHaveBeenCalled()
  })
})
