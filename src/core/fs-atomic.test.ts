// The retry has to be proved against a rename that FAILS and then succeeds, not merely against a
// rename that works — the whole point is behaviour on a platform most of this suite never runs on.
// So the transient failure is injected rather than waited for.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs, writeFileSync, readFileSync, renameSync } from 'fs'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { removeAtomic, renameAtomic, renameAtomicSync, writeFileAtomic } from './fs-atomic'

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

describe('renameAtomicSync', () => {
  // The sync twin exists for paths that cannot be async — hook installers on the startup path, the
  // codex trust-hash write, the per-node token file. It is easy to add the async helper and leave
  // these behind, which is precisely what the first version of this work did: the guard knew only
  // `fs.rename(` and stayed green over eight `renameSync` and destructured-`rename` sites.
  //
  // The rename is injected because a spy cannot be attached to an ESM namespace export — see the
  // parameter's own comment in fs-atomic.ts.
  it('retries a sharing violation and succeeds', () => {
    const target = join(dir, 'store.json')
    const tmp = join(dir, 'store.json.tmp')
    writeFileSync(tmp, 'new')
    let calls = 0
    renameAtomicSync(tmp, target, (a, b) => {
      // Two scanners in a row, then the handle is released.
      if (++calls <= 2) throw errWithCode('EPERM')
      renameSync(a, b)
    })
    expect(calls).toBe(3)
    expect(readFileSync(target, 'utf-8')).toBe('new')
  })

  it.each(['EPERM', 'EACCES', 'EBUSY'])('treats %s as transient', (code) => {
    const target = join(dir, 'store.json')
    const tmp = join(dir, 'store.json.tmp')
    writeFileSync(tmp, 'new')
    let calls = 0
    renameAtomicSync(tmp, target, (a, b) => {
      if (++calls === 1) throw errWithCode(code)
      renameSync(a, b)
    })
    expect(calls).toBe(2)
  })

  it('does not retry an error waiting cannot fix', () => {
    let calls = 0
    expect(() =>
      renameAtomicSync(join(dir, 'a'), join(dir, 'b'), () => {
        calls++
        throw errWithCode('ENOENT')
      })
    ).toThrow(/ENOENT/)
    expect(calls).toBe(1)
  })

  it('gives up rather than blocking forever, and rethrows the REAL error', () => {
    // It blocks the thread while it waits, so an unbounded loop here would hang the app rather
    // than merely losing a save.
    let calls = 0
    let err: NodeJS.ErrnoException | undefined
    try {
      renameAtomicSync(join(dir, 'a'), join(dir, 'b'), () => {
        calls++
        throw errWithCode('EPERM')
      })
    } catch (e) {
      err = e as NodeJS.ErrnoException
    }
    expect(err?.code).toBe('EPERM')
    expect(calls, 'bounded: five attempts').toBe(5)
  })

  it('actually waits between attempts, rather than spinning through instantly', () => {
    // `Atomics.wait` is a real sleep. Swap it for a no-op and every retry fires in the same
    // millisecond, which defeats the point — the destination needs TIME to be released.
    const started = Date.now()
    try {
      renameAtomicSync(join(dir, 'a'), join(dir, 'b'), () => {
        throw errWithCode('EPERM')
      })
    } catch {
      /* expected */
    }
    // Four sleeps: 10 + 25 + 75 + 200. Asserting under the total to stay clear of timer slop.
    expect(Date.now() - started).toBeGreaterThanOrEqual(200)
  })

  it('uses the real renameSync when nothing is injected', () => {
    // The default parameter is the production path; without this the injected tests above would
    // all pass while the shipped function renamed nothing.
    const target = join(dir, 'real.json')
    const tmp = join(dir, 'real.json.tmp')
    writeFileSync(tmp, 'shipped')
    renameAtomicSync(tmp, target)
    expect(readFileSync(target, 'utf-8')).toBe('shipped')
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

describe('removeAtomic', () => {
  it('reports success when the file is genuinely gone', async () => {
    const f = join(dir, 'gone.json')
    writeFileSync(f, 'x')
    expect(await removeAtomic(f)).toBe(true)
  })

  it('treats ENOENT as success — the caller wanted it absent and it is', async () => {
    expect(await removeAtomic(join(dir, 'never-existed.json'))).toBe(true)
  })

  it('reports FAILURE when the file is still there', async () => {
    // The whole point. A delete whose purpose is to stop something happening — the relay
    // advertisement, so phones stop minting tokens against a host that is off — must not report
    // success while the file sits there. The old shape was an unlink in a bare catch commented
    // "already absent", which is true of ENOENT and false of every other code.
    vi.spyOn(fs, 'unlink').mockImplementation((async () => {
      throw errWithCode('EPERM')
    }) as typeof fs.unlink)
    expect(await removeAtomic(join(dir, 'held-open.json'))).toBe(false)
  })

  it('retries a transient lock before giving up', async () => {
    const f = join(dir, 'busy.json')
    writeFileSync(f, 'x')
    const real = fs.unlink
    let calls = 0
    vi.spyOn(fs, 'unlink').mockImplementation((async (p: never) => {
      if (++calls <= 2) throw errWithCode('EBUSY')
      return (real as (p: never) => Promise<void>)(p)
    }) as typeof fs.unlink)
    expect(await removeAtomic(f)).toBe(true)
    expect(calls).toBe(3)
  })

  it('does not spend the retry budget on an error waiting cannot fix', async () => {
    let calls = 0
    vi.spyOn(fs, 'unlink').mockImplementation((async () => {
      calls++
      throw errWithCode('EISDIR')
    }) as typeof fs.unlink)
    expect(await removeAtomic(join(dir, 'a-directory'))).toBe(false)
    expect(calls).toBe(1)
  })
})
