import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  promises as fs,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import os from 'os'
import path from 'path'

import { initPlatform, resetPlatformForTests } from './platform'
import { fakePlatform } from './platform-fake'
import {
  getHomeAssistantToken,
  homeAssistantTokenStatus,
  pruneOrphanedTokens,
  setHomeAssistantToken
} from './scheduled-settings-secrets'

const RULE_ID = '11111111-1111-4111-8111-111111111111'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function observedWithin(promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('filesystem barrier was not reached')), 2_000)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Make every filesystem step except renameAtomic's deliberate retry complete in a deterministic
 * microtask. The first parked rename releases with EPERM; an unqueued later mutation therefore
 * finishes before the 10 ms retry, independent of host filesystem timing.
 */
function installImmediateFileOps(): void {
  vi.spyOn(fs, 'mkdir').mockImplementation((async (p: any, opts: any) => {
    mkdirSync(p, opts)
  }) as any)
  vi.spyOn(fs, 'writeFile').mockImplementation((async (p: any, data: any, opts: any) => {
    writeFileSync(p, data, opts)
  }) as any)
  vi.spyOn(fs, 'rm').mockImplementation((async (p: any, opts: any) => {
    rmSync(p, opts)
  }) as any)
  vi.spyOn(fs, 'unlink').mockImplementation((async (p: any) => {
    unlinkSync(p)
  }) as any)
  vi.spyOn(fs, 'readdir').mockImplementation((async (p: any) => readdirSync(p)) as any)
  vi.spyOn(fs, 'lstat').mockImplementation((async (p: any) => lstatSync(p)) as any)
}

function parkFirstPublish(target: string): {
  observed: Promise<void>
  release: () => void
} {
  const observed = deferred()
  const released = deferred()
  let first = true
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (first && String(to) === target) {
      first = false
      observed.resolve()
      await released.promise
      const error = new Error('injected sharing violation') as NodeJS.ErrnoException
      error.code = 'EPERM'
      throw error
    }
    renameSync(String(from), String(to))
  })
  return { observed: observed.promise, release: released.resolve }
}

