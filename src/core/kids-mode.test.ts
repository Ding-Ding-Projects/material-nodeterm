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

async function fresh() {
  const s = new KidsModeStore()
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

  it('fails OFF on a corrupt record, never into an unverifiable locked state', async () => {
    // Which way this fails matters. A corrupt shared file must not leave a child in a mode
    // nobody can confirm the state of, and must not lock an adult out of their own app.
    await fs.mkdir(sharedDir(), { recursive: true })
    await fs.writeFile(path.join(sharedDir(), 'kids-mode.json'), 'not json')
    const s = await fresh()
    expect(s.isOn()).toBe(false)
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

describe('live shared-record watching', () => {
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
