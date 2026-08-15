// The retry has to be proved against a rename that FAILS and then succeeds, not merely against a
// rename that works — the whole point is behaviour on a platform most of this suite never runs on.
// So the transient failure is injected rather than waited for.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { renameAtomic, writeFileAtomic } from './fs-atomic'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nt-atomic-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

function errWithCode(code: string): NodeJS.ErrnoException {
  const e: NodeJS.ErrnoException = new Error(`${code}: injected`)
  e.code = code
  return e
}

describe('renameAtomic survives a destination held open', () => {
  it('retries a Windows sharing violation and succeeds', async () => {
    const target = join(dir, 'store.json')
    const tmp = join(dir, 'store.json.tmp')
    await fs.writeFile(tmp, 'new')

    const real = fs.rename
    let calls = 0
    vi.spyOn(fs, 'rename').mockImplementation((async (a: never, b: never) => {
      // Two scanners in a row, then the handle is released. EPERM is what Windows actually
      // reports for a sharing violation on MoveFileEx.
      if (++calls <= 2) throw errWithCode('EPERM')
      return (real as (a: never, b: never) => Promise<void>)(a, b)
    }) as typeof fs.rename)

    await renameAtomic(tmp, target)
    expect(calls).toBe(3)
    expect(await readFile(target, 'utf-8')).toBe('new')
  })

  it.each(['EPERM', 'EACCES', 'EBUSY'])('treats %s as transient', async (code) => {
    const target = join(dir, 'store.json')
    const tmp = join(dir, 'store.json.tmp')
    await fs.writeFile(tmp, 'new')
    const real = fs.rename
    let calls = 0
    vi.spyOn(fs, 'rename').mockImplementation((async (a: never, b: never) => {
      if (++calls === 1) throw errWithCode(code)
      return (real as (a: never, b: never) => Promise<void>)(a, b)
    }) as typeof fs.rename)
    await renameAtomic(tmp, target)
    expect(calls).toBe(2)
  })

  it('does NOT retry an error that waiting cannot fix', async () => {
    // ENOENT means the temp is gone — a bug in the caller. Retrying delays a clearer error by a
    // third of a second and reports the same failure.
    let calls = 0
    vi.spyOn(fs, 'rename').mockImplementation((async () => {
      calls++
      throw errWithCode('ENOENT')
    }) as typeof fs.rename)
    await expect(renameAtomic(join(dir, 'a'), join(dir, 'b'))).rejects.toThrow(/ENOENT/)
    expect(calls).toBe(1)
  })

  it('gives up rather than hanging, and rethrows the REAL error', async () => {
    // A permanently locked file must fail: several callers report a failed save as not persisted,
    // and that contract is worth more than a save that eventually lands.
    let calls = 0
    vi.spyOn(fs, 'rename').mockImplementation((async () => {
      calls++
      throw errWithCode('EPERM')
    }) as typeof fs.rename)
    const err = await renameAtomic(join(dir, 'a'), join(dir, 'b')).catch((e) => e)
    expect(err.code, 'the original code must survive, not a wrapper').toBe('EPERM')
    expect(calls, 'bounded: five attempts, not an unbounded loop').toBe(5)
  })
})

describe('writeFileAtomic', () => {
  it('publishes the new bytes', async () => {
    const target = join(dir, 'store.json')
    await writeFileAtomic(target, '{"a":1}')
    expect(await readFile(target, 'utf-8')).toBe('{"a":1}')
  })

  it('leaves the OLD file byte-for-byte intact when the write fails', async () => {
    // The half every `persisted:false` contract depends on: a failed save must not also destroy
    // what was already there.
    const target = join(dir, 'store.json')
    await writeFileAtomic(target, 'original')
    vi.spyOn(fs, 'rename').mockImplementation((async () => {
      throw errWithCode('ENOSPC')
    }) as typeof fs.rename)
    await expect(writeFileAtomic(target, 'replacement')).rejects.toThrow(/ENOSPC/)
    expect(await readFile(target, 'utf-8')).toBe('original')
  })

  it('removes its own temp on failure', async () => {
    // A unique temp name never self-heals the way a fixed one did, where the next save reused it.
    const target = join(dir, 'store.json')
    vi.spyOn(fs, 'rename').mockImplementation((async () => {
      throw errWithCode('ENOSPC')
    }) as typeof fs.rename)
    await writeFileAtomic(target, 'x').catch(() => {})
    const left = (await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'))
    expect(left).toEqual([])
  })

  it('gives concurrent writers different temp files', async () => {
    // With one shared `<file>.tmp`, a writer's rename publishes the other's half-written bytes.
    const target = join(dir, 'store.json')
    const seen: string[] = []
    const real = fs.writeFile
    vi.spyOn(fs, 'writeFile').mockImplementation((async (p: never, ...rest: never[]) => {
      seen.push(String(p))
      return (real as (p: never, ...r: never[]) => Promise<void>)(p, ...rest)
    }) as typeof fs.writeFile)
    await Promise.all([writeFileAtomic(target, 'a'), writeFileAtomic(target, 'b')])
    expect(new Set(seen).size, `both writers used ${seen.join(' and ')}`).toBe(2)
  })

  it('the published result is one writer\'s bytes, never a splice of both', async () => {
    const target = join(dir, 'store.json')
    const a = JSON.stringify({ pubkeys: Array.from({ length: 64 }, (_, i) => `A${'a'.repeat(42)}${i}`) })
    const b = JSON.stringify({ pubkeys: ['B'] })
    await Promise.all([writeFileAtomic(target, a), writeFileAtomic(target, b)])
    const got = await readFile(target, 'utf-8')
    expect([a, b]).toContain(got)
  })
})
