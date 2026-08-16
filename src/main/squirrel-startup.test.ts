import { describe, expect, it, vi } from 'vitest'
import {
  SQUIRREL_FIRST_RUN_UPDATE_DELAY_MS,
  SQUIRREL_STARTUP_QUIT_DEADLINE_MS,
  beginDesktopStartup,
  handleSquirrelStartup,
  initialAutomaticUpdateDelayMs,
  planSquirrelStartup,
  type SquirrelChildProcess
} from './squirrel-startup'

const EXECUTABLE = String.raw`C:\Users\me\AppData\Local\node-terminal\app-0.4.0\nodeterm.exe`

function fakeChild() {
  const listeners = new Map<'close' | 'error', () => void>()
  const unref = vi.fn<() => void>()
  const child: SquirrelChildProcess = {
    once(event, listener) {
      listeners.set(event, listener)
      return this
    },
    unref
  }
  return Object.assign(child, { listeners, unref })
}

describe('planSquirrelStartup', () => {
  it.each([
    ['--squirrel-install', 'install', '--createShortcut'],
    ['--squirrel-updated', 'updated', '--createShortcut'],
    ['--squirrel-uninstall', 'uninstall', '--removeShortcut']
  ] as const)('plans %s without loading the app graph', (flag, reason, operation) => {
    expect(planSquirrelStartup(['nodeterm.exe', flag], 'win32', EXECUTABLE)).toEqual({
      kind: 'shortcut',
      reason,
      command: String.raw`C:\Users\me\AppData\Local\node-terminal\Update.exe`,
      args: [operation, 'nodeterm.exe']
    })
  })

  it('quits obsolete versions without spawning an updater command', () => {
    expect(planSquirrelStartup(['nodeterm.exe', '--squirrel-obsolete'], 'win32', EXECUTABLE)).toEqual({
      kind: 'quit-now',
      reason: 'obsolete'
    })
  })

  it('does not treat first-run or unrelated arguments as lifecycle processes', () => {
    expect(planSquirrelStartup(['nodeterm.exe', '--squirrel-firstrun'], 'win32', EXECUTABLE)).toBeNull()
    expect(planSquirrelStartup(['nodeterm.exe', '--squirrel-install-extra'], 'win32', EXECUTABLE)).toBeNull()
  })

  it('never handles Squirrel-looking flags on non-Windows platforms', () => {
    expect(planSquirrelStartup(['nodeterm', '--squirrel-install'], 'darwin', '/Applications/nodeterm')).toBeNull()
    expect(planSquirrelStartup(['nodeterm', '--squirrel-uninstall'], 'linux', '/opt/nodeterm')).toBeNull()
  })
})

describe('handleSquirrelStartup', () => {
  it('spawns the planned shortcut command detached and quits when it closes', () => {
    const child = fakeChild()
    const quit = vi.fn()
    const spawn = vi.fn(() => child)
    const schedule = vi.fn()

    expect(
      handleSquirrelStartup({
        argv: ['nodeterm.exe', '--squirrel-install'],
        platform: 'win32',
        execPath: EXECUTABLE,
        quit,
        spawn,
        schedule
      })
    ).toBe(true)

    expect(spawn).toHaveBeenCalledWith(
      String.raw`C:\Users\me\AppData\Local\node-terminal\Update.exe`,
      ['--createShortcut', 'nodeterm.exe'],
      { detached: true, stdio: 'ignore' }
    )
    expect(child.unref).toHaveBeenCalledOnce()
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), SQUIRREL_STARTUP_QUIT_DEADLINE_MS)
    expect(quit).not.toHaveBeenCalled()

    child.listeners.get('close')?.()
    expect(quit).toHaveBeenCalledOnce()
  })

  it('uses one quit even if the child errors and the deadline later expires', () => {
    const child = fakeChild()
    const quit = vi.fn()
    let deadline: (() => void) | undefined

    handleSquirrelStartup({
      argv: ['nodeterm.exe', '--squirrel-updated'],
      platform: 'win32',
      execPath: EXECUTABLE,
      quit,
      spawn: () => child,
      schedule: (callback) => {
        deadline = callback
      }
    })

    child.listeners.get('error')?.()
    deadline?.()
    expect(quit).toHaveBeenCalledOnce()
  })

  it('still schedules a safe quit when spawning Update.exe throws', () => {
    const quit = vi.fn()
    let deadline: (() => void) | undefined

    expect(
      handleSquirrelStartup({
        argv: ['nodeterm.exe', '--squirrel-uninstall'],
        platform: 'win32',
        execPath: EXECUTABLE,
        quit,
        spawn: () => {
          throw new Error('Update.exe is missing')
        },
        schedule: (callback) => {
          deadline = callback
        }
      })
    ).toBe(true)

    expect(quit).not.toHaveBeenCalled()
    deadline?.()
    expect(quit).toHaveBeenCalledOnce()
  })

  it('quits obsolete versions immediately and never spawns or schedules', () => {
    const quit = vi.fn()
    const spawn = vi.fn()
    const schedule = vi.fn()
    expect(
      handleSquirrelStartup({
        argv: ['nodeterm.exe', '--squirrel-obsolete'],
        platform: 'win32',
        execPath: EXECUTABLE,
        quit,
        spawn,
        schedule
      })
    ).toBe(true)
    expect(quit).toHaveBeenCalledOnce()
    expect(spawn).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
  })

  it('returns false without side effects for normal application startup', () => {
    const quit = vi.fn()
    const spawn = vi.fn()
    const schedule = vi.fn()
    expect(
      handleSquirrelStartup({
        argv: ['nodeterm.exe'],
        platform: 'win32',
        execPath: EXECUTABLE,
        quit,
        spawn,
        schedule
      })
    ).toBe(false)
    expect(quit).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
  })
})

describe('initialAutomaticUpdateDelayMs', () => {
  it('delays only a Windows first-run automatic update check', () => {
    expect(initialAutomaticUpdateDelayMs(['nodeterm.exe', '--squirrel-firstrun'], 'win32')).toBe(
      SQUIRREL_FIRST_RUN_UPDATE_DELAY_MS
    )
    expect(initialAutomaticUpdateDelayMs(['nodeterm.exe'], 'win32')).toBe(0)
    expect(initialAutomaticUpdateDelayMs(['nodeterm', '--squirrel-firstrun'], 'darwin')).toBe(0)
  })

  it('requires the exact first-run flag', () => {
    expect(initialAutomaticUpdateDelayMs(['nodeterm.exe', '--squirrel-firstrun-extra'], 'win32')).toBe(0)
  })
})

describe('beginDesktopStartup', () => {
  it('does not load the application graph for a lifecycle process', () => {
    const child = fakeChild()
    const loadApplication = vi.fn()
    expect(
      beginDesktopStartup(
        {
          argv: ['nodeterm.exe', '--squirrel-updated'],
          platform: 'win32',
          execPath: EXECUTABLE,
          quit: vi.fn(),
          spawn: () => child,
          schedule: vi.fn()
        },
        loadApplication
      )
    ).toBe('squirrel-lifecycle')
    expect(loadApplication).not.toHaveBeenCalled()
  })

  it('loads the application graph exactly once during normal startup', () => {
    const loadApplication = vi.fn()
    expect(
      beginDesktopStartup(
        {
          argv: ['nodeterm.exe'],
          platform: 'win32',
          execPath: EXECUTABLE,
          quit: vi.fn(),
          spawn: vi.fn(),
          schedule: vi.fn()
        },
        loadApplication
      )
    ).toBe('application')
    expect(loadApplication).toHaveBeenCalledOnce()
  })
})
