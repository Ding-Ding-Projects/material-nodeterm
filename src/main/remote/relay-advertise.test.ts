// relay.json is public identity material, but its atomic UUID temp files can accumulate forever
// when the desktop dies between write and rename. These tests import the module under a disposable
// home and exercise the shared conservative sweep through the real advertisement write boundary.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, promises as fs, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { STALE_TEMP_AGE_MS } from '../../core/fs-atomic'

let home = ''

vi.mock('os', async (orig) => {
  const real = (await orig()) as typeof import('os')
  // relay-advertise freezes FILE from the default os export at module load. Patch both shapes so
  // a failed mock cannot aim a gate at the developer's real ~/.nodeterm directory.
  const patched = { ...real, homedir: () => home }
  return { ...patched, default: patched }
})

const NOW = 2_000_000_000_000
const OLD = new Date(NOW - STALE_TEMP_AGE_MS - 1)
const VALID_UUID_A = '123e4567-e89b-42d3-a456-426614174000'
const VALID_UUID_B = '123e4567-e89b-42d3-a456-426614174001'

const relayFile = (): string => path.join(home, '.nodeterm', 'relay.json')
const relayDir = (): string => path.dirname(relayFile())
const ownedTemp = (pid: number, sequence: number, uuid: string): string =>
  `${relayFile()}.${pid}.${sequence}.${uuid}.tmp`

const advertisement = {
  v: 1 as const,
  hostId: 'host-id',
  hostPublicKeyB64: 'public-key',
  relayEndpoint: 'wss://relay.invalid',
  hostDeviceId: 'device-id'
}

async function writeOld(file: string, bytes = 'orphan'): Promise<void> {
  await fs.writeFile(file, bytes, { mode: 0o600 })
  await fs.utimes(file, OLD, OLD)
}

async function writeAdvertisement(): Promise<void> {
  const { writeRelayAdvertisement } = await import('./relay-advertise')
  await writeRelayAdvertisement(advertisement)
  expect(JSON.parse(await fs.readFile(relayFile(), 'utf8'))).toEqual(advertisement)
}

describe('relay advertisement temp recovery', () => {
  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'nt-relay-advertise-home-'))
    mkdirSync(relayDir(), { recursive: true, mode: 0o700 })
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  it('preserves an old UUID temp even when its foreign owner is not visible locally', async () => {
    const orphan = ownedTemp(424242, 1, VALID_UUID_A)
    await writeOld(orphan)
    const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
      expect(pid).toBe(424242)
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
    }) as typeof process.kill)

    await writeAdvertisement()

    expect(kill).not.toHaveBeenCalled()
    expect(await fs.readFile(orphan, 'utf8')).toBe('orphan')
  })

  it('preserves a young foreign UUID temp without probing its owner', async () => {
    const young = ownedTemp(515151, 2, VALID_UUID_A)
    await fs.writeFile(young, 'in flight', { mode: 0o600 })
    await fs.utimes(
      young,
      new Date(NOW - STALE_TEMP_AGE_MS + 1),
      new Date(NOW - STALE_TEMP_AGE_MS + 1)
    )
    const kill = vi.spyOn(process, 'kill')

    await writeAdvertisement()

    expect(kill).not.toHaveBeenCalled()
    expect(await fs.readFile(young, 'utf8')).toBe('in flight')
  })

  it('preserves old foreign UUID temps without namespace-local liveness probes', async () => {
    const live = ownedTemp(616161, 3, VALID_UUID_A)
    const unjudgeable = ownedTemp(717171, 4, VALID_UUID_B)
    await Promise.all([writeOld(live, 'live writer'), writeOld(unjudgeable, 'unknown writer')])
    const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
      if (pid === 616161) return true
      throw Object.assign(new Error('not permitted'), { code: 'EPERM' })
    }) as typeof process.kill)

    await writeAdvertisement()

    expect(kill).not.toHaveBeenCalled()
    expect(await fs.readFile(live, 'utf8')).toBe('live writer')
    expect(await fs.readFile(unjudgeable, 'utf8')).toBe('unknown writer')
  })

  it('preserves malformed names even when they are old and a similarly numbered owner is dead', async () => {
    const malformed = `${relayFile()}.818181.5.uuid.with.extra.parts.tmp`
    await writeOld(malformed, 'not ours')
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
    })

    await writeAdvertisement()

    expect(kill).not.toHaveBeenCalled()
    expect(await fs.readFile(malformed, 'utf8')).toBe('not ours')
  })

  it('preserves a recognized temp when its metadata cannot be read', async () => {
    const unreadable = ownedTemp(919191, 6, VALID_UUID_A)
    await writeOld(unreadable, 'unreadable metadata')
    const realLstat = fs.lstat
    vi.spyOn(fs, 'lstat').mockImplementation((async (file: any, ...args: any[]) => {
      if (String(file) === unreadable) {
        throw Object.assign(new Error('access denied'), { code: 'EACCES' })
      }
      return (realLstat as any)(file, ...args)
    }) as typeof fs.lstat)
    const kill = vi.spyOn(process, 'kill')

    await writeAdvertisement()

    expect(kill).not.toHaveBeenCalled()
    expect(await fs.readFile(unreadable, 'utf8')).toBe('unreadable metadata')
  })

  it('preserves candidates when the directory cannot be inspected', async () => {
    const uninspected = ownedTemp(929292, 7, VALID_UUID_A)
    await writeOld(uninspected, 'directory read failed')
    vi.spyOn(fs, 'readdir').mockRejectedValueOnce(
      Object.assign(new Error('access denied'), { code: 'EACCES' })
    )
    const kill = vi.spyOn(process, 'kill')

    await writeAdvertisement()

    expect(kill).not.toHaveBeenCalled()
    expect(await fs.readFile(uninspected, 'utf8')).toBe('directory read failed')
  })

  it('removes exactly its own UUID temp when publication fails', async () => {
    await fs.writeFile(relayFile(), 'old advertisement\n', { mode: 0o600 })
    const foreign = `${relayFile()}.foreign.tmp`
    await fs.writeFile(foreign, 'foreign scratch', { mode: 0o600 })
    vi.spyOn(fs, 'rename').mockRejectedValue(
      Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    )

    const { writeRelayAdvertisement } = await import('./relay-advertise')
    await writeRelayAdvertisement(advertisement)

    expect(await fs.readFile(relayFile(), 'utf8')).toBe('old advertisement\n')
    expect(await fs.readFile(foreign, 'utf8')).toBe('foreign scratch')
    expect((await fs.readdir(relayDir())).sort()).toEqual(['relay.json', 'relay.json.foreign.tmp'])
  })
})
