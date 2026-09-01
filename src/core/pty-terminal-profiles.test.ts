import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { IPC } from '../shared/ipc'
import { DEFAULT_SETTINGS } from '../shared/types'
import { initPlatform, resetPlatformForTests } from './platform'
import { fakePlatform, type FakePlatform } from './platform-fake'
import {
  WindowsTerminalProfileError,
  type ResolvedWindowsTerminalProfile,
  type WindowsTerminalProfileResolver
} from './windows-terminal-profiles'

const backend = vi.hoisted(() => ({
  supported: vi.fn(() => false),
  create: vi.fn(),
  attachExisting: vi.fn(),
  capture: vi.fn(async () => ''),
  hasSession: vi.fn(async () => false),
  kill: vi.fn(async () => {}),
  list: vi.fn<() => Promise<string[]>>(async () => []),
  paneCommand: vi.fn<() => Promise<string | null>>(async () => null),
  sendKeys: vi.fn(async () => false)
}))

const nodePty = vi.hoisted(() => ({ spawn: vi.fn() }))
const windowsProcess = vi.hoisted(() => ({ terminate: vi.fn(async () => {}) }))

vi.mock('./session-host-backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./session-host-backend')>()),
  sessionHostSupported: backend.supported,
  createSessionHostPty: backend.create,
  attachExistingSessionHostPty: backend.attachExisting,
  sessionHostCapture: backend.capture,
  sessionHostHasSession: backend.hasSession,
  sessionHostKillSession: backend.kill,
  sessionHostListSessions: backend.list,
  sessionHostPaneCommand: backend.paneCommand,
  sessionHostSendKeys: backend.sendKeys
}))

vi.mock('node-pty', () => ({ spawn: nodePty.spawn }))

vi.mock('../session-host/windows-process-tree', () => ({
  terminateWindowsProcessTree: windowsProcess.terminate
}))

vi.mock('./pty-devices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pty-devices')>()),
  readPtyDevices: () => ({ ceiling: 511, inUse: 8 })
}))

function fakePty(ready?: Promise<{ fresh: boolean; screen?: string }>) {
  let dataCb: ((data: string) => void) | undefined
  let exitCb: ((e: { exitCode: number }) => void) | undefined
  let attachErrorCb: ((error: Error) => void) | undefined
  return {
    ...(ready ? { ready } : {}),
    onData: vi.fn((cb: (data: string) => void) => {
      dataCb = cb
    }),
    onExit: vi.fn((cb: (e: { exitCode: number }) => void) => {
      exitCb = cb
    }),
    onAttachError: vi.fn((cb: (error: Error) => void) => {
      attachErrorCb = cb
    }),
    emitData: (data: string) => dataCb?.(data),
    emitExit: (exitCode: number) => exitCb?.({ exitCode }),
    emitAttachError: (error: Error) => attachErrorCb?.(error),
    write: vi.fn(),
    resize: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    kill: vi.fn(),
    destroy: vi.fn()
  }
}

function resolverReturning(plan: ResolvedWindowsTerminalProfile): {
  resolver: WindowsTerminalProfileResolver
  resolveForSpawn: ReturnType<typeof vi.fn>
} {
  const resolveForSpawn = vi.fn().mockResolvedValue(plan)
  return {
    resolver: { resolveForSpawn },
    resolveForSpawn
  }
}

const wslPlan: ResolvedWindowsTerminalProfile = {
  profileId: 'wsl:Ubuntu Dev',
  label: 'WSL — Ubuntu Dev',
  kind: 'wsl',
  shell: String.raw`C:\Windows\System32\wsl.exe`,
  shellArgs: ['-d', 'Ubuntu Dev', '--cd', '/mnt/c/Project With Spaces'],
  cwd: String.raw`C:\Project With Spaces`
}

