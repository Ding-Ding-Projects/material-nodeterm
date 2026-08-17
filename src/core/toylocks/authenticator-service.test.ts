import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthenticatorEntry, AuthenticatorRemoveResult } from '../../shared/authenticator'
import { IPC } from '../../shared/ipc'
import type { SealedEntry } from '../secure-store'

const handlers = new Map<string, (...args: never[]) => unknown>()

vi.mock('../platform', () => ({
  platform: () => ({
    handle: (channel: string, handler: (...args: never[]) => unknown) => handlers.set(channel, handler)
  })
}))

const { startAuthenticatorService } = await import('./authenticator-service')

const META: AuthenticatorEntry = {
  id: 'entry-1',
  issuer: 'Example',
  account: 'person@example.test',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  createdAt: 1,
  updatedAt: 1
}

function handler<T extends (...args: never[]) => unknown>(channel: string): T {
  const found = handlers.get(channel)
  if (!found) throw new Error(`missing handler ${channel}`)
  return found as T
}

function fakeStore(initial: SealedEntry<AuthenticatorEntry>[]) {
  let entries = initial
  const unseal = <T,>(): T =>
    ({ v: 1, secretBase32: 'JBSWY3DPEHPK3PXP' }) as T
  const store = {
    loadStrict: vi.fn(async () => entries),
    save: vi.fn(async (next: SealedEntry<AuthenticatorEntry>[]) => {
      entries = next
    }),
    seal: vi.fn(() => 'sealed-new'),
    unseal
  }
  return { store, read: () => entries, replace: (next: SealedEntry<AuthenticatorEntry>[]) => (entries = next) }
}

describe('authenticator conditional seed removal', () => {
  beforeEach(() => handlers.clear())

  it('binds removal to an opaque generation which includes the sealed seed bytes', async () => {
    const fake = fakeStore([{ meta: { ...META }, secretEnc: 'sealed-generation-a' }])
    startAuthenticatorService(fake.store)
    const list = handler<() => Promise<AuthenticatorEntry[]>>(IPC.authenticatorList)
    const remove = handler<(expected: AuthenticatorEntry) => Promise<AuthenticatorRemoveResult>>(
      IPC.authenticatorRemove
    )
    const [disclosed] = await list()

    // Another window replaced only the sealed seed while preserving every public label and id.
    fake.replace([{ meta: { ...META }, secretEnc: 'sealed-generation-b' }])
    await expect(remove(disclosed)).resolves.toEqual({ ok: false, error: 'changed' })
    expect(fake.store.save).not.toHaveBeenCalled()
    expect(fake.read()).toHaveLength(1)
  })

  it('rejects an unreadable store instead of reporting a successful absence', async () => {
    const fake = fakeStore([{ meta: { ...META }, secretEnc: 'sealed-generation-a' }])
    fake.store.loadStrict.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
    startAuthenticatorService(fake.store)
    const remove = handler<(expected: AuthenticatorEntry) => Promise<AuthenticatorRemoveResult>>(
      IPC.authenticatorRemove
    )

    await expect(remove({ ...META, revision: 'any' })).rejects.toThrow(/denied/i)
    expect(fake.store.save).not.toHaveBeenCalled()
    expect(fake.read()).toHaveLength(1)
  })

  it('serializes rename and remove so a stale confirmation cannot overwrite the rename', async () => {
    const fake = fakeStore([{ meta: { ...META }, secretEnc: 'sealed-generation-a' }])
    startAuthenticatorService(fake.store)
    const list = handler<() => Promise<AuthenticatorEntry[]>>(IPC.authenticatorList)
    const rename = handler<
      (input: { id: string; account: string }) => Promise<AuthenticatorEntry | null>
    >(IPC.authenticatorRename)
    const remove = handler<(expected: AuthenticatorEntry) => Promise<AuthenticatorRemoveResult>>(
      IPC.authenticatorRemove
    )
    const [disclosed] = await list()

    const renamed = rename({ id: META.id, account: 'renamed@example.test' })
    const staleRemoval = remove(disclosed)
    await expect(renamed).resolves.toMatchObject({ account: 'renamed@example.test' })
    await expect(staleRemoval).resolves.toEqual({ ok: false, error: 'changed' })
    expect(fake.read()).toHaveLength(1)
    expect(fake.read()[0].meta.account).toBe('renamed@example.test')
  })
})
