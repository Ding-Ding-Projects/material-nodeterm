import { describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renameAtomic, renameAtomicSync } from './rename-atomic.mjs'

function codedError(code) {
  return Object.assign(new Error(code), { code })
}

describe('script atomic rename helpers', () => {
  it('publishes bytes through the default asynchronous rename implementation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nodeterm-script-rename-'))
    const temporary = join(directory, 'state.json.tmp')
    const target = join(directory, 'state.json')
    try {
      await writeFile(temporary, 'async publication', 'utf8')
      await renameAtomic(temporary, target)
      expect(await readFile(target, 'utf8')).toBe('async publication')
      await expect(readFile(temporary, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('publishes bytes through the default synchronous rename implementation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nodeterm-script-rename-sync-'))
    const temporary = join(directory, 'state.json.tmp')
    const target = join(directory, 'state.json')
    try {
      writeFileSync(temporary, 'sync publication', 'utf8')
      renameAtomicSync(temporary, target)
      expect(readFileSync(target, 'utf8')).toBe('sync publication')
      expect(existsSync(temporary)).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('retries transient asynchronous failures with the canonical bounded backoff', async () => {
    const failure = codedError('EPERM')
    const rename = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(codedError('EACCES'))
      .mockResolvedValue(undefined)
    const waits = []

    await renameAtomic('temporary', 'target', {
      rename,
      sleep: async (ms) => waits.push(ms)
    })

    expect(rename).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([10, 25])
  })

  it('never retries a permanent asynchronous failure or replaces its error', async () => {
    const failure = codedError('ENOENT')
    const rename = vi.fn().mockRejectedValue(failure)
    const sleep = vi.fn()

    await expect(renameAtomic('temporary', 'target', { rename, sleep })).rejects.toBe(failure)
    expect(rename).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('stops synchronous retries after the bounded budget and throws the final error', () => {
    const failures = Array.from({ length: 5 }, (_, index) => codedError(index % 2 ? 'EBUSY' : 'EPERM'))
    const rename = vi.fn(() => {
      throw failures.shift()
    })
    const waits = []

    expect(() => renameAtomicSync('temporary', 'target', {
      rename,
      sleep: (ms) => waits.push(ms)
    })).toThrow('EPERM')
    expect(rename).toHaveBeenCalledTimes(5)
    expect(waits).toEqual([10, 25, 75, 200])
  })

  it('never retries a permanent synchronous failure', () => {
    const failure = codedError('ENOSPC')
    const rename = vi.fn(() => {
      throw failure
    })
    const sleep = vi.fn()

    expect(() => renameAtomicSync('temporary', 'target', { rename, sleep })).toThrow(failure)
    expect(rename).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })
})
