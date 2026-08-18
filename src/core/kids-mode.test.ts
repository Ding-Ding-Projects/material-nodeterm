// Kids mode's store, and — the assertions that matter most — that it is genuinely INDEPENDENT of
// School mode. The two share a credential mechanism and a shared directory, which is exactly the
// arrangement in which one could quietly start unlocking the other.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

const handlers = new Map<string, unknown>()

vi.mock('./platform', () => ({
  platform: () => ({
    handle: (c: string, fn: unknown) => handlers.set(c, fn),
    broadcast: () => {},
    userDataDir: () => os.tmpdir(),
    sealSecret: (b: Buffer) => Buffer.from(`sealed:${b.toString('utf8')}`, 'utf8'),
    unsealSecret: (b: Buffer) => {
      const s = b.toString('utf8')
      if (!s.startsWith('sealed:')) throw new Error('not sealed by us')
      return Buffer.from(s.slice('sealed:'.length), 'utf8')
    }
  })
}))

const { KidsModeStore, DEFAULT_KIDS_MODE_NAME, sharedDir } = await import('./kids-mode')
const { SchoolModeStore } = await import('./school-mode')
const { readAtomicFileSnapshot, withCrossProcessLock, writeAtomicFileCompared } = await import('./fs-transaction-lock')
type SharedRecordWatch = import('./shared-record-watch').SharedRecordWatch
type SharedRecordWatchToken = import('./shared-record-watch').SharedRecordWatchToken

let home: string
let homeSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  handlers.clear()
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-kids-'))
  homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(home)
})
afterEach(async () => {
  homeSpy.mockRestore()
  await fs.rm(home, { recursive: true, force: true })
})

async function fresh(deps: ConstructorParameters<typeof KidsModeStore>[0] = {}) {
  const s = new KidsModeStore(deps)
  await s.init()
  return s
}

