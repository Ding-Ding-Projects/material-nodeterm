import { describe, expect, it, vi } from 'vitest'
import {
  desktopBootstrapFailureDialog,
  decideSquirrelLifecycle,
  executeSquirrelCommand,
  publicDesktopBootstrapFailure,
  runDesktopStartup,
  SQUIRREL_LIFECYCLE_TIMEOUT_MS,
  SQUIRREL_SHORTCUT_EXECUTABLE,
  type SquirrelCommand,
  type SquirrelExecFile,
  type SquirrelLifecycleEvent
} from './squirrel-lifecycle'

const INSTALLED_EXE = String.raw`C:\Users\Example User\AppData\Local\node-terminal\app-0.3.0\nodeterm.exe`
const UPDATE_EXE = String.raw`C:\Users\Example User\AppData\Local\node-terminal\Update.exe`

describe('Squirrel.Windows lifecycle decision', () => {
  it.each([
    ['--squirrel-install', 'install', '--createShortcut'],
    ['--squirrel-updated', 'updated', '--createShortcut'],
    ['--squirrel-uninstall', 'uninstall', '--removeShortcut']
  ] as const)('maps %s to one exact updater command', (argument, event, action) => {
    expect(decideSquirrelLifecycle('win32', [INSTALLED_EXE, argument], INSTALLED_EXE)).toEqual({
      handled: true,
      event,
      command: {
        file: UPDATE_EXE,
        args: [action, 'nodeterm.exe']
      }
    })
  })

  it('handles obsolete without touching shortcuts or starting a child process', () => {
    expect(
      decideSquirrelLifecycle(
        'win32',
        [INSTALLED_EXE, '--squirrel-obsolete'],
        INSTALLED_EXE
      )
    ).toEqual({ handled: true, event: 'obsolete' })
  })

  it('refuses Electron or publisher executables instead of touching any of their shortcuts', () => {
    const electronExe = String.raw`C:\Program Files\GitHub, Inc\Electron\electron.exe`
    const decision = decideSquirrelLifecycle(
      'win32',
      [electronExe, '--squirrel-install'],
      electronExe
    )

    expect(SQUIRREL_SHORTCUT_EXECUTABLE).toBe('nodeterm.exe')
    expect(decision).toEqual({
      handled: true,
      event: 'install',
      invalidExecutablePath: true
    })
    expect(decision).not.toHaveProperty('command')
  })

  it('fails closed on a relative executable path instead of resolving Update.exe from cwd', () => {
    expect(
      decideSquirrelLifecycle('win32', ['nodeterm.exe', '--squirrel-install'], 'nodeterm.exe')
    ).toEqual({ handled: true, event: 'install', invalidExecutablePath: true })
  })

  it('ignores lifecycle-looking text outside argv[1] and every non-Windows invocation', () => {
    expect(
      decideSquirrelLifecycle(
        'win32',
        [INSTALLED_EXE, '--ordinary', '--squirrel-uninstall'],
        INSTALLED_EXE
      )
    ).toEqual({ handled: false })
    expect(
      decideSquirrelLifecycle('darwin', [INSTALLED_EXE, '--squirrel-install'], INSTALLED_EXE)
    ).toEqual({ handled: false })
  })
})

describe('structured Squirrel.Windows command execution', () => {
  it('passes paths containing spaces as an execFile path plus argv, never an interpolated shell', async () => {
    const calls: unknown[][] = []
    const fakeExecFile: SquirrelExecFile = (file, args, options, callback) => {
      calls.push([file, args, options])
      callback(null)
    }

    await executeSquirrelCommand(
      { file: UPDATE_EXE, args: ['--createShortcut', 'nodeterm.exe'] },
      fakeExecFile
    )

    expect(calls).toEqual([
      [
        UPDATE_EXE,
        ['--createShortcut', 'nodeterm.exe'],
        {
          windowsHide: true,
          timeout: SQUIRREL_LIFECYCLE_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          maxBuffer: 64 * 1024
        }
      ]
    ])
  })

  it('rejects with a sanitized error that retains no local path or child-process message', async () => {
    const privateFailure = `spawn ${UPDATE_EXE} EACCES for Example User`
    const fakeExecFile: SquirrelExecFile = (_file, _args, _options, callback) => {
      callback(new Error(privateFailure))
    }

    const failure = await executeSquirrelCommand(
      { file: UPDATE_EXE, args: ['--removeShortcut', 'nodeterm.exe'] },
      fakeExecFile
    ).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('Squirrel lifecycle command failed.')
    expect((failure as Error).message).not.toContain(UPDATE_EXE)
    expect((failure as Error).message).not.toContain(privateFailure)
  })

  it('also sanitizes an execFile implementation that throws synchronously', async () => {
    const fakeExecFile: SquirrelExecFile = () => {
      throw new Error(`synchronous EACCES at ${UPDATE_EXE}`)
    }

    await expect(
      executeSquirrelCommand(
        { file: UPDATE_EXE, args: ['--createShortcut', 'nodeterm.exe'] },
        fakeExecFile
      )
    ).rejects.toThrow('Squirrel lifecycle command failed.')
  })
})

