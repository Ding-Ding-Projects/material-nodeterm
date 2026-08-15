import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initPlatform, resetPlatformForTests } from './platform'
import { fakePlatform } from './platform-fake'

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

function fakeSessionHostPty() {
  return {
    ready: Promise.resolve({ fresh: true }),
    onData: vi.fn(),
    onExit: vi.fn(),
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

  beforeEach(() => {
    initPlatform(fakePlatform())
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
