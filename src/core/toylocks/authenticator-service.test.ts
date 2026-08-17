import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AuthenticatorEntry,
  AuthenticatorRemoveInput,
  AuthenticatorRemoveResult,
  AuthenticatorRenameInput
} from '../../shared/authenticator'
import { IPC } from '../../shared/ipc'
import type { SealedEntry, SecureStoreMutation } from '../secure-store'

const handlers = new Map<string, (...args: never[]) => unknown>()

vi.mock('../platform', () => ({
  platform: () => ({
    handle: (channel: string, handler: (...args: never[]) => unknown) => handlers.set(channel, handler)
  })
}))

const { startAuthenticatorService } = await import('./authenticator-service')

// What the store actually persists on disk: metadata WITHOUT the revision, which is a
// core-computed digest of the metadata + sealed seed bytes (see publicEntry() in
// authenticator-service.ts) rather than a value anything ever writes to the file.
type StoredMeta = Omit<AuthenticatorEntry, 'revision'>

const META: StoredMeta = {
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

/** A minimal in-memory stand-in for SecureStore<StoredMeta>'s 'load' | 'mutate' | 'seal' | 'unseal'
 *  surface (the exact shape authenticator-service.ts's AuthenticatorStore type picks). `mutate`
 *  calls the mutation function synchronously against the live `entries` array — the same guarantee
 *  the real SecureStore.mutate gives via its per-file operation queue — so two mutate() calls made
 *  back-to-back with no await between them still observe each other's effect in order. */
function fakeStore(initial: SealedEntry<StoredMeta>[]) {
  let entries = initial
  let rejectNextMutate: Error | null = null
  const mutate = async <TResult,>(
    mutation: (
      entries: SealedEntry<StoredMeta>[]
    ) => SecureStoreMutation<TResult> | Promise<SecureStoreMutation<TResult>>
  ): Promise<TResult> => {
    if (rejectNextMutate) {
      const err = rejectNextMutate
      rejectNextMutate = null
      throw err
    }
    const change = await mutation(entries)
    return change.result
  }
  const store = {
    load: vi.fn(async () => entries),
    mutate,
    seal: vi.fn(() => 'sealed-new'),
    unseal: <T,>(): T => ({ v: 1, secretBase32: 'JBSWY3DPEHPK3PXP' }) as T
  }
  return {
    store,
    read: () => entries,
    replace: (next: SealedEntry<StoredMeta>[]) => (entries = next),
    rejectNextMutate: (err: Error) => (rejectNextMutate = err)
  }
}

describe('authenticator conditional seed removal', () => {
  beforeEach(() => handlers.clear())

  it('binds removal to an opaque generation which includes the sealed seed bytes', async () => {
    const fake = fakeStore([{ meta: { ...META }, secretEnc: 'sealed-generation-a' }])
    startAuthenticatorService(fake.store)
    const list = handler<() => Promise<AuthenticatorEntry[]>>(IPC.authenticatorList)
    const remove = handler<(input: AuthenticatorRemoveInput) => Promise<AuthenticatorRemoveResult>>(
      IPC.authenticatorRemove
    )
    const [disclosed] = await list()

    // Another window replaced only the sealed seed while preserving every public label and id.
    fake.replace([{ meta: { ...META }, secretEnc: 'sealed-generation-b' }])
    await expect(remove({ id: disclosed.id, revision: disclosed.revision })).resolves.toEqual({
      ok: false,
      error: 'changed',
      message: 'This authenticator entry changed after the confirmation opened. Review it and try again.'
    })
    expect(fake.read()).toHaveLength(1)
    expect(fake.read()[0].secretEnc).toBe('sealed-generation-b')
  })

  it('rejects an unreadable store instead of reporting a successful absence', async () => {
    const fake = fakeStore([{ meta: { ...META }, secretEnc: 'sealed-generation-a' }])
    fake.rejectNextMutate(Object.assign(new Error('denied'), { code: 'EACCES' }))
    startAuthenticatorService(fake.store)
    const remove = handler<(input: AuthenticatorRemoveInput) => Promise<AuthenticatorRemoveResult>>(
      IPC.authenticatorRemove
    )

    await expect(remove({ id: META.id, revision: 'any' })).rejects.toThrow(/denied/i)
    expect(fake.read()).toHaveLength(1)
  })

  it('serializes rename and remove so a stale confirmation cannot overwrite the rename', async () => {
    const fake = fakeStore([{ meta: { ...META }, secretEnc: 'sealed-generation-a' }])
    startAuthenticatorService(fake.store)
    const list = handler<() => Promise<AuthenticatorEntry[]>>(IPC.authenticatorList)
    const rename = handler<(input: AuthenticatorRenameInput) => Promise<AuthenticatorEntry | null>>(
      IPC.authenticatorRename
    )
    const remove = handler<(input: AuthenticatorRemoveInput) => Promise<AuthenticatorRemoveResult>>(
      IPC.authenticatorRemove
    )
    const [disclosed] = await list()

    const renamed = rename({ id: META.id, account: 'renamed@example.test' })
    const staleRemoval = remove({ id: disclosed.id, revision: disclosed.revision })
    await expect(renamed).resolves.toMatchObject({ account: 'renamed@example.test' })
    await expect(staleRemoval).resolves.toEqual({
      ok: false,
      error: 'changed',
      message: 'This authenticator entry changed after the confirmation opened. Review it and try again.'
    })
    expect(fake.read()).toHaveLength(1)
    expect(fake.read()[0].meta.account).toBe('renamed@example.test')
  })
})