describe('normal bootstrap error reporting', () => {
  it('retains a safe module failure code without leaking its private path', () => {
    const failure = Object.assign(
      new Error(`Cannot find module at ${String.raw`C:\Users\Example User\private\main.js`}`),
      { code: 'ERR_MODULE_NOT_FOUND' }
    )

    const message = publicDesktopBootstrapFailure(failure)

    expect(message).toBe('[startup] Desktop bootstrap failed (ERR_MODULE_NOT_FOUND).')
    expect(message).not.toContain('Example User')
    expect(message).not.toContain('private')
  })

  it('falls back safely for private or unknown error metadata', () => {
    expect(publicDesktopBootstrapFailure({ code: 'SECRET_TOKEN', name: 'PrivateFailure' })).toBe(
      '[startup] Desktop bootstrap failed.'
    )
    expect(publicDesktopBootstrapFailure({ code: String.raw`C:\private`, name: 'Bad Error!' })).toBe(
      '[startup] Desktop bootstrap failed.'
    )
  })

  it('builds a full path-free recovery dialog for a missing packaged component', () => {
    const failure = Object.assign(
      new Error(`Cannot find module at ${String.raw`C:\Users\Example User\private\sharp`}`),
      { code: 'MODULE_NOT_FOUND' }
    )

    const dialog = desktopBootstrapFailureDialog(failure)

    expect(dialog.title).toBe('nodeterm could not start')
    expect(dialog.content).toContain('required component is missing')
    expect(dialog.content).toContain('Error category: MODULE_NOT_FOUND')
    expect(dialog.content).toContain('Reinstalling the same release will not repair')
    expect(dialog.content).toContain('settings and projects were not removed')
    expect(dialog.content).not.toContain('Example User')
    expect(dialog.content).not.toContain('private')
    expect(dialog.content).not.toContain('sharp')
  })

  it('shows generic recovery without inventing a private error category', () => {
    const dialog = desktopBootstrapFailureDialog({ code: 'SECRET_TOKEN', name: 'PrivateFailure' })

    expect(dialog.title).toBe('nodeterm could not start')
    expect(dialog.content).toContain('early startup problem')
    expect(dialog.content).not.toContain('SECRET_TOKEN')
    expect(dialog.content).not.toContain('PrivateFailure')
  })
})

describe('early desktop startup routing', () => {
  function harness(argument?: string, runSquirrelCommand?: (command: SquirrelCommand) => Promise<void>) {
    const loadNormalBootstrap = vi.fn(async () => undefined)
    const exit = vi.fn<(code: number) => void>()
    const reportLifecycleFailure = vi.fn<(event: SquirrelLifecycleEvent) => void>()
    const argv = argument ? [INSTALLED_EXE, argument] : [INSTALLED_EXE]
    return {
      loadNormalBootstrap,
      exit,
      reportLifecycleFailure,
      run: () =>
        runDesktopStartup({
          platform: 'win32',
          argv,
          executablePath: INSTALLED_EXE,
          loadNormalBootstrap,
          exit,
          reportLifecycleFailure,
          runSquirrelCommand
        })
    }
  }

  it.each([
    '--squirrel-install',
    '--squirrel-updated',
    '--squirrel-uninstall',
    '--squirrel-obsolete'
  ])('%s never reaches normal bootstrap', async (argument) => {
    const runSquirrelCommand = vi.fn(async () => undefined)
    const h = harness(argument, runSquirrelCommand)

    await h.run()

    expect(h.loadNormalBootstrap).not.toHaveBeenCalled()
    expect(h.exit).toHaveBeenCalledOnce()
    expect(h.exit).toHaveBeenCalledWith(0)
    expect(h.reportLifecycleFailure).not.toHaveBeenCalled()
    expect(runSquirrelCommand).toHaveBeenCalledTimes(argument === '--squirrel-obsolete' ? 0 : 1)
  })

  it('loads normal bootstrap exactly once when no lifecycle event is present', async () => {
    const h = harness()

    await h.run()

    expect(h.loadNormalBootstrap).toHaveBeenCalledOnce()
    expect(h.exit).not.toHaveBeenCalled()
  })

  it('treats --squirrel-firstrun as an ordinary launch', async () => {
    const h = harness('--squirrel-firstrun')

    await h.run()

    expect(h.loadNormalBootstrap).toHaveBeenCalledOnce()
    expect(h.exit).not.toHaveBeenCalled()
    expect(h.reportLifecycleFailure).not.toHaveBeenCalled()
  })

  it('reports only the event and exits 1 on timeout without reaching normal bootstrap', async () => {
    const h = harness('--squirrel-install', async () => {
      throw new Error(`ETIMEDOUT after ${SQUIRREL_LIFECYCLE_TIMEOUT_MS}ms: ${UPDATE_EXE}`)
    })

    await h.run()

    expect(h.loadNormalBootstrap).not.toHaveBeenCalled()
    expect(h.reportLifecycleFailure).toHaveBeenCalledWith('install')
    expect(h.reportLifecycleFailure.mock.calls.flat().join(' ')).not.toContain(UPDATE_EXE)
    expect(h.exit).toHaveBeenCalledWith(1)
  })
})
