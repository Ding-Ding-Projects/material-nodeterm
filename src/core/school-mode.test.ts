// School mode had NO tests — 309 lines of PIN hashing, credential sealing and atomic writes with
// nothing guarding them. That is the "thoroughly tested pure half, untested I/O half" shape this
// repo has been bitten by before, and it matters more here than usual for two reasons: the code
// decides whether a locked mode can be left, and Kids mode is about to be built on the same
// mechanism. This file is the safety net that makes extracting that mechanism safe to attempt.
//
// The store reads `~/.nodeterm/shared`, so every test redirects HOME to a temp directory. Nothing
// here touches the developer's real shared record.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

// The platform seam must be mocked before the module under test imports it.
const handlers = new Map<string, unknown>()
let sealAvailable = true

vi.mock('./platform', () => ({
  platform: () => ({
    handle: (channel: string, fn: unknown) => handlers.set(channel, fn),
    broadcast: () => {},
    userDataDir: () => os.tmpdir(),
    ...(sealAvailable
      ? {
          // A reversible stand-in for the OS credential vault: enough to prove the store
          // round-trips through seal/unseal and base64-encodes before sealing, without needing a
          // real keychain in CI.
          sealSecret: (b: Buffer) => Buffer.from(`sealed:${b.toString('utf8')}`, 'utf8'),
          unsealSecret: (b: Buffer) => {
            const s = b.toString('utf8')
            if (!s.startsWith('sealed:')) throw new Error('not sealed by us')
            return Buffer.from(s.slice('sealed:'.length), 'utf8')
          }
        }
      : {})
  })
}))

const { SchoolModeStore, DEFAULT_SCHOOL_MODE_NAME, sharedDir } = await import('./school-mode')

let home: string
let homeSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  handlers.clear()
  sealAvailable = true
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-school-'))
  homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(home)
})

afterEach(async () => {
  homeSpy.mockRestore()
  await fs.rm(home, { recursive: true, force: true })
})

