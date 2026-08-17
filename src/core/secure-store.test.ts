import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

import { fakePlatform, type FakePlatform } from './platform-fake'
import { initPlatform, resetPlatformForTests } from './platform'
import { SecureStore, type SealedEntry } from './secure-store'
import { startAuthenticatorService } from './toylocks/authenticator-service'
import { startToyLockService } from './toylocks/toylock-service'
import { IPC } from '../shared/ipc'
import type {
  AuthenticatorAddManualInput,
  AuthenticatorAddResult,
  AuthenticatorEntry,
  AuthenticatorRemoveInput,
  AuthenticatorRemoveResult
} from '../shared/authenticator'
import type { ToyLockCreatePasswordInput, ToyLockCreateResult, ToyLockRecord } from '../shared/toylock'

interface TestMeta {
  id: string
  label: string
}

let dir = ''
let corePlatform: FakePlatform

const TEST_IDS: Record<string, string> = {
  seed: '00000000-0000-4000-8000-000000000001',
  first: '00000000-0000-4000-8000-000000000002',
  second: '00000000-0000-4000-8000-000000000003',
  published: '00000000-0000-4000-8000-000000000004',
  recovered: '00000000-0000-4000-8000-000000000005',
  original: '00000000-0000-4000-8000-000000000006',
  old: '00000000-0000-4000-8000-000000000007',
  new: '00000000-0000-4000-8000-000000000008'
}

function sealed(label: string): SealedEntry<TestMeta> {
  return { meta: { id: TEST_IDS[label], label }, secretEnc: `sealed-${label}` }
}

async function drainMicrotasks(): Promise<void> {
  // Queue bypasses and per-instance queues both need at most two promise turns to reach a mocked
  // read. A few extra turns keep the assertion independent of the queue helper's implementation.
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve()
}

async function waitForBarrier(
  barrier: Promise<void>,
  operation: Promise<unknown>,
  release: () => void,
  label: string
): Promise<void> {
  try {
    await Promise.race([
      barrier,
      operation.then(
        () => { throw new Error(`${label} completed before reaching its barrier`) },
        (error: unknown) => { throw error }
      )
    ])
  } catch (error) {
    release()
    await Promise.allSettled([operation])
    throw error
  }
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nodeterm-secure-store-'))
  resetPlatformForTests()
  corePlatform = fakePlatform({ userDataDir: dir })
  initPlatform(corePlatform)
})

afterEach(async () => {
  vi.restoreAllMocks()
  resetPlatformForTests()
  await fs.rm(dir, { recursive: true, force: true })
})

