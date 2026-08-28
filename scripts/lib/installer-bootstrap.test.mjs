import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  extractInstallerArchive,
  removeOwnedInstallerWithRetry,
  resolveBundledSevenZip,
  spawnInstallerWithRetry,
} from './installer-bootstrap.mjs'

function codedError(code) {
  return Object.assign(new Error(code), { code })
}

function childFor(events) {
  const child = new EventEmitter()
  queueMicrotask(() => {
    for (const [event, ...args] of events) child.emit(event, ...args)
  })
  return child
}

describe('installer bootstrap retry helpers', () => {
  it('waits through transient pre-start scanner locks and then starts exactly once', async () => {
    const spawn = vi.fn()
      .mockImplementationOnce(() => childFor([['error', codedError('EACCES')]]))
      .mockImplementationOnce(() => childFor([['error', codedError('EPERM')]]))
      .mockImplementationOnce(() => childFor([['spawn'], ['close', 0, null]]))
    const waits = []

    await expect(spawnInstallerWithRetry('installer.exe', ['/S'], {
      spawn,
      sleep: async (ms) => { waits.push(ms) },
      retryDelaysMs: [11, 22, 33],
    })).resolves.toMatchObject({ kind: 'exit', started: true, code: 0 })

    expect(spawn).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([11, 22])
  })

  it('retries EBUSY and synchronous transient spawn errors under the same finite budget', async () => {
    const spawn = vi.fn()
      .mockImplementationOnce(() => { throw codedError('EBUSY') })
      .mockImplementationOnce(() => childFor([['error', codedError('EACCES')]]))
      .mockImplementationOnce(() => childFor([['spawn'], ['close', 0, null]]))
    const waits = []

    await spawnInstallerWithRetry('installer.exe', ['/S'], {
      spawn,
      sleep: async (ms) => { waits.push(ms) },
      retryDelaysMs: [7, 13],
    })

    expect(spawn).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([7, 13])
  })

  it('preserves the final transient error after the bounded retry budget is exhausted', async () => {
    const finalError = codedError('EACCES')
    const spawn = vi.fn()
      .mockImplementationOnce(() => childFor([['error', codedError('EPERM')]]))
      .mockImplementationOnce(() => childFor([['error', finalError]]))
    const waits = []

    await expect(spawnInstallerWithRetry('installer.exe', ['/S'], {
      spawn,
      sleep: async (ms) => { waits.push(ms) },
      retryDelaysMs: [25],
    })).rejects.toBe(finalError)

    expect(spawn).toHaveBeenCalledTimes(2)
    expect(waits).toEqual([25])
  })

  it('never retries permanent failures or failures after a child has started', async () => {
    const permanent = codedError('ENOENT')
    const permanentSpawn = vi.fn(() => childFor([['error', permanent]]))
    const permanentSleep = vi.fn()
    await expect(spawnInstallerWithRetry('installer.exe', ['/S'], {
      spawn: permanentSpawn,
      sleep: permanentSleep,
    })).rejects.toBe(permanent)
    expect(permanentSpawn).toHaveBeenCalledOnce()
    expect(permanentSleep).not.toHaveBeenCalled()

    const childFailure = codedError('EACCES')
    const startedSpawn = vi.fn(() => childFor([['spawn'], ['error', childFailure], ['close', null, null]]))
    const startedSleep = vi.fn()
    await expect(spawnInstallerWithRetry('installer.exe', ['/S'], {
      spawn: startedSpawn,
      sleep: startedSleep,
    })).rejects.toBe(childFailure)
    expect(startedSpawn).toHaveBeenCalledOnce()
    expect(startedSleep).not.toHaveBeenCalled()
  })

  it('retries cleanup only for transient file locks and preserves permanent cleanup errors', async () => {
    const rm = vi.fn()
      .mockRejectedValueOnce(codedError('EACCES'))
      .mockRejectedValueOnce(codedError('EBUSY'))
      .mockResolvedValue(undefined)
    const waits = []

    await removeOwnedInstallerWithRetry('owned.exe', {
      rm,
      sleep: async (ms) => { waits.push(ms) },
      retryDelaysMs: [3, 5],
    })
    expect(rm).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([3, 5])

    const permanent = codedError('ENOENT')
    const permanentRm = vi.fn().mockRejectedValue(permanent)
    await expect(removeOwnedInstallerWithRetry('owned.exe', { rm: permanentRm })).rejects.toBe(permanent)
    expect(permanentRm).toHaveBeenCalledOnce()
  })

  it('uses only the bundled 7-Zip path and fixed extraction argv for a verified installer archive', async () => {
    const root = 'C:\\workspace'
    const expected = 'C:\\workspace\\node_modules\\electron-winstaller\\vendor\\7z.exe'
    const spawn = vi.fn(() => childFor([['spawn'], ['close', 0, null]]))

    await expect(extractInstallerArchive(root, 'verified-installer.exe', 'output-dir', {
      exists: (candidate) => candidate === expected,
      spawn,
    })).resolves.toMatchObject({ kind: 'exit', code: 0 })

    expect(spawn).toHaveBeenCalledWith(expected, ['x', '-y', '-ooutput-dir', 'verified-installer.exe'], expect.any(Object))
  })

  it('refuses extraction when the declared bundled 7-Zip executable is absent', () => {
    expect(() => resolveBundledSevenZip('C:\\workspace', { exists: () => false })).toThrow(/bundled 7-Zip extractor is missing/i)
  })
})