async function fresh() {
  const s = new SchoolModeStore()
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

describe('defaults and durability', () => {
  it('starts off, with the shipped name, when nothing has ever been written', async () => {
    const s = await fresh()
    expect(s.get()).toEqual({ version: 1, enabled: false, name: DEFAULT_SCHOOL_MODE_NAME })
    s.dispose()
  })

  it('falls back to defaults on a corrupt record rather than crashing the boot', async () => {
    // The file is hand-editable and shared between apps. A malformed byte must never stop the
    // app starting — it must read as "off".
    await fs.mkdir(sharedDir(), { recursive: true })
    await fs.writeFile(path.join(sharedDir(), 'school-mode.json'), '{ not json at all')
    const s = await fresh()
    expect(s.get().enabled).toBe(false)
    s.dispose()
  })

  it('survives a restart — a second store reads what the first wrote', async () => {
    const a = await fresh()
    await a.enable('1234')
    await a.rename('Exam mode')
    a.dispose()

    const b = await fresh()
    expect(b.get().enabled).toBe(true)
    expect(b.get().name).toBe('Exam mode')
    b.dispose()
  })
})

describe('entering and leaving', () => {
  it('needs no PIN to turn ON once a credential exists, but always one to turn OFF', async () => {
    // Entering a focus mode needs no proof; only leaving does.
    const s = await fresh()
    await s.enable('1234')
    expect(s.get().enabled).toBe(true)

    const wrong = await s.disable('9999')
    expect(wrong.ok).toBe(false)
    expect(s.get().enabled, 'a wrong PIN must not turn it off').toBe(true)

    const right = await s.disable('1234')
    expect(right.ok).toBe(true)
    expect(s.get().enabled).toBe(false)

    // Re-entering needs no PIN, because the credential already exists.
    await s.enable()
    expect(s.get().enabled).toBe(true)
    s.dispose()
  })

  it('requires a PIN of a minimum length the very first time', async () => {
    const s = await fresh()
    await expect(s.enable('1')).rejects.toThrow(/PIN/i)
    await expect(s.enable()).rejects.toThrow(/PIN/i)
    expect(s.get().enabled, 'a rejected enable must not half-apply').toBe(false)
    s.dispose()
  })

  it('changes the PIN only with the current one, and the new one then works', async () => {
    const s = await fresh()
    await s.enable('1234')
    expect(await s.changePin('wrong', '5678')).toBe(false)
    expect(await s.changePin('1234', '5678')).toBe(true)

    expect((await s.disable('1234')).ok, 'the old PIN must stop working').toBe(false)
    expect((await s.disable('5678')).ok).toBe(true)
    s.dispose()
  })

  it('refuses a new PIN that is too short, leaving the old one intact', async () => {
    const s = await fresh()
    await s.enable('1234')
    expect(await s.changePin('1234', '1')).toBe(false)
    expect((await s.disable('1234')).ok, 'the original PIN must still work').toBe(true)
    s.dispose()
  })
})

describe('the credential never becomes readable', () => {
  it('stores no plaintext PIN anywhere in the shared directory', async () => {
    const s = await fresh()
    await s.enable('correct-horse')
    s.dispose()

    for (const name of await fs.readdir(sharedDir())) {
      const body = await fs.readFile(path.join(sharedDir(), name), 'utf8')
      expect(body, `${name} must not contain the PIN`).not.toContain('correct-horse')
    }
  })

  it('keeps the credential OUT of the shared record, which other apps read', async () => {
    const s = await fresh()
    await s.enable('1234')
    s.dispose()
    const record = await fs.readFile(path.join(sharedDir(), 'school-mode.json'), 'utf8')
    expect(record).not.toMatch(/hash|salt|sealed|pin/i)
  })

  it('seals the hash when the platform can, and still round-trips', async () => {
    const s = await fresh()
    await s.enable('1234')
    const cred = JSON.parse(await fs.readFile(path.join(sharedDir(), 'school-mode.credential.json'), 'utf8'))
    expect(cred.sealed).toBe(true)
    expect(cred.hash).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect((await s.disable('1234')).ok).toBe(true)
    s.dispose()
  })

  it('treats an unsealable credential as unverifiable, never as a crash', async () => {
    // A keychain reset or a machine migration makes the sealed bytes undecipherable. The
    // documented recovery is deleting the shared directory — the app must say "wrong PIN", not
    // throw on a boot path.
    const s = await fresh()
    await s.enable('1234')
    const file = path.join(sharedDir(), 'school-mode.credential.json')
    const cred = JSON.parse(await fs.readFile(file, 'utf8'))
    cred.hash = Buffer.from('garbage that was never sealed by us', 'utf8').toString('base64')
    await fs.writeFile(file, JSON.stringify(cred))

    const r = await s.disable('1234')
    expect(r.ok).toBe(false)
    expect(s.get().enabled, 'it must stay locked rather than falling open').toBe(true)
    s.dispose()
  })

  it('works with no sealing available at all — the Server Edition has no keychain', async () => {
    sealAvailable = false
    vi.resetModules()
    const { SchoolModeStore: S } = await import('./school-mode')
    const s = new S()
    await s.init()
    await s.enable('1234')
    const cred = JSON.parse(await fs.readFile(path.join(sharedDir(), 'school-mode.credential.json'), 'utf8'))
    expect(cred.sealed).toBe(false)
    expect((await s.disable('1234')).ok).toBe(true)
    s.dispose()
  })
})

describe('the name', () => {
  it('falls back to the shipped name when renamed to whitespace', async () => {
    const s = await fresh()
    await s.rename('   ')
    expect(s.get().name).toBe(DEFAULT_SCHOOL_MODE_NAME)
    s.dispose()
  })

  it('bounds an absurdly long name rather than storing it', async () => {
    const s = await fresh()
    await s.rename('x'.repeat(5000))
    expect(s.get().name.length).toBeLessThanOrEqual(80)
    s.dispose()
  })

  it('renames without a PIN — renaming carries no security meaning', async () => {
    const s = await fresh()
    await s.enable('1234')
    await s.rename('Quiet mode')
    expect(s.get().name).toBe('Quiet mode')
    expect(s.get().enabled, 'renaming must not disturb the lock').toBe(true)
    s.dispose()
  })
})

describe('concurrency', () => {
  it('serialises overlapping writes instead of losing one', async () => {
    // Every write goes through a FIFO chain because the directory watcher's own reload can race
    // a write just issued. Fire several at once and the last one must be what lands.
    const s = await fresh()
    await s.enable('1234')
    await Promise.all([s.rename('one'), s.rename('two'), s.rename('three')])
    const onDisk = JSON.parse(await fs.readFile(path.join(sharedDir(), 'school-mode.json'), 'utf8'))
    expect(onDisk.name).toBe(s.get().name)
    expect(['one', 'two', 'three']).toContain(onDisk.name)
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
      path.join(sharedDir(), 'school-mode.json'),
      JSON.stringify({ version: 1, enabled: true, name: 'Edited elsewhere' })
    )

    await waitUntil(() => s.get().name === 'Edited elsewhere')
    expect(s.get()).toEqual({ version: 1, enabled: true, name: 'Edited elsewhere' })
    s.dispose()

    await fs.writeFile(
      path.join(sharedDir(), 'school-mode.json'),
      JSON.stringify({ version: 1, enabled: false, name: 'After shutdown' })
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(s.get().name, 'dispose must close the live watcher').toBe('Edited elsewhere')
  })
})
