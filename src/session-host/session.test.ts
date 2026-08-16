import { describe, expect, it, vi } from 'vitest'
import type { Socket } from 'net'
import type { IPty } from 'node-pty'
import { HostSession } from './session'
import type { TerminalEmulator } from './terminal-emulator'
import type { SessionHostSpawnOptions } from './protocol'

const SPAWN: SessionHostSpawnOptions = {
  shell: 'unused-in-tests',
  args: [],
  cwd: '.',
  env: {},
  cols: 80,
  rows: 24
}

function fakeProc(): {
  value: IPty
  pause: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
} {
  const pause = vi.fn()
  const resume = vi.fn()
  return {
    value: {
      pid: 42,
      pause,
      resume
    } as unknown as IPty,
    pause,
    resume
  }
}

describe('HostSession terminal-output ordering', () => {
  it('waits for every prior asynchronous xterm write before serializing', async () => {
    const proc = fakeProc()
    const applied: string[] = []
    const releases: Array<() => void> = []
    const serialize = vi.fn(() => applied.join(''))
    const write = vi.fn(
      (data: string) =>
        new Promise<void>((resolve) => {
          releases.push(() => {
            applied.push(data)
            resolve()
          })
        })
    )
    const term = {
      write,
      serialize,
      resize: vi.fn(),
      dispose: vi.fn()
    } as unknown as TerminalEmulator
    const session = new HostSession('ordered', SPAWN, 100, { proc: proc.value, term })

    const first = session.recordOutput('first')
    const second = session.recordOutput('second')
    const snapshot = session.serialize()

    await Promise.resolve()
    expect(write).toHaveBeenCalledTimes(1)
    expect(serialize).not.toHaveBeenCalled()

    releases[0]()
    await first
    await Promise.resolve()
    expect(write).toHaveBeenCalledTimes(2)
    expect(serialize).not.toHaveBeenCalled()

    releases[1]()
    await second
    await expect(snapshot).resolves.toBe('firstsecond')
    expect(serialize).toHaveBeenCalledTimes(1)
  })

  it('recovers the ordering tail after one mirror write rejects', async () => {
    const proc = fakeProc()
    const applied: string[] = []
    const term = {
      write: vi.fn(async (data: string) => {
        if (data === 'bad') throw new Error('synthetic mirror rejection')
        applied.push(data)
      }),
      serialize: vi.fn(() => applied.join('')),
      resize: vi.fn(),
      dispose: vi.fn()
    } as unknown as TerminalEmulator
    const session = new HostSession('recover', SPAWN, 100, { proc: proc.value, term })

    await expect(session.recordOutput('bad')).rejects.toThrow('synthetic mirror rejection')
    await expect(session.recordOutput('good')).resolves.toBeUndefined()
    await expect(session.serialize()).resolves.toBe('good')
  })
})

describe('HostSession connection-scoped pause ownership', () => {
  it('resumes only after the last pausing connection returns its ticket', () => {
    const proc = fakeProc()
    const term = {
      write: vi.fn(async () => {}),
      serialize: vi.fn(() => ''),
      resize: vi.fn(),
      dispose: vi.fn()
    } as unknown as TerminalEmulator
    const session = new HostSession('flow', SPAWN, 100, { proc: proc.value, term })
    const a = {} as Socket
    const b = {} as Socket
    const stranger = {} as Socket

    session.pauseFor(a)
    session.pauseFor(a) // a re-asserted high-water pause is idempotent
    session.pauseFor(b)
    expect(proc.pause).toHaveBeenCalledTimes(1)

    session.resumeFor(stranger) // a socket cannot release another socket's pause
    session.resumeFor(a)
    expect(proc.resume).not.toHaveBeenCalled()

    session.resumeFor(b)
    expect(proc.resume).toHaveBeenCalledTimes(1)
    session.resumeFor(b)
    expect(proc.resume).toHaveBeenCalledTimes(1)
  })

  it('returns a crashed connection\'s pause ticket during detach without disturbing peers', () => {
    const proc = fakeProc()
    const term = {
      write: vi.fn(async () => {}),
      serialize: vi.fn(() => ''),
      resize: vi.fn(),
      dispose: vi.fn()
    } as unknown as TerminalEmulator
    const session = new HostSession('disconnect', SPAWN, 100, { proc: proc.value, term })
    const crashed = {} as Socket
    const healthy = {} as Socket
    session.subscribers.add(crashed)
    session.subscribers.add(healthy)

    session.pauseFor(crashed)
    session.pauseFor(healthy)
    session.detach(crashed)
    expect(session.subscribers.has(crashed)).toBe(false)
    expect(session.subscribers.has(healthy)).toBe(true)
    expect(proc.resume).not.toHaveBeenCalled()

    session.detach(healthy)
    expect(proc.resume).toHaveBeenCalledTimes(1)
  })
})