async function waitUntil(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for the shared record watcher')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** A deliberately silent but acknowledged watcher: useful for proving writes never rely on cache
 * freshness or eventual fs.watch delivery. */
function silentWatcherFactory(
  _file: string,
  _onSync: (token: SharedRecordWatchToken) => void,
  onHealth: (healthy: boolean) => void
): SharedRecordWatch {
  const token = { handleGeneration: 1, syncEpoch: 1 }
  let disposed = false
  return {
    start: () => token,
    recordWritten: () => {},
    isCurrent: (candidate) => !disposed && candidate.handleGeneration === 1 && candidate.syncEpoch === 1,
    acknowledge: (candidate) => {
      const current = !disposed && candidate.handleGeneration === 1 && candidate.syncEpoch === 1
      if (current) onHealth(true)
      return current
    },
    dispose: () => {
      disposed = true
      onHealth(false)
    }
  }
}

describe('the lock', () => {
  it('needs no PIN to enter and always one to leave', async () => {
    const s = await fresh()
    await s.enable('1234')
    expect(s.isOn()).toBe(true)

    expect((await s.disable('9999')).ok).toBe(false)
    expect(s.isOn(), 'a wrong PIN must not let a child out').toBe(true)

    expect((await s.disable('1234')).ok).toBe(true)
    expect(s.isOn()).toBe(false)
    s.dispose()
  })

  it('requires a PIN the first time it is ever turned on', async () => {
    const s = await fresh()
    await expect(s.enable()).rejects.toThrow(/PIN/i)
    expect(s.isOn(), 'a rejected enable must not half-apply').toBe(false)
    s.dispose()
  })

  it('survives a restart', async () => {
    const a = await fresh()
    await a.enable('1234')
    a.dispose()
    const b = await fresh()
    expect(b.isOn()).toBe(true)
    b.dispose()
  })

  it('stores no plaintext PIN anywhere in the shared directory', async () => {
    const s = await fresh()
    await s.enable('open-sesame')
    s.dispose()
    for (const f of await fs.readdir(sharedDir())) {
      const body = await fs.readFile(path.join(sharedDir(), f), 'utf8')
      expect(body, `${f}`).not.toContain('open-sesame')
    }
  })

  it('displays OFF but reports unavailable on a corrupt record', async () => {
    // Display and authorization are deliberately different facts. The UI may render the safe
    // default, but destructive callers must not spend corrupt bytes as proof that Kids mode is OFF.
    await fs.mkdir(sharedDir(), { recursive: true })
    await fs.writeFile(path.join(sharedDir(), 'kids-mode.json'), 'not json')
    const s = await fresh()
    expect(s.isOn()).toBe(false)
    expect(s.snapshot().authoritative).toBe(false)
    s.dispose()
  })

  it('does not flip the authoritative cache when a durable disable write fails', async () => {
    const writeCompared = vi.fn(async (...args: Parameters<typeof writeAtomicFileCompared>) => {
      const [, data] = args
      if ((JSON.parse(data.toString()) as { enabled: boolean }).enabled === false) {
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      }
      await writeAtomicFileCompared(...args)
    })
    const s = await fresh({ writeCompared })
    await s.enable('1234')
    // A successful write is display-only until the strict re-read `recordWritten()` schedules
    // has actually landed (another process could theoretically have won a write in the interval
    // after our lock released) — the same eventual-consistency contract the sibling "returns
    // unavailable and rereads..." test above waits out. Settle here before asserting so this
    // test observes the record's steady state, not the transient dip every write passes through.
    await waitUntil(() => s.snapshot().authoritative)
    expect(s.snapshot()).toMatchObject({ enabled: true, authoritative: true })

    await expect(s.disable('1234')).rejects.toThrow(/disk full/i)
    expect(s.snapshot()).toMatchObject({ enabled: true, authoritative: true })
    expect(JSON.parse(await fs.readFile(path.join(sharedDir(), 'kids-mode.json'), 'utf8'))).toMatchObject({
      enabled: true
    })
    s.dispose()
  })
})

describe('independence from School mode', () => {
  it('writes a DIFFERENT record file, so one mode cannot switch the other on', async () => {
    // Assert on the FILES, not the in-memory caches. Two stores keep separate caches even when
    // they share a file, so a cache-only check passes on a shared record and only fails later
    // when a watcher reload happens to land — verified: pointing kids at school-mode.json left
    // the cache-based version of this test green.
    const kids = await fresh()
    const school = new SchoolModeStore()
    await school.init()

    await kids.enable('1111')
    await school.rename('Exam mode')

    const files = await fs.readdir(sharedDir())
    expect(files, 'kids needs its own record').toContain('kids-mode.json')
    expect(files, 'school needs its own record').toContain('school-mode.json')

    const kidsRec = JSON.parse(await fs.readFile(path.join(sharedDir(), 'kids-mode.json'), 'utf8'))
    const schoolRec = JSON.parse(await fs.readFile(path.join(sharedDir(), 'school-mode.json'), 'utf8'))
    expect(kidsRec.enabled, 'kids is the one that was enabled').toBe(true)
    expect(schoolRec.enabled, 'school must be untouched by enabling kids').toBe(false)
    expect(schoolRec.name).toBe('Exam mode')
    expect(kidsRec.name, "kids must not inherit school's name").not.toBe('Exam mode')

    kids.dispose()
    school.dispose()
  })

  it("does NOT accept School mode's PIN — the credentials are separate", async () => {
    // The failure this guards: a child leaving kids mode with a PIN an adult set for an exam.
    const kids = await fresh()
    const school = new SchoolModeStore()
    await school.init()

    await school.enable('school-pin')
    await kids.enable('kids-pin')

    expect((await kids.disable('school-pin')).ok, "school's PIN must not open kids mode").toBe(false)
    expect(kids.isOn()).toBe(true)
    expect((await school.disable('kids-pin')).ok, "kids' PIN must not open school mode").toBe(false)

    // Each still opens with its own.
    expect((await kids.disable('kids-pin')).ok).toBe(true)
    expect((await school.disable('school-pin')).ok).toBe(true)

    kids.dispose()
    school.dispose()
  })

  it('writes its own credential file rather than sharing one', async () => {
    const kids = await fresh()
    const school = new SchoolModeStore()
    await school.init()
    await kids.enable('1111')
    await school.enable('2222')
    const files = await fs.readdir(sharedDir())
    expect(files).toContain('kids-mode.credential.json')
    expect(files).toContain('school-mode.credential.json')
    kids.dispose()
    school.dispose()
  })

  it('both can be on at once — the restrictions compose rather than conflict', async () => {
    const kids = await fresh()
    const school = new SchoolModeStore()
    await school.init()
    await kids.enable('1111')
    await school.enable('2222')
    expect(kids.isOn()).toBe(true)
    expect(school.get().enabled).toBe(true)
    kids.dispose()
    school.dispose()
  })
})

describe('the name', () => {
  it('defaults to the shipped name and falls back to it on whitespace', async () => {
    const s = await fresh()
    expect(s.get().name).toBe(DEFAULT_KIDS_MODE_NAME)
    await s.rename('   ')
    expect(s.get().name).toBe(DEFAULT_KIDS_MODE_NAME)
    s.dispose()
  })

  it('renames without a PIN and without disturbing the lock', async () => {
    const s = await fresh()
    await s.enable('1234')
    await s.rename("Ellie's mode")
    expect(s.get().name).toBe("Ellie's mode")
    expect(s.isOn()).toBe(true)
    s.dispose()
  })
})

describe('concurrency', () => {
  it('keeps the exact last invocation when persistence is stalled', async () => {
    let releaseFirst!: () => void
    let announceFirst!: () => void
    const firstReleased = new Promise<void>((resolve) => (releaseFirst = resolve))
    const firstStarted = new Promise<void>((resolve) => (announceFirst = resolve))
    const invocationNames: string[] = []
    const writeCompared = vi.fn(async (...args: Parameters<typeof writeAtomicFileCompared>) => {
      const [file, data] = args
      const name = (JSON.parse(data.toString()) as { name: string }).name
      invocationNames.push(name)
      if (invocationNames.length === 1) {
        announceFirst()
        await firstReleased
      }
      await writeAtomicFileCompared(...args)
    })
    const s = await fresh({ writeCompared })

    const first = s.rename('one')
    await firstStarted
    const second = s.rename('two')
    const third = s.rename('three')
    await Promise.resolve()

    expect(writeCompared).toHaveBeenCalledTimes(1)
    expect(invocationNames).toEqual(['one'])

    releaseFirst()
    await Promise.all([first, second, third])

    expect(invocationNames).toEqual(['one', 'two', 'three'])
    expect(writeCompared).toHaveBeenCalledTimes(3)
    const onDisk = JSON.parse(await fs.readFile(path.join(sharedDir(), 'kids-mode.json'), 'utf8'))
    expect(onDisk).toEqual({ version: 1, enabled: false, name: 'three' })
    expect(s.get()).toEqual(onDisk)
    s.dispose()
  })

  it('re-reads inside the transaction so a stale rename preserves another store\'s ON', async () => {
    const stale = await fresh({ createWatcher: silentWatcherFactory })
    const writer = await fresh({ createWatcher: silentWatcherFactory })

    expect(stale.get()).toMatchObject({ enabled: false, name: DEFAULT_KIDS_MODE_NAME })
    await writer.enable('1234')
    // The silent watcher proves `stale` still holds OFF when rename begins.
    expect(stale.get().enabled).toBe(false)
    await stale.rename('Renamed from stale cache')

    const canonical = JSON.parse(
      await fs.readFile(path.join(sharedDir(), 'kids-mode.json'), 'utf8')
    )
    expect(canonical).toEqual({
      version: 1,
      enabled: true,
      name: 'Renamed from stale cache'
    })
    stale.dispose()
    writer.dispose()
  })

  it('rejects a manual write between strict read and compared publication', async () => {
    let interfered = false
    const writeCompared = vi.fn(async (...args: Parameters<typeof writeAtomicFileCompared>) => {
      const [file] = args
      if (!interfered) {
        interfered = true
        await fs.writeFile(
          file,
          JSON.stringify({ version: 1, enabled: true, name: 'External ON' }),
          'utf8'
        )
      }
      await writeAtomicFileCompared(...args)
    })
    const s = await fresh({ createWatcher: silentWatcherFactory, writeCompared })

    await expect(s.rename('Must not land')).rejects.toMatchObject({
      code: 'atomic-revision-conflict'
    })
    expect(JSON.parse(await fs.readFile(path.join(sharedDir(), 'kids-mode.json'), 'utf8'))).toEqual({
      version: 1,
      enabled: true,
      name: 'External ON'
    })
    expect(s.get()).toMatchObject({ enabled: false, name: DEFAULT_KIDS_MODE_NAME })
    s.dispose()
  })

  it('returns unavailable and rereads when another process writes after its lease is released', async () => {
    const writer = await fresh({ createWatcher: silentWatcherFactory })
    let interposed = false
    const withLock: typeof withCrossProcessLock = async (file, action, options) => {
      const result = await withCrossProcessLock(file, action, options)
      if (!interposed) {
        interposed = true
        await writer.enable('1234')
      }
      return result
    }
    const stale = await fresh({ withLock })

    const response = await stale.rename('Written before external ON')
    expect(response).toMatchObject({
      enabled: false,
      authoritative: false
    })
    expect(JSON.parse(await fs.readFile(path.join(sharedDir(), 'kids-mode.json'), 'utf8'))).toMatchObject({
      enabled: true,
      name: 'Written before external ON'
    })

    await waitUntil(() => stale.snapshot().enabled && stale.snapshot().authoritative)
    expect(stale.snapshot()).toMatchObject({
      enabled: true,
      name: 'Written before external ON',
      authoritative: true
    })
    stale.dispose()
    writer.dispose()
  })

  it('preserves corrupt and unreadable canonical bytes instead of treating them as OFF', async () => {
    await fs.mkdir(sharedDir(), { recursive: true })
    const file = path.join(sharedDir(), 'kids-mode.json')
    await fs.writeFile(file, 'not json', 'utf8')
    const corrupt = await fresh({ createWatcher: silentWatcherFactory })
    await expect(corrupt.rename('Must not replace corruption')).rejects.toMatchObject({
      code: 'kids-mode-record-unavailable',
      reason: 'invalid'
    })
    expect(await fs.readFile(file, 'utf8')).toBe('not json')
    corrupt.dispose()

    await fs.writeFile(file, JSON.stringify({ version: 1, enabled: true, name: 'Keep me' }), 'utf8')
    let denied = false
    const unreadable = await fresh({
      createWatcher: silentWatcherFactory,
      readSnapshot: async (target) => {
        if (denied) throw Object.assign(new Error('denied'), { code: 'EACCES' })
        return readAtomicFileSnapshot(target)
      }
    })
    denied = true
    await expect(unreadable.rename('Must not replace unreadable')).rejects.toMatchObject({
      code: 'kids-mode-record-unavailable',
      reason: 'unreadable'
    })
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toMatchObject({
      enabled: true,
      name: 'Keep me'
    })
    unreadable.dispose()
  })
})

describe('live shared-record watching', () => {
  it('marks policy unavailable while a watcher-triggered reload is still pending', async () => {
    const s = await fresh()
    expect(s.snapshot()).toMatchObject({ enabled: false, authoritative: true })
    const realReadFile = fs.readFile.bind(fs)
    let releaseRead!: (value: string) => void
    let intercepted = false
    const readSpy = vi.spyOn(fs, 'readFile').mockImplementation(async (...args: Parameters<typeof fs.readFile>) => {
      const file = String(args[0])
      if (!intercepted && file.endsWith('kids-mode.json')) {
        intercepted = true
        return new Promise<string>((resolve) => {
          releaseRead = resolve
        })
      }
      return realReadFile(...args)
    })

    const next = JSON.stringify({ version: 1, enabled: true, name: 'External ON' })
    await fs.mkdir(sharedDir(), { recursive: true })
    await fs.writeFile(path.join(sharedDir(), 'kids-mode.json'), next)
    await waitUntil(() => intercepted && s.snapshot().authoritative === false)
    expect(s.snapshot()).toMatchObject({ enabled: false, authoritative: false })

    releaseRead(next)
    await waitUntil(() => s.snapshot().enabled && s.snapshot().authoritative)
    readSpy.mockRestore()
    s.dispose()
  })

  it('does not miss an ON record created while the initial absent read is in flight', async () => {
    const realReadFile = fs.readFile.bind(fs)
    let intercepted = false
    const readSpy = vi.spyOn(fs, 'readFile').mockImplementation(async (...args: Parameters<typeof fs.readFile>) => {
      const file = String(args[0])
      if (!intercepted && file.endsWith('kids-mode.json')) {
        intercepted = true
        await fs.mkdir(sharedDir(), { recursive: true })
        await fs.writeFile(
          path.join(sharedDir(), 'kids-mode.json'),
          JSON.stringify({ version: 1, enabled: true, name: 'Created during read' })
        )
        throw Object.assign(new Error('the read began before creation'), { code: 'ENOENT' })
      }
      return realReadFile(...args)
    })
    const s = await fresh()

    await waitUntil(() => s.isOn())
    expect(s.snapshot()).toMatchObject({
      enabled: true,
      name: 'Created during read',
      authoritative: true
    })
    readSpy.mockRestore()
    s.dispose()
  })

  it('observes an external edit after its first write creates a directory absent at boot', async () => {
    const s = await fresh()

    // init() ran while ~/.nodeterm/shared did not exist. The first local write creates it;
    // the same process must then become a live observer rather than staying unwatched forever.
    await s.rename('Created here')
    await fs.writeFile(
      path.join(sharedDir(), 'kids-mode.json'),
      JSON.stringify({ version: 1, enabled: true, name: 'Edited elsewhere' })
    )

    await waitUntil(() => s.get().name === 'Edited elsewhere')
    expect(s.get()).toEqual({ version: 1, enabled: true, name: 'Edited elsewhere' })
    s.dispose()

    await fs.writeFile(
      path.join(sharedDir(), 'kids-mode.json'),
      JSON.stringify({ version: 1, enabled: false, name: 'After shutdown' })
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(s.get().name, 'dispose must close the live watcher').toBe('Edited elsewhere')
  })
})