describe('SecureStore transaction ordering', () => {
  it('serializes the complete mutation across independent instances for one path', async () => {
    const firstStore = new SecureStore<TestMeta>('shared.json')
    const secondStore = new SecureStore<TestMeta>('shared.json')
    await firstStore.save([sealed('seed')])
    const seededDocument = await fs.readFile(path.join(dir, 'shared.json'), 'utf8')

    let signalFirstEntered!: () => void
    let releaseFirst!: () => void
    const firstEntered = new Promise<void>((resolve) => { signalFirstEntered = resolve })
    const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve })

    const first = firstStore.mutate<void>(async (entries) => {
      signalFirstEntered()
      await firstReleased
      entries.push(sealed('first'))
      return { changed: true, result: undefined }
    })
    await waitForBarrier(firstEntered, first, releaseFirst, 'first mutation')

    // If the second transaction gets as far as its read while the first callback is parked, make
    // that read resolve immediately with the same starting snapshot. This turns a missing/shared
    // queue into a deterministic behavioral failure rather than a filesystem scheduling race.
    const readSpy = vi.spyOn(fs, 'readFile').mockResolvedValue(seededDocument)
    let secondEntered = false
    const second = secondStore.mutate<void>((entries) => {
      secondEntered = true
      entries.push(sealed('second'))
      return { changed: true, result: undefined }
    })

    let assertionError: unknown
    try {
      await drainMicrotasks()
      expect(secondEntered).toBe(false)
    } catch (error) {
      assertionError = error
    } finally {
      readSpy.mockRestore()
      releaseFirst()
    }

    const settled = await Promise.allSettled([first, second])
    if (assertionError) throw assertionError
    expect(settled.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
    expect((await firstStore.load()).map((entry) => entry.meta.label)).toEqual([
      'seed',
      'first',
      'second'
    ])
  })

  it('orders loads after an already-invoked save from another instance', async () => {
    const writer = new SecureStore<TestMeta>('read-after-write.json')
    const reader = new SecureStore<TestMeta>('read-after-write.json')
    const target = path.join(dir, 'read-after-write.json')
    const realRename = fs.rename.bind(fs)

    let signalPublishing!: () => void
    let releasePublish!: () => void
    const publishing = new Promise<void>((resolve) => { signalPublishing = resolve })
    const released = new Promise<void>((resolve) => { releasePublish = resolve })
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      signalPublishing()
      await released
      return realRename(from, to)
    })

    const saving = writer.save([sealed('published')])
    await waitForBarrier(publishing, saving, releasePublish, 'save')

    const emptyDocument = JSON.stringify({ version: 1, entries: [] })
    const readSpy = vi.spyOn(fs, 'readFile').mockResolvedValue(emptyDocument)
    let readSettled = false
    const reading = reader.load().then((entries) => {
      readSettled = true
      return entries
    })

    let assertionError: unknown
    try {
      await drainMicrotasks()
      expect(readSettled).toBe(false)
    } catch (error) {
      assertionError = error
    } finally {
      readSpy.mockRestore()
      releasePublish()
    }

    const [saveResult, readResult] = await Promise.allSettled([saving, reading])
    if (assertionError) throw assertionError
    expect(saveResult.status).toBe('fulfilled')
    expect(readResult).toEqual({ status: 'fulfilled', value: [sealed('published')] })
    expect(await fs.readFile(target, 'utf8')).toContain('published')
  })

  it('continues with the next transaction after a rejection', async () => {
    const firstStore = new SecureStore<TestMeta>('recovery.json')
    const secondStore = new SecureStore<TestMeta>('recovery.json')

    const rejected = firstStore.mutate<void>(() => {
      throw new Error('deliberate mutation failure')
    })
    const recovered = secondStore.mutate<string>((entries) => {
      entries.push(sealed('recovered'))
      return { changed: true, result: 'done' }
    })

    await expect(rejected).rejects.toThrow('deliberate mutation failure')
    await expect(recovered).resolves.toBe('done')
    expect((await firstStore.load()).map((entry) => entry.meta.label)).toEqual(['recovered'])
  })

  it('does not publish a no-change transaction', async () => {
    const store = new SecureStore<TestMeta>('unchanged.json')
    await store.save([sealed('original')])
    const target = path.join(dir, 'unchanged.json')
    const before = await fs.readFile(target, 'utf8')
    const renameSpy = vi.spyOn(fs, 'rename')

    await expect(
      store.mutate<string>(() => ({ changed: false, result: 'not-found' }))
    ).resolves.toBe('not-found')

    expect(renameSpy).not.toHaveBeenCalled()
    expect(await fs.readFile(target, 'utf8')).toBe(before)
  })

  it('hardens permissions before publish so a rejected save leaves the prior entry durable', async () => {
    const store = new SecureStore<TestMeta>('chmod-before-publish.json')
    await store.save([sealed('old')])
    const realChmod = fs.chmod.bind(fs)
    let refused = false
    vi.spyOn(fs, 'chmod').mockImplementation(async (target, mode) => {
      if (!refused && String(target).includes('chmod-before-publish.json.') && String(target).endsWith('.tmp')) {
        refused = true
        throw Object.assign(new Error('EACCES: cannot harden temp'), { code: 'EACCES' })
      }
      return realChmod(target, mode)
    })

    await expect(store.save([sealed('new')])).rejects.toMatchObject({ code: 'EACCES' })
    await expect(store.load()).resolves.toEqual([sealed('old')])
  })

  it('rejects a mutation on corrupt input and preserves the recoverable bytes', async () => {
    const store = new SecureStore<TestMeta>('corrupt.json')
    const target = path.join(dir, 'corrupt.json')
    const corrupt = '{ this is not valid json'
    await fs.writeFile(target, corrupt, 'utf8')
    const mutation = vi.fn(() => ({ changed: true, result: undefined }))

    await expect(store.mutate(mutation)).rejects.toBeInstanceOf(SyntaxError)
    expect(mutation).not.toHaveBeenCalled()
    expect(await fs.readFile(target, 'utf8')).toBe(corrupt)
    await expect(store.load()).rejects.toBeInstanceOf(SyntaxError)
    expect(await fs.readFile(target, 'utf8')).toBe(corrupt)
  })

  it('does not republish parseable JSON with a malformed sealed entry', async () => {
    const store = new SecureStore<TestMeta>('malformed-entry.json')
    const target = path.join(dir, 'malformed-entry.json')
    const malformed = JSON.stringify({ version: 1, entries: [null] })
    await fs.writeFile(target, malformed, 'utf8')
    const mutation = vi.fn(() => ({ changed: true, result: undefined }))

    await expect(store.mutate(mutation)).rejects.toThrow(
      'Secure store has an unsupported or malformed document'
    )
    expect(mutation).not.toHaveBeenCalled()
    expect(await fs.readFile(target, 'utf8')).toBe(malformed)
    await expect(store.load()).rejects.toThrow(
      'Secure store has an unsupported or malformed document'
    )
    expect(await fs.readFile(target, 'utf8')).toBe(malformed)
  })

  it('rejects invalid UUIDs and duplicate ids before a save can self-corrupt the store', async () => {
    const store = new SecureStore<TestMeta>('validated-save.json')
    const target = path.join(dir, 'validated-save.json')
    await store.save([sealed('original')])
    const before = await fs.readFile(target, 'utf8')

    await expect(
      store.save([{ meta: { id: 'not-a-uuid', label: 'invalid' }, secretEnc: 'secret' }])
    ).rejects.toThrow('Secure store has an unsupported or malformed document')
    await expect(store.save([sealed('new'), sealed('new')])).rejects.toThrow(
      'Secure store has an unsupported or malformed document'
    )

    expect(await fs.readFile(target, 'utf8')).toBe(before)
    await expect(store.load()).resolves.toEqual([sealed('original')])
  })

  it('rejects an invalid mutation result and preserves the exact prior bytes', async () => {
    const store = new SecureStore<TestMeta>('validated-mutation.json')
    const target = path.join(dir, 'validated-mutation.json')
    await store.save([sealed('original')])
    const before = await fs.readFile(target, 'utf8')

    await expect(
      store.mutate<void>((entries) => {
        entries.push(structuredClone(entries[0]))
        return { changed: true, result: undefined }
      })
    ).rejects.toThrow('Secure store has an unsupported or malformed document')

    expect(await fs.readFile(target, 'utf8')).toBe(before)
    await expect(store.load()).resolves.toEqual([sealed('original')])
  })

  it('treats EACCES as unreadable evidence, never as an empty store', async () => {
    const store = new SecureStore<TestMeta>('unreadable.json')
    const target = path.resolve(dir, 'unreadable.json')
    await store.save([sealed('original')])
    const before = await fs.readFile(target, 'utf8')
    const realReadFile = fs.readFile.bind(fs)
    vi.spyOn(fs, 'readFile').mockImplementation(async (file, options) => {
      if (path.resolve(String(file)) === target) {
        throw Object.assign(new Error('EACCES: credential evidence is unreadable'), { code: 'EACCES' })
      }
      return realReadFile(file, options)
    })

    await expect(store.load()).rejects.toMatchObject({ code: 'EACCES' })
    await expect(
      store.mutate<void>(() => ({ changed: true, result: undefined }))
    ).rejects.toMatchObject({ code: 'EACCES' })

    vi.restoreAllMocks()
    expect(await fs.readFile(target, 'utf8')).toBe(before)
  })
})

