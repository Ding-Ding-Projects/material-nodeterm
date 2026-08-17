// Atomic-write behaviour of <userData>/remote-approved-devices.json.
//
// Three writers reach the store from the main process: the standing host's fire-and-forget pin,
// relay-trust's un-awaited settle pin, and the revoke IPC. Each used to load + modify + save its own
// snapshot. Atomic files prevented torn JSON but not a complete stale approval write from landing
// after a revoke and resurrecting the revoked key. The mutation funnel serializes the DECISION.
//
// The list is PUBLIC keys, not credentials, so there is no orphan sweep here — unlike the PAT stores
// (src/main/github-control.ts, src/server/github-control.ts) or agent.json (src/main/pairing-service.ts),
// whose orphan temps hold live credentials — but a failed save must still leave the OLD file
// byte-for-byte intact, because revocation.ts's `persisted:false` contract is built on precisely that.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, promises as fs, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { loadApprovedDevices, mutateApprovedDevices } from './approved-devices'
import { pinDevice, unpinDevice, type ApprovedDevices } from './approved-devices-core'

// `file()` resolves <userData> through `app.getPath` on every call, so a mutable dir set in
// beforeEach is enough here — the factory only reads it when the getter is invoked.
let userData = ''
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

describe('approved-devices atomic write', () => {
  let target: string

  beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'nt-approved-'))
    target = path.join(userData, 'remote-approved-devices.json')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(userData, { recursive: true, force: true })
  })

  const tmpsLeft = async (): Promise<string[]> =>
    (await fs.readdir(userData)).filter((f) => f.endsWith('.tmp'))

  it('a concurrent approval cannot resurrect a key revoked after the approval began', async () => {
    writeFileSync(target, JSON.stringify({ pubkeys: ['revoked-phone'] }), { mode: 0o600 })

    // Hold the approval after its temp contains the stale `[revoked-phone, new-phone]` snapshot but
    // before rename. The revoke is invoked while that write is suspended. Without store-level
    // serialization it publishes `[]`, then the released approval renames its stale snapshot last
    // and resurrects revoked-phone. With the funnel, revoke cannot even read until approval lands.
    const realWriteFile = fs.writeFile
    const realReadFile = fs.readFile
    let writes = 0
    let reads = 0
    let approvalWritten!: () => void
    let releaseApproval!: () => void
    let secondReadStarted!: () => void
    const approvalAtRename = new Promise<void>((resolve) => (approvalWritten = resolve))
    const approvalMayRename = new Promise<void>((resolve) => (releaseApproval = resolve))
    const secondMutationRead = new Promise<void>((resolve) => (secondReadStarted = resolve))
    vi.spyOn(fs, 'readFile').mockImplementation((async (...args: any[]) => {
      reads += 1
      if (reads === 2) secondReadStarted()
      return (realReadFile as any)(...args)
    }) as any)
    vi.spyOn(fs, 'writeFile').mockImplementation((async (p: any, ...rest: any[]) => {
      const out = await (realWriteFile as any)(p, ...rest)
      if (String(p).startsWith(target)) {
        writes += 1
        if (writes === 1) {
          approvalWritten()
          await approvalMayRename
        }
      }
      return out
    }) as any)

    const approval = mutateApprovedDevices((store) => pinDevice(store, 'new-phone'))
    await approvalAtRename
    const revocation = mutateApprovedDevices((store) => unpinDevice(store, 'revoked-phone'))
    const readBeforeRelease = await Promise.race([
      secondMutationRead.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 50))
    ])
    const writesBeforeRelease = writes
    releaseApproval()
    await Promise.all([approval, revocation])
    vi.restoreAllMocks()

    expect(readBeforeRelease).toBe(false)
    expect(writesBeforeRelease).toBe(1) // revoke could not read/write until approval fully published
    expect(await loadApprovedDevices()).toEqual({ pubkeys: ['new-phone'] })
    expect(await tmpsLeft()).toEqual([])
  })

  it('only ENOENT means an empty approved-device list', async () => {
    await expect(loadApprovedDevices()).resolves.toEqual({ pubkeys: [] })

    writeFileSync(target, '{not-json', { mode: 0o600 })
    const corruptBytes = await fs.readFile(target, 'utf-8')
    await expect(loadApprovedDevices()).rejects.toThrow()
    await expect(
      mutateApprovedDevices((store) => pinDevice(store, 'must-not-overwrite-corruption'))
    ).rejects.toThrow()
    expect(await fs.readFile(target, 'utf-8')).toBe(corruptBytes)

    writeFileSync(target, JSON.stringify({ wrong: [] }), { mode: 0o600 })
    await expect(loadApprovedDevices()).rejects.toThrow(/valid store/i)
  })

  it('propagates an unreadable-file result and lets later queued reads recover', async () => {
    const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(denied)
    await expect(loadApprovedDevices()).rejects.toMatchObject({ code: 'EACCES' })
    vi.restoreAllMocks()

    writeFileSync(target, JSON.stringify({ pubkeys: ['still-here'] }), { mode: 0o600 })
    await expect(loadApprovedDevices()).resolves.toEqual({ pubkeys: ['still-here'] })
  })

  it('rejects an in-place mutation and keeps the queue usable', async () => {
    await expect(
      mutateApprovedDevices((store) => {
        const mutable = store.pubkeys as string[]
        mutable.push('silently-lost-without-the-freeze')
        return store
      })
    ).rejects.toThrow()

    await expect(
      mutateApprovedDevices((store) => pinDevice(store, 'pure-update'))
    ).resolves.toEqual({ pubkeys: ['pure-update'] })
    await expect(loadApprovedDevices()).resolves.toEqual({ pubkeys: ['pure-update'] })
  })

  it('a failed rename removes its own temp, rejects, and leaves the OLD pinned list intact', async () => {
    const pinned: ApprovedDevices = { pubkeys: ['already-approved-phone'] }
    writeFileSync(target, JSON.stringify(pinned), { mode: 0o600 })
    const before = await fs.readFile(target, 'utf-8')
    // EXDEV is the realistic one: the userData dir on another filesystem than the temp.
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('EXDEV: cross-device link not permitted, rename'), { code: 'EXDEV' })
    )

    await expect(
      mutateApprovedDevices((store) => unpinDevice(store, 'already-approved-phone'))
    ).rejects.toThrow(/EXDEV/)

    // revocation.ts's RevokeResult.persisted documents exactly this: a failed write leaves the OLD
    // still-pinned file byte-for-byte intact, so the caller must report persisted:false and retry.
    // If a failed save could half-publish, that contract (and the "Removed" UI) would be a lie.
    expect(await fs.readFile(target, 'utf-8')).toBe(before)
    await expect(loadApprovedDevices()).resolves.toEqual(pinned)
    // A unique tmp name is never written again, so only this save's own cleanup collects it.
    expect(await tmpsLeft()).toEqual([])
  })
})