describe('scheduled-settings credential clear', () => {
  let dir: string
  let rawFile: string
  let sealedFile: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-scheduled-secret-'))
    resetPlatformForTests()
    initPlatform(fakePlatform({ userDataDir: dir }))
    rawFile = path.join(dir, 'scheduled-settings-secrets', `${RULE_ID}.bin`)
    sealedFile = path.join(dir, 'scheduled-settings-secrets', `${RULE_ID}.json`)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    resetPlatformForTests()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('removes the canonical token but reports a retained credential temp as incomplete', async () => {
    await setHomeAssistantToken(RULE_ID, 'canonical-secret')
    const crashTemp = `${rawFile}.${process.pid + 1}.7.22222222-2222-4222-8222-222222222222.tmp`
    await fs.writeFile(crashTemp, 'credential-copy', { mode: 0o600 })

    await expect(setHomeAssistantToken(RULE_ID, null)).rejects.toMatchObject({
      code: 'clear-incomplete'
    })

    expect(existsSync(rawFile)).toBe(false)
    expect(await fs.readFile(crashTemp, 'utf8')).toBe('credential-copy')
  })

  it('reports a canonical deletion failure without claiming the token was cleared', async () => {
    await setHomeAssistantToken(RULE_ID, 'canonical-secret')
    const realUnlink = fs.unlink
    vi.spyOn(fs, 'unlink').mockImplementation(async (file) => {
      if (String(file) === rawFile) {
        const error = new Error('injected deletion failure') as NodeJS.ErrnoException
        error.code = 'EIO'
        throw error
      }
      return realUnlink(file)
    })

    await expect(setHomeAssistantToken(RULE_ID, null)).rejects.toMatchObject({
      code: 'clear-incomplete',
      message: expect.stringContaining('could not be fully cleared')
    })
    expect(await fs.readFile(rawFile, 'utf8')).toBe('canonical-secret')
  })

  it('reports an alternate-format cleanup failure after publishing the replacement', async () => {
    await fs.mkdir(path.dirname(sealedFile), { recursive: true })
    await fs.writeFile(sealedFile, 'old alternate credential', { mode: 0o600 })
    const realUnlink = fs.unlink
    vi.spyOn(fs, 'unlink').mockImplementation(async (file) => {
      if (String(file) === sealedFile) {
        const error = new Error('injected alternate deletion failure') as NodeJS.ErrnoException
        error.code = 'EIO'
        throw error
      }
      return realUnlink(file)
    })

    await expect(setHomeAssistantToken(RULE_ID, 'new raw credential')).rejects.toMatchObject({
      code: 'clear-incomplete',
      message: expect.stringContaining('could not be fully cleared')
    })
    expect(await fs.readFile(rawFile, 'utf8')).toBe('new raw credential')
    expect(await fs.readFile(sealedFile, 'utf8')).toBe('old alternate credential')
  })

  it('does not mistake a corrupt token document for an absent credential', async () => {
    await fs.mkdir(path.dirname(rawFile), { recursive: true })
    await fs.writeFile(rawFile, '   ', { mode: 0o600 })

    await expect(getHomeAssistantToken(RULE_ID)).rejects.toThrow(/malformed/)
    await expect(homeAssistantTokenStatus([RULE_ID])).rejects.toThrow(/malformed/)
  })

  it('rejects a token that its strict read path would treat as malformed', async () => {
    await expect(setHomeAssistantToken(RULE_ID, '')).rejects.toMatchObject({ code: 'invalid-token' })
    await expect(setHomeAssistantToken(RULE_ID, ' padded ')).rejects.toMatchObject({
      code: 'invalid-token'
    })
    await expect(setHomeAssistantToken(RULE_ID, 'line\nbreak')).rejects.toMatchObject({
      code: 'invalid-token'
    })
    expect(existsSync(rawFile)).toBe(false)
  })

  it('does not report absence when an existing token cannot be read', async () => {
    await setHomeAssistantToken(RULE_ID, 'secret')
    const realReadFile = fs.readFile
    vi.spyOn(fs, 'readFile').mockImplementation((async (file: any, ...args: any[]) => {
      if (String(file) === rawFile) {
        throw Object.assign(new Error('EACCES: credential is unreadable'), { code: 'EACCES' })
      }
      return (realReadFile as any)(file, ...args)
    }) as typeof fs.readFile)

    await expect(getHomeAssistantToken(RULE_ID)).rejects.toMatchObject({ code: 'EACCES' })
    await expect(homeAssistantTokenStatus([RULE_ID])).rejects.toMatchObject({ code: 'EACCES' })
  })

  it('reports unknown instead of absent when only the alternate storage format exists', async () => {
    await fs.mkdir(path.dirname(rawFile), { recursive: true })
    await fs.writeFile(rawFile, 'raw bearer from a headless host', { mode: 0o600 })
    resetPlatformForTests()
    initPlatform(
      fakePlatform({
        userDataDir: dir,
        sealSecret: (value) => value,
        unsealSecret: (value) => value
      })
    )

    await expect(getHomeAssistantToken(RULE_ID)).rejects.toThrow(/unavailable format/)
    await expect(homeAssistantTokenStatus([RULE_ID])).rejects.toThrow(/unavailable format/)
  })

  it('publishes two sets in invocation order when the older rename stalls', async () => {
    installImmediateFileOps()
    const gate = parkFirstPublish(rawFile)
    const operations: Promise<unknown>[] = [setHomeAssistantToken(RULE_ID, 'older')]
    try {
      await observedWithin(gate.observed)
      operations.push(setHomeAssistantToken(RULE_ID, 'newer'))
      gate.release()
      const settled = await Promise.allSettled(operations)
      expect(settled.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
      await expect(getHomeAssistantToken(RULE_ID)).resolves.toBe('newer')
    } finally {
      gate.release()
      await Promise.allSettled(operations)
    }
  })

  it('does not let an in-flight set resurrect a token after clear', async () => {
    installImmediateFileOps()
    const gate = parkFirstPublish(rawFile)
    const operations: Promise<unknown>[] = [setHomeAssistantToken(RULE_ID, 'secret')]
    try {
      await observedWithin(gate.observed)
      operations.push(setHomeAssistantToken(RULE_ID, null))
      gate.release()
      const settled = await Promise.allSettled(operations)
      expect(settled.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
      await expect(getHomeAssistantToken(RULE_ID)).resolves.toBeNull()
      expect(existsSync(rawFile)).toBe(false)
    } finally {
      gate.release()
      await Promise.allSettled(operations)
    }
  })

  it('rejects lossy filename aliases and never reads their old shared residue', async () => {
    const aliasFile = path.join(dir, 'scheduled-settings-secrets', 'a_b.bin')
    await fs.mkdir(path.dirname(aliasFile), { recursive: true })
    await fs.writeFile(aliasFile, 'legacy shared credential', { mode: 0o600 })

    await expect(setHomeAssistantToken('a/b', 'slash credential')).rejects.toMatchObject({
      code: 'invalid-rule-id'
    })
    await expect(setHomeAssistantToken('a_b', 'underscore credential')).rejects.toMatchObject({
      code: 'invalid-rule-id'
    })
    await expect(getHomeAssistantToken('a/b')).resolves.toBeNull()
    await expect(getHomeAssistantToken('a_b')).resolves.toBeNull()
    expect(await fs.readFile(aliasFile, 'utf8')).toBe('legacy shared credential')

    await pruneOrphanedTokens(['a/b', 'a_b'])
    expect(existsSync(aliasFile)).toBe(false)
  })

  it('queues prune behind an in-flight set so deletion cannot be resurrected', async () => {
    installImmediateFileOps()
    const gate = parkFirstPublish(rawFile)
    const operations: Promise<unknown>[] = [setHomeAssistantToken(RULE_ID, 'orphan')]
    try {
      await observedWithin(gate.observed)
      operations.push(pruneOrphanedTokens([]))
      gate.release()
      const settled = await Promise.allSettled(operations)
      expect(settled.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
      await expect(getHomeAssistantToken(RULE_ID)).resolves.toBeNull()
      expect(existsSync(rawFile)).toBe(false)
    } finally {
      gate.release()
      await Promise.allSettled(operations)
    }
  })

  it('reports a temp-only orphan instead of losing the last credential cleanup affordance', async () => {
    const orphanTemp = `${rawFile}.9191.4.33333333-3333-4333-8333-333333333333.tmp`
    await fs.mkdir(path.dirname(orphanTemp), { recursive: true })
    await fs.writeFile(orphanTemp, 'orphaned bearer', { mode: 0o600 })

    await expect(pruneOrphanedTokens([])).rejects.toMatchObject({
      code: 'clear-incomplete',
      message: expect.stringContaining('could not be fully cleared')
    })
    expect(await fs.readFile(orphanTemp, 'utf8')).toBe('orphaned bearer')
  })

  it('does not let a failed mutation poison the queue tail', async () => {
    installImmediateFileOps()
    let fail = true
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (fail) {
        fail = false
        const error = new Error('injected publication failure') as NodeJS.ErrnoException
        error.code = 'EXDEV'
        throw error
      }
      renameSync(String(from), String(to))
    })

    await expect(setHomeAssistantToken(RULE_ID, 'fails')).rejects.toMatchObject({ code: 'EXDEV' })
    await expect(setHomeAssistantToken(RULE_ID, 'recovers')).resolves.toBeUndefined()
    await expect(getHomeAssistantToken(RULE_ID)).resolves.toBe('recovers')
  })
})