describe('SecureStore caller transactions', () => {
  it('refuses to remove an authenticator entry whose sealed revision changed after disclosure', async () => {
    startAuthenticatorService()
    const add = corePlatform.handlers[IPC.authenticatorAddManual] as (
      input: AuthenticatorAddManualInput
    ) => Promise<AuthenticatorAddResult>
    const rename = corePlatform.handlers[IPC.authenticatorRename] as (
      input: { id: string; issuer?: string; account?: string }
    ) => Promise<AuthenticatorEntry | null>
    const remove = corePlatform.handlers[IPC.authenticatorRemove] as (
      input: AuthenticatorRemoveInput
    ) => Promise<AuthenticatorRemoveResult>
    const list = corePlatform.handlers[IPC.authenticatorList] as () => Promise<AuthenticatorEntry[]>

    const added = await add({
      issuer: 'Original',
      account: 'child@example.test',
      secretBase32: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30
    })
    expect(added.ok).toBe(true)
    if (!added.ok) throw new Error(added.error)

    const disclosed = added.entry
    const current = await rename({ id: disclosed.id, issuer: 'Renamed' })
    expect(current).not.toBeNull()
    expect(current?.revision).not.toBe(disclosed.revision)

    await expect(remove({ id: disclosed.id, revision: disclosed.revision })).resolves.toMatchObject({
      ok: false,
      error: 'changed'
    })
    expect(await list()).toEqual([current])

    await expect(remove({ id: current!.id, revision: current!.revision })).resolves.toMatchObject({
      ok: true,
      removed: current
    })
    expect(await list()).toEqual([])
  })

  it('keeps both authenticator additions when the first read is parked', async () => {
    startAuthenticatorService()
    const add = corePlatform.handlers[IPC.authenticatorAddManual] as (
      input: AuthenticatorAddManualInput
    ) => Promise<AuthenticatorAddResult>
    const list = corePlatform.handlers[IPC.authenticatorList] as () => Promise<AuthenticatorEntry[]>
    const target = path.resolve(dir, 'authenticator.json')
    const realReadFile = fs.readFile.bind(fs)

    let signalFirstRead!: () => void
    let releaseFirstRead!: () => void
    const firstRead = new Promise<void>((resolve) => { signalFirstRead = resolve })
    const firstReadReleased = new Promise<void>((resolve) => { releaseFirstRead = resolve })
    let targetReads = 0
    vi.spyOn(fs, 'readFile').mockImplementation(async (file, options) => {
      if (path.resolve(String(file)) === target) {
        targetReads += 1
        if (targetReads === 1) {
          signalFirstRead()
          await firstReadReleased
        }
      }
      return realReadFile(file, options)
    })

    const input = (issuer: string): AuthenticatorAddManualInput => ({
      issuer,
      account: `${issuer.toLowerCase()}@example.test`,
      secretBase32: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30
    })

    const first = add(input('First'))
    await waitForBarrier(firstRead, first, releaseFirstRead, 'first authenticator read')
    const second = add(input('Second'))
    try {
      releaseFirstRead()
      const results = await Promise.all([first, second])
      expect(results.every((result) => result.ok)).toBe(true)
      expect((await list()).map((entry) => entry.issuer).sort()).toEqual(['First', 'Second'])
    } finally {
      // Always open the barrier if an assertion or implementation error exits the test early.
      releaseFirstRead()
      await Promise.allSettled([first, second])
    }
  })

  it('allows only one concurrent toy-lock creation for the same target', async () => {
    const service = startToyLockService()
    const create = corePlatform.handlers[IPC.toylockCreatePassword] as (
      input: ToyLockCreatePasswordInput
    ) => Promise<ToyLockCreateResult>
    const list = corePlatform.handlers[IPC.toylockList] as () => Promise<ToyLockRecord[]>
    const target = path.resolve(dir, 'toylocks.json')
    const realReadFile = fs.readFile.bind(fs)

    let signalFirstRead!: () => void
    let releaseFirstRead!: () => void
    const firstRead = new Promise<void>((resolve) => { signalFirstRead = resolve })
    const firstReadReleased = new Promise<void>((resolve) => { releaseFirstRead = resolve })
    let targetReads = 0
    vi.spyOn(fs, 'readFile').mockImplementation(async (file, options) => {
      if (path.resolve(String(file)) === target) {
        targetReads += 1
        if (targetReads === 1) {
          signalFirstRead()
          await firstReadReleased
        }
      }
      return realReadFile(file, options)
    })

    const input = (password: string): ToyLockCreatePasswordInput => ({
      target: { kind: 'tab', id: 'same-tab', label: 'Same tab' },
      password,
      duration: 'session',
      lockedOnLaunch: true
    })

    const first = create(input('first-password'))
    await waitForBarrier(firstRead, first, releaseFirstRead, 'first toy-lock read')
    const second = create(input('second-password'))
    try {
      releaseFirstRead()
      const results = await Promise.all([first, second])
      expect(results.map((result) => result.ok).sort()).toEqual([false, true])
      expect(await list()).toHaveLength(1)
    } finally {
      releaseFirstRead()
      await Promise.allSettled([first, second])
      service.dispose()
    }
  })
})