describe('PtyManager trusted Windows profile spawn boundary', () => {
  let host: FakePlatform
  const managers: import('./pty-manager').PtyManager[] = []

  beforeEach(() => {
    host = fakePlatform()
    initPlatform(host)
    backend.supported.mockReset().mockReturnValue(false)
    backend.create
      .mockReset()
      .mockImplementation(() => fakePty(Promise.resolve({ fresh: true })))
    backend.attachExisting
      .mockReset()
      .mockImplementation(() => fakePty(Promise.resolve({ fresh: false })))
    backend.capture.mockReset().mockResolvedValue('')
    backend.hasSession.mockReset().mockResolvedValue(false)
    backend.kill.mockReset().mockResolvedValue(undefined)
    backend.list.mockReset().mockResolvedValue([])
    backend.paneCommand.mockReset().mockResolvedValue(null)
    backend.sendKeys.mockReset().mockResolvedValue(false)
    nodePty.spawn.mockReset().mockImplementation(() => fakePty())
    windowsProcess.terminate.mockReset().mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await Promise.all(managers.map((manager) => manager.killAll()))
    managers.length = 0
    resetPlatformForTests()
    vi.restoreAllMocks()
  })

  async function makeManager(
    resolver?: WindowsTerminalProfileResolver,
    extra: {
      confirmedProcessRun?: (
        file: string,
        args: readonly string[],
        opts?: object
      ) => Promise<unknown>
    } = {}
  ) {
    const { PtyManager } = await import('./pty-manager')
    const manager = new PtyManager({
      terminalProfiles: resolver,
      runtimePlatform: 'win32',
      ...extra
    })
    managers.push(manager)
    manager.registerIpc()
    return manager
  }

  async function create(options: Record<string, unknown>) {
    return host.handlers[IPC.ptyCreate](7, {
      cols: 80,
      rows: 24,
      persistKey: `node-${Math.random().toString(36).slice(2)}`,
      ...options
    }) as Promise<unknown>
  }

  it('passes one private WSL launch unchanged to direct node-pty, including a spaced cwd', async () => {
    const { resolver, resolveForSpawn } = resolverReturning(wslPlan)
    await makeManager(resolver)
    backend.supported.mockReturnValue(false)

    await create({ profileId: wslPlan.profileId, cwd: wslPlan.cwd })

    expect(resolveForSpawn).toHaveBeenCalledWith({
      profileId: wslPlan.profileId,
      cwd: wslPlan.cwd,
      customExecutable: undefined
    })
    expect(nodePty.spawn).toHaveBeenCalledWith(
      wslPlan.shell,
      wslPlan.shellArgs,
      expect.objectContaining({ cwd: wslPlan.cwd })
    )
    expect(backend.create).not.toHaveBeenCalled()
  })

  it('passes the identical private file, argv, and cwd to the persistent session host', async () => {
    const { resolver } = resolverReturning(wslPlan)
    await makeManager(resolver)
    backend.supported.mockReturnValue(true)

    await create({ profileId: wslPlan.profileId, cwd: wslPlan.cwd })

    expect(backend.create).toHaveBeenCalledTimes(1)
    expect(backend.create.mock.calls[0][1]).toMatchObject({
      shell: wslPlan.shell,
      args: wslPlan.shellArgs,
      cwd: wslPlan.cwd
    })
    expect(nodePty.spawn).not.toHaveBeenCalled()
  })

  it('degrades to a plain, non-persistent shell when the session host cannot be probed', async () => {
    const { resolver } = resolverReturning(wslPlan)
    await makeManager(resolver)
    backend.supported.mockReturnValue(true)
    backend.hasSession.mockRejectedValue(new Error('session-host did not come up in time (15 s)'))

    const result = (await create({ profileId: wslPlan.profileId, cwd: wslPlan.cwd })) as {
      persistent?: boolean
      persistenceUnavailable?: string
    }

    expect(backend.create).not.toHaveBeenCalled()
    expect(nodePty.spawn).toHaveBeenCalledWith(
      wslPlan.shell,
      wslPlan.shellArgs,
      expect.objectContaining({ cwd: wslPlan.cwd })
    )
    expect(result.persistent).toBe(false)
    expect(result.persistenceUnavailable).toMatch(/did not come up in time/)
  })

  it('lets an explicit profile replace caller shell and argv rather than appending either', async () => {
    const trusted: ResolvedWindowsTerminalProfile = {
      profileId: 'pwsh',
      label: 'PowerShell 7',
      kind: 'pwsh',
      shell: String.raw`C:\Program Files\PowerShell\7\pwsh.exe`,
      shellArgs: ['-NoLogo'],
      cwd: process.cwd()
    }
    const { resolver } = resolverReturning(trusted)
    await makeManager(resolver)
    backend.supported.mockReturnValue(true)

    await create({
      profileId: 'pwsh',
      cwd: process.cwd(),
      shell: 'hostile-shared-shell',
      shellArgs: ['--inject', 'not-trusted']
    })

    const spawn = backend.create.mock.calls[0][1]
    expect(spawn.shell).toBe(trusted.shell)
    expect(spawn.args).toEqual(['-NoLogo'])
    expect(spawn.args).not.toContain('--inject')
  })

  it('uses the saved default profile and custom compatibility executable for a legacy node', async () => {
    const customExecutable = String.raw`C:\Program Files\Legacy Shell\legacy shell.exe`
    const trusted: ResolvedWindowsTerminalProfile = {
      profileId: 'custom',
      label: 'Custom executable',
      kind: 'custom',
      shell: customExecutable,
      shellArgs: [],
      cwd: process.cwd()
    }
    const { resolver, resolveForSpawn } = resolverReturning(trusted)
    const manager = await makeManager(resolver)
    manager.init(() => ({
      ...DEFAULT_SETTINGS,
      defaultTerminalProfileId: 'custom',
      defaultShell: customExecutable
    }))
    await create({ persistKey: undefined, cwd: process.cwd() })

    expect(resolveForSpawn).toHaveBeenCalledWith({
      profileId: 'custom',
      cwd: process.cwd(),
      customExecutable
    })
    expect(nodePty.spawn).toHaveBeenCalledWith(
      customExecutable,
      [],
      expect.objectContaining({ cwd: process.cwd() })
    )
  })

  it.each([
    {
      code: 'wsl-distro-missing' as const,
      profileId: 'wsl:Removed Distro',
      message:
        'WSL distribution “Removed Distro” is no longer installed. Refresh terminal profiles or choose another profile.'
    },
    {
      code: 'custom-invalid' as const,
      profileId: 'custom',
      message:
        'The configured custom terminal executable does not exist. Choose another executable in Settings → Shell.'
    },
    {
      code: 'profile-unavailable' as const,
      profileId: 'pwsh',
      message:
        'PowerShell 7 is unavailable. Check its installation, then refresh terminal profiles.'
    }
  ])(
    'keeps the resolver-owned $code reason actionable while failing closed before spawn',
    async ({ code, profileId, message }) => {
      const error = new WindowsTerminalProfileError(code, profileId, message)
      const resolveForSpawn = vi.fn().mockRejectedValue(error)
      await makeManager({ resolveForSpawn })
      backend.supported.mockReturnValue(true)

      const failure = await create({
        profileId,
        cwd: String.raw`Z:\missing-project`
      }).catch((caught: unknown) => caught)

      expect(failure).toBe(error)
      expect(failure).toMatchObject({ code, message })
      expect(resolveForSpawn).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: String.raw`Z:\missing-project` })
      )
      expect(backend.create).not.toHaveBeenCalled()
      expect(nodePty.spawn).not.toHaveBeenCalled()
    }
  )

  it('resolves once for the fresh generation and never again for a same-process warm co-attach', async () => {
    const trusted: ResolvedWindowsTerminalProfile = {
      profileId: 'cmd',
      label: 'Command Prompt',
      kind: 'cmd',
      shell: String.raw`C:\Windows\System32\cmd.exe`,
      shellArgs: [],
      cwd: process.cwd()
    }
    const { resolver, resolveForSpawn } = resolverReturning(trusted)
    await makeManager(resolver)
    backend.supported.mockReturnValue(true)
    const options = {
      cols: 80,
      rows: 24,
      persistKey: 'node-warm',
      profileId: 'cmd',
      cwd: process.cwd()
    }
    const handler = host.handlers[IPC.ptyCreate]

    const first = (await handler(7, options)) as { sessionId: string; fresh: boolean }
    const second = (await handler(8, options)) as { sessionId: string; fresh: boolean }

    expect(first).toMatchObject({ sessionId: 'pty-1', fresh: true })
    expect(second).toMatchObject({ sessionId: 'pty-1', fresh: false })
    expect(resolveForSpawn).toHaveBeenCalledTimes(1)
    expect(backend.create).toHaveBeenCalledTimes(1)
  })

  it('does not apply local profiles to local SSH or detached relay spawns', async () => {
    const { resolver, resolveForSpawn } = resolverReturning(wslPlan)
    const manager = await makeManager(resolver)
    backend.supported.mockReturnValue(true)

    await create({ profileId: 'pwsh', shell: 'ssh', shellArgs: ['example.test'] })
    manager.createDetached(
      { cols: 80, rows: 24, persistKey: 'relay-profile', profileId: 'pwsh' },
      { onData: () => {}, onExit: () => {} }
    )

    expect(resolveForSpawn).not.toHaveBeenCalled()
    expect(backend.create).toHaveBeenCalledTimes(2)
  })

  it('forces a cold native profile through session-host operations even when tmux is discovered', async () => {
    const trusted: ResolvedWindowsTerminalProfile = {
      profileId: 'pwsh',
      label: 'PowerShell 7',
      kind: 'pwsh',
      shell: String.raw`C:\Program Files\PowerShell\7\pwsh.exe`,
      shellArgs: ['-NoLogo'],
      cwd: process.cwd()
    }
    const { resolver } = resolverReturning(trusted)
    const manager = await makeManager(resolver)
    backend.supported.mockReturnValue(true)
    backend.hasSession.mockResolvedValue(false)
    backend.capture.mockResolvedValue('host-screen')
    backend.sendKeys.mockResolvedValue(true)
    backend.paneCommand.mockResolvedValue('pwsh')
    backend.list.mockResolvedValue(['nt-node-native'])
    // cmd exits 1 for tmux's flags, giving the strict probe honest absence while still proving
    // that a globally discovered executable cannot win this generation's backend dispatch.
    ;(manager as unknown as { tmuxPath: string | null }).tmuxPath = String.raw`C:\Windows\System32\where.exe`
    const options = {
      cols: 80,
      rows: 24,
      persistKey: 'node-native',
      profileId: 'pwsh',
      cwd: trusted.cwd
    }

    await expect(host.handlers[IPC.ptyCreate](7, options)).resolves.toMatchObject({
      sessionId: 'pty-1',
      persistent: true
    })
    expect(backend.create).toHaveBeenCalledWith(
      'nt-node-native',
      expect.objectContaining({
        shell: trusted.shell,
        args: trusted.shellArgs,
        cwd: trusted.cwd
      }),
      expect.any(Number)
    )
    expect(nodePty.spawn).not.toHaveBeenCalled()

    await expect(manager.captureSession(options.persistKey)).resolves.toBe('host-screen')
    await expect(manager.sendText(options.persistKey, 'Get-Location')).resolves.toBe(true)
    await expect(manager.paneCommand(options.persistKey)).resolves.toBe('pwsh')
    await expect(manager.listNodetermSessions()).resolves.toContain('nt-node-native')
    expect(backend.capture).toHaveBeenCalledWith('nt-node-native', false)
    expect(backend.sendKeys).toHaveBeenCalledWith('nt-node-native', 'Get-Location', true)
    expect(backend.paneCommand).toHaveBeenCalledWith('nt-node-native')

    await manager.recycleSessionFromClient(7, options.persistKey)
    expect(backend.kill).toHaveBeenCalledWith('nt-node-native', {
      reserveReplacement: true,
      requireV2: true
    })
  })

  it('reattaches a proven warm host generation without resolving a removed profile or cwd', async () => {
    const resolveForSpawn = vi.fn().mockRejectedValue(new Error('removed executable and distro'))
    const manager = await makeManager({ resolveForSpawn })
    backend.supported.mockReturnValue(true)
    backend.hasSession.mockResolvedValue(true)
    backend.attachExisting.mockReturnValue(
      fakePty(Promise.resolve({ fresh: false, screen: 'long-lived process' }))
    )
    ;(manager as unknown as { tmuxPath: string | null }).tmuxPath = String.raw`C:\Windows\System32\where.exe`

    await expect(
      host.handlers[IPC.ptyCreate](7, {
        cols: 80,
        rows: 24,
        persistKey: 'node-warm-host',
        profileId: 'wsl:Removed Distro',
        cwd: String.raw`Z:\removed\project`
      })
    ).resolves.toMatchObject({
      sessionId: 'pty-1',
      fresh: false,
      persistent: true,
      screen: 'long-lived process'
    })
    expect(resolveForSpawn).not.toHaveBeenCalled()
    expect(backend.attachExisting).toHaveBeenCalledWith('nt-node-warm-host')
    expect(backend.create).not.toHaveBeenCalled()
    expect(nodePty.spawn).not.toHaveBeenCalled()
  })

  it('fails a warm attach-only race closed and never falls through to resolution or creation', async () => {
    const resolveForSpawn = vi.fn()
    await makeManager({ resolveForSpawn })
    backend.supported.mockReturnValue(true)
    backend.hasSession.mockResolvedValue(true)
    backend.attachExisting.mockReturnValue(
      fakePty(Promise.reject(new Error("no existing session 'nt-node-raced-away'")))
    )

    await expect(
      host.handlers[IPC.ptyCreate](7, {
        cols: 80,
        rows: 24,
        persistKey: 'node-raced-away',
        profileId: 'pwsh',
        cwd: process.cwd()
      })
    ).rejects.toThrow('no existing session')
    expect(resolveForSpawn).not.toHaveBeenCalled()
    expect(backend.create).not.toHaveBeenCalled()
    expect(nodePty.spawn).not.toHaveBeenCalled()
  })

  it('reattaches a proven warm legacy tmux generation without resolving its removed profile', async () => {
    const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-tmux-probe-'))
    const oldPath = process.env.PATH
    try {
      for (const name of ['-L', 'node-terminal', 'has-session', '-t', 'nt-node-warm-tmux'])
        fs.writeFileSync(path.join(probeDir, `${name}.exe`), '')
      process.env.PATH = `${probeDir}${path.delimiter}${oldPath ?? ''}`
      const resolveForSpawn = vi.fn().mockRejectedValue(new Error('removed legacy profile'))
      const manager = await makeManager({ resolveForSpawn })
      backend.supported.mockReturnValue(false)
      ;(manager as unknown as { tmuxPath: string | null }).tmuxPath = String.raw`C:\Windows\System32\where.exe`

      await expect(
        host.handlers[IPC.ptyCreate](7, {
          cols: 80,
          rows: 24,
          persistKey: 'node-warm-tmux',
          profileId: 'git-bash',
          cwd: String.raw`Z:\removed\legacy-project`
        })
      ).resolves.toMatchObject({ sessionId: 'pty-1', fresh: false, persistent: true })

      expect(resolveForSpawn).not.toHaveBeenCalled()
      expect(backend.create).not.toHaveBeenCalled()
      expect(backend.attachExisting).not.toHaveBeenCalled()
      expect(nodePty.spawn).toHaveBeenCalledTimes(1)
      const args = nodePty.spawn.mock.calls[0][1] as string[]
      expect(args).toContain('attach-session')
      expect(args).not.toContain('new-session')
      expect(args).not.toContain(String.raw`Z:\removed\legacy-project`)
    } finally {
      process.env.PATH = oldPath
      fs.rmSync(probeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })

  it('preflights a selected target before teardown and keeps private launch paths out of errors', async () => {
    const secret = String.raw`C:\Private User\Secret Shell\pwsh.exe`
    const trusted: ResolvedWindowsTerminalProfile = {
      profileId: 'pwsh',
      label: 'PowerShell 7',
      kind: 'pwsh',
      shell: secret,
      shellArgs: ['--private-value'],
      cwd: String.raw`C:\Private User\Secret Project`
    }
    const { resolver, resolveForSpawn } = resolverReturning(trusted)
    const manager = await makeManager(resolver)
    backend.supported.mockReturnValue(true)
    backend.hasSession.mockResolvedValue(false)

    resolveForSpawn.mockRejectedValueOnce(
      new Error(`could not inspect ${secret} --private-value ${trusted.cwd}`)
    )
    const failure = await manager
      .recycleSessionFromClient(7, 'node-preflight', {
        profileId: 'pwsh',
        cwd: trusted.cwd
      })
      .catch((error: Error) => error)

    expect(failure).toBeInstanceOf(Error)
    if (!(failure instanceof Error)) throw new Error('expected profile preflight to reject')
    expect(failure.message).toContain('selected terminal profile is unavailable')
    expect(failure.message).not.toContain(secret)
    expect(failure.message).not.toContain('--private-value')
    expect(failure.message).not.toContain(trusted.cwd)
    expect(resolveForSpawn).toHaveBeenCalledWith({
      profileId: 'pwsh',
      cwd: trusted.cwd,
      customExecutable: undefined
    })
    expect(backend.kill).not.toHaveBeenCalled()
  })

  it('parks stale primary-view props until the preflighted profile and cwd create arrives', async () => {
    const targetCwd = String.raw`C:\Projects\New Target`
    const trusted: ResolvedWindowsTerminalProfile = {
      profileId: 'pwsh',
      label: 'PowerShell 7',
      kind: 'pwsh',
      shell: String.raw`C:\Program Files\PowerShell\7\pwsh.exe`,
      shellArgs: ['-NoLogo'],
      cwd: targetCwd
    }
    const { resolver } = resolverReturning(trusted)
    const manager = await makeManager(resolver)
    backend.supported.mockReturnValue(true)
    const original = fakePty(Promise.resolve({ fresh: true }))
    const replacement = fakePty(Promise.resolve({ fresh: true }))
    backend.create.mockImplementationOnce(() => original).mockImplementationOnce(() => replacement)
    const oldOptions = {
      cols: 80,
      rows: 24,
      persistKey: 'node-stale-primary-props',
      profileId: 'cmd',
      cwd: String.raw`C:\Projects\Old Target`
    }
    await host.handlers[IPC.ptyCreate](7, oldOptions)
    await manager.recycleSessionFromClient(7, oldOptions.persistKey, {
      profileId: 'pwsh',
      cwd: targetCwd
    })

    let staleSettled = false
    const staleCreate = (host.handlers[IPC.ptyCreate](7, oldOptions) as Promise<unknown>).then(
      (result) => {
        staleSettled = true
        return result
      }
    )
    await Promise.resolve()
    expect(staleSettled).toBe(false)
    expect(backend.create).toHaveBeenCalledTimes(1)

    await expect(
      host.handlers[IPC.ptyCreate](7, {
        ...oldOptions,
        profileId: 'pwsh',
        cwd: targetCwd
      })
    ).resolves.toMatchObject({ sessionId: 'pty-2', fresh: true })
    await expect(staleCreate).resolves.toMatchObject({ sessionId: 'pty-2', fresh: false })
    expect(backend.create).toHaveBeenCalledTimes(2)
  })

  it('ends an indexed host generation and a hidden same-name tmux generation before replacement', async () => {
    const targetCwd = String.raw`C:\Projects\Dual Host Tmux`
    const trusted: ResolvedWindowsTerminalProfile = {
      profileId: 'pwsh',
      label: 'PowerShell 7',
      kind: 'pwsh',
      shell: String.raw`C:\Program Files\PowerShell\7\pwsh.exe`,
      shellArgs: ['-NoLogo'],
      cwd: targetCwd
    }
    let tmuxExists = false
    const confirmedProcessRun = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args.includes('has-session')) {
        if (tmuxExists) return {}
        throw Object.assign(new Error('no tmux session'), { code: 1 })
      }
      if (args.includes('kill-session')) {
        tmuxExists = false
        return {}
      }
      throw new Error(`unexpected tmux operation: ${args.join(' ')}`)
    })
    const { resolver } = resolverReturning(trusted)
    const manager = await makeManager(resolver, { confirmedProcessRun })
    ;(manager as unknown as { tmuxPath: string | null }).tmuxPath = 'fake-tmux.exe'
    backend.supported.mockReturnValue(true)
    backend.hasSession.mockResolvedValueOnce(false).mockResolvedValue(true)
    const options = {
      cols: 80,
      rows: 24,
      persistKey: 'node-indexed-host-hidden-tmux',
      profileId: 'pwsh',
      cwd: targetCwd
    }
    await host.handlers[IPC.ptyCreate](7, options)
    tmuxExists = true
    backend.kill.mockClear()
    confirmedProcessRun.mockClear()

    await manager.recycleSessionFromClient(7, options.persistKey, {
      profileId: 'pwsh',
      cwd: targetCwd
    })

    expect(backend.kill).toHaveBeenCalledWith('nt-node-indexed-host-hidden-tmux', {
      reserveReplacement: true,
      requireV2: true
    })
    expect(
      confirmedProcessRun.mock.calls.some(([, args]) =>
        (args as readonly string[]).includes('kill-session')
      )
    ).toBe(true)
    expect(tmuxExists).toBe(false)
  })

  it('ends an indexed tmux generation and a hidden same-name host generation before replacement', async () => {
    const targetCwd = String.raw`C:\Projects\Dual Tmux Host`
    const trusted: ResolvedWindowsTerminalProfile = {
      profileId: 'pwsh',
      label: 'PowerShell 7',
      kind: 'pwsh',
      shell: String.raw`C:\Program Files\PowerShell\7\pwsh.exe`,
      shellArgs: ['-NoLogo'],
      cwd: targetCwd
    }
    let tmuxExists = true
    const confirmedProcessRun = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args.includes('has-session')) {
        if (tmuxExists) return {}
        throw Object.assign(new Error('no tmux session'), { code: 1 })
      }
      if (args.includes('kill-session')) {
        tmuxExists = false
        return {}
      }
      throw new Error(`unexpected tmux operation: ${args.join(' ')}`)
    })
    const { resolver, resolveForSpawn } = resolverReturning(trusted)
    const manager = await makeManager(resolver, { confirmedProcessRun })
    ;(manager as unknown as { tmuxPath: string | null }).tmuxPath = 'fake-tmux.exe'
    backend.supported.mockReturnValue(true)
    backend.hasSession.mockResolvedValueOnce(false).mockResolvedValue(true)
    const options = {
      cols: 80,
      rows: 24,
      persistKey: 'node-indexed-tmux-hidden-host',
      profileId: 'pwsh',
      cwd: targetCwd
    }
    await expect(host.handlers[IPC.ptyCreate](7, options)).resolves.toMatchObject({
      fresh: false,
      persistent: true
    })
    expect(resolveForSpawn).not.toHaveBeenCalled()
    backend.kill.mockClear()
    confirmedProcessRun.mockClear()

    await manager.recycleSessionFromClient(7, options.persistKey, {
      profileId: 'pwsh',
      cwd: targetCwd
    })

    expect(backend.kill).toHaveBeenCalledWith('nt-node-indexed-tmux-hidden-host', {
      reserveReplacement: true,
      requireV2: true
    })
    expect(
      confirmedProcessRun.mock.calls.some(([, args]) =>
        (args as readonly string[]).includes('kill-session')
      )
    ).toBe(true)
    expect(tmuxExists).toBe(false)
  })

  it('still ends an old tmux generation after persistence is disabled without leasing the direct target', async () => {
    const targetCwd = String.raw`C:\Projects\Direct Replacement`
    const trusted: ResolvedWindowsTerminalProfile = {
      profileId: 'pwsh',
      label: 'PowerShell 7',
      kind: 'pwsh',
      shell: String.raw`C:\Program Files\PowerShell\7\pwsh.exe`,
      shellArgs: ['-NoLogo'],
      cwd: targetCwd
    }
    let tmuxExists = true
    const confirmedProcessRun = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args.includes('has-session')) {
        if (tmuxExists) return {}
        throw Object.assign(new Error('no tmux session'), { code: 1 })
      }
      if (args.includes('kill-session')) {
        tmuxExists = false
        return {}
      }
      throw new Error(`unexpected tmux operation: ${args.join(' ')}`)
    })
    const { resolver } = resolverReturning(trusted)
    const manager = await makeManager(resolver, { confirmedProcessRun })
    ;(manager as unknown as { tmuxPath: string | null }).tmuxPath = 'fake-tmux.exe'
    backend.supported.mockReturnValue(true)
    backend.hasSession.mockResolvedValue(false)
    const options = {
      cols: 80,
      rows: 24,
      persistKey: 'node-disabled-old-tmux',
      profileId: 'pwsh',
      cwd: targetCwd
    }
    await host.handlers[IPC.ptyCreate](7, options)
    manager.init(() => ({ ...DEFAULT_SETTINGS, tmuxEnabled: false }))
    backend.kill.mockClear()
    confirmedProcessRun.mockClear()

    await manager.recycleSessionFromClient(7, options.persistKey, {
      profileId: 'pwsh',
      cwd: targetCwd
    })

    expect(backend.kill).not.toHaveBeenCalled()
    expect(
      confirmedProcessRun.mock.calls.some(([, args]) =>
        (args as readonly string[]).includes('kill-session')
      )
    ).toBe(true)
    expect(tmuxExists).toBe(false)
  })

  it('proves an indexed plain exit independently after hidden host and tmux teardown', async () => {
    const targetCwd = String.raw`C:\Projects\Plain Plus Hidden`
    const trusted: ResolvedWindowsTerminalProfile = {
      profileId: 'pwsh',
      label: 'PowerShell 7',
      kind: 'pwsh',
      shell: String.raw`C:\Program Files\PowerShell\7\pwsh.exe`,
      shellArgs: ['-NoLogo'],
      cwd: targetCwd
    }
    const order: string[] = []
    let tmuxExists = true
    const confirmedProcessRun = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args.includes('has-session')) {
        if (tmuxExists) return {}
        throw Object.assign(new Error('no tmux session'), { code: 1 })
      }
      if (args.includes('kill-session')) {
        order.push('tmux-kill')
        tmuxExists = false
        return {}
      }
      throw new Error(`unexpected tmux operation: ${args.join(' ')}`)
    })
    const { resolver } = resolverReturning(trusted)
    const manager = await makeManager(resolver, { confirmedProcessRun })
    manager.init(() => ({ ...DEFAULT_SETTINGS, tmuxEnabled: false }))
    backend.supported.mockReturnValue(false)
    const silent = fakePty()
    silent.destroy.mockImplementation(() => {
      order.push('plain-release')
    })
    nodePty.spawn.mockReturnValue(silent)
    const options = {
      cols: 80,
      rows: 24,
      persistKey: 'node-plain-hidden-backends',
      profileId: 'pwsh',
      cwd: targetCwd
    }
    await host.handlers[IPC.ptyCreate](7, options)

    // Persistence became available after this direct generation was created, while migration left
    // both same-name persistent backends behind. They are independent teardown obligations; their
    // discovery must not reclassify the indexed direct PTY and skip its death proof.
    manager.init(() => ({ ...DEFAULT_SETTINGS, tmuxEnabled: true }))
    ;(manager as unknown as { tmuxPath: string | null }).tmuxPath = 'fake-tmux.exe'
    backend.supported.mockReturnValue(true)
    backend.hasSession.mockResolvedValue(true)
    backend.kill.mockImplementationOnce(async () => {
      order.push('host-reserve')
    })
    let settled = false
    const recycling = manager
      .recycleSessionFromClient(7, options.persistKey, {
        profileId: 'pwsh',
        cwd: targetCwd
      })
      .then(() => {
        settled = true
      })

    await vi.waitFor(() => expect(order).toEqual(['host-reserve', 'tmux-kill', 'plain-release']))
    expect(settled).toBe(false)
    expect(windowsProcess.terminate).not.toHaveBeenCalled()
    silent.emitExit(0)
    await recycling
    expect(settled).toBe(true)
    expect(backend.kill).toHaveBeenCalledWith('nt-node-plain-hidden-backends', {
      reserveReplacement: true,
      requireV2: true
    })
  })

  it('does not taskkill a stale plain pid after that exact generation exits during backend probes', async () => {
    const targetCwd = String.raw`C:\Projects\Natural Exit During Probe`
    const trusted: ResolvedWindowsTerminalProfile = {
      profileId: 'cmd',
      label: 'Command Prompt',
      kind: 'cmd',
      shell: String.raw`C:\Windows\System32\cmd.exe`,
      shellArgs: [],
      cwd: targetCwd
    }
    const { resolver } = resolverReturning(trusted)
    const manager = await makeManager(resolver)
    manager.init(() => ({ ...DEFAULT_SETTINGS, tmuxEnabled: false }))
    backend.supported.mockReturnValue(true)
    let finishProbe!: (exists: boolean) => void
    backend.hasSession.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishProbe = resolve
        })
    )
    const plain = fakePty() as ReturnType<typeof fakePty> & { pid: number }
    plain.pid = 4242
    nodePty.spawn.mockReturnValue(plain)
    const options = {
      cols: 80,
      rows: 24,
      persistKey: 'node-natural-exit-probe',
      profileId: 'cmd',
      cwd: targetCwd
    }
    await host.handlers[IPC.ptyCreate](7, options)

    const recycling = manager.recycleSessionFromClient(7, options.persistKey, {
      profileId: 'cmd',
      cwd: targetCwd
    })
    await vi.waitFor(() => expect(finishProbe).toBeTypeOf('function'))
    plain.emitExit(0)
    finishProbe(false)

    await expect(recycling).resolves.toBeUndefined()
    expect(windowsProcess.terminate).not.toHaveBeenCalled()
  })

  it('does not confirm a plain Windows recycle without a PID until the exact PTY generation exits', async () => {
    const trusted: ResolvedWindowsTerminalProfile = {
      profileId: 'cmd',
      label: 'Command Prompt',
      kind: 'cmd',
      shell: String.raw`C:\Windows\System32\cmd.exe`,
      shellArgs: [],
      cwd: process.cwd()
    }
    const { resolver } = resolverReturning(trusted)
    const manager = await makeManager(resolver)
    manager.init(() => ({ ...DEFAULT_SETTINGS, tmuxEnabled: false }))
    backend.supported.mockReturnValue(false)
    const silent = fakePty()
    nodePty.spawn.mockReturnValue(silent)
    const options = {
      cols: 80,
      rows: 24,
      persistKey: 'node-plain-silent',
      profileId: 'cmd',
      cwd: trusted.cwd
    }
    await host.handlers[IPC.ptyCreate](7, options)

    let settled = false
    const recycle = manager.recycleSessionFromClient(7, options.persistKey).then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(silent.destroy).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(settled).toBe(false)

    silent.emitExit(0)
    await expect(recycle).resolves.toBeUndefined()
    expect(settled).toBe(true)
    expect(backend.kill).not.toHaveBeenCalled()
  })

  it('accepts confirmed Windows process-tree absence when node-pty never emits exit', async () => {
    const trusted: ResolvedWindowsTerminalProfile = {
      profileId: 'cmd',
      label: 'Command Prompt',
      kind: 'cmd',
      shell: String.raw`C:\Windows\System32\cmd.exe`,
      shellArgs: [],
      cwd: process.cwd()
    }
    const { resolver } = resolverReturning(trusted)
    const manager = await makeManager(resolver)
    manager.init(() => ({ ...DEFAULT_SETTINGS, tmuxEnabled: false }))
    backend.supported.mockReturnValue(false)
    const silent = { ...fakePty(), pid: 4321 }
    const replacement = fakePty()
    nodePty.spawn.mockReturnValueOnce(silent).mockReturnValueOnce(replacement)
    const options = {
      cols: 80,
      rows: 24,
      persistKey: 'node-plain-taskkill-proof',
      profileId: 'cmd',
      cwd: trusted.cwd
    }
    await host.handlers[IPC.ptyCreate](7, options)

    await expect(manager.recycleSessionFromClient(7, options.persistKey)).resolves.toBeUndefined()
    expect(windowsProcess.terminate).toHaveBeenCalledWith(4321)

    // No onExit arrived, but taskkill's verified absence retired the old exact generation.
    await expect(host.handlers[IPC.ptyCreate](7, options)).resolves.toMatchObject({
      sessionId: 'pty-2',
      fresh: true
    })
    expect(nodePty.spawn).toHaveBeenCalledTimes(2)
  })

  it('bounds a plain non-Windows recycle when the exact PTY never reports exit', async () => {
    const { PtyManager, CONFIRMED_PLAIN_EXIT_TIMEOUT_MS } = await import('./pty-manager')
    const manager = new PtyManager({ runtimePlatform: 'linux' })
    managers.push(manager)
    manager.init(() => ({ ...DEFAULT_SETTINGS, tmuxEnabled: false }))
    manager.registerIpc()
    const silent = fakePty()
    nodePty.spawn.mockReturnValue(silent)
    const options = { cols: 80, rows: 24, persistKey: 'node-plain-timeout' }
    await host.handlers[IPC.ptyCreate](7, options)

    vi.useFakeTimers()
    try {
      const recycle = manager.recycleSessionFromClient(7, options.persistKey)
      const rejection = expect(recycle).rejects.toThrow('did not confirm that it exited')
      await Promise.resolve()
      expect(silent.destroy).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(CONFIRMED_PLAIN_EXIT_TIMEOUT_MS)
      await rejection
    } finally {
      vi.useRealTimers()
    }

    // An unconfirmed end does not publish cleanup or let another client cold-spawn over it.
    await expect(host.handlers[IPC.ptyCreate](8, options)).resolves.toMatchObject({
      sessionId: 'pty-1',
      fresh: false
    })
    expect(nodePty.spawn).toHaveBeenCalledTimes(1)
  })
})
