import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ToyLockRecord } from '@shared/toylock'
import { useToyLocks } from './toylocks'

const EXISTING_LOCK: ToyLockRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  target: { kind: 'tab', id: 'tab-one', label: 'Known tab' },
  credentialKind: 'password',
  createdAt: 1,
  duration: 'session',
  lockedOnLaunch: true
}

const RELOADED_LOCK: ToyLockRecord = {
  ...EXISTING_LOCK,
  id: '22222222-2222-4222-8222-222222222222',
  target: { kind: 'node', id: 'node-two', label: 'Reloaded node' }
}

function resetStore(): void {
  useToyLocks.setState({
    records: [],
    loaded: false,
    loadError: null,
    unlockedUntil: {}
  })
}

describe('toy-lock credential-store recovery', () => {
  beforeEach(resetStore)

  afterEach(() => {
    resetStore()
    vi.unstubAllGlobals()
  })

  it('retains last-known locks and records an unknown state when the strict load rejects', async () => {
    const list = vi.fn(async (): Promise<ToyLockRecord[]> => {
      throw new Error('EACCES')
    })
    vi.stubGlobal('window', { nodeTerminal: { toylock: { list } } })
    useToyLocks.setState({ records: [EXISTING_LOCK] })

    await useToyLocks.getState().refresh()

    expect(list).toHaveBeenCalledOnce()
    expect(useToyLocks.getState()).toMatchObject({
      records: [EXISTING_LOCK],
      loaded: true,
      loadError: 'Could not read the toy-lock credential store.'
    })
  })

  it('replaces stale records and clears the error after a later successful load', async () => {
    const list = vi.fn(async () => [RELOADED_LOCK])
    vi.stubGlobal('window', { nodeTerminal: { toylock: { list } } })
    useToyLocks.setState({
      records: [EXISTING_LOCK],
      loaded: true,
      loadError: 'Could not read the toy-lock credential store.'
    })

    await useToyLocks.getState().refresh()

    expect(useToyLocks.getState()).toMatchObject({
      records: [RELOADED_LOCK],
      loaded: true,
      loadError: null
    })
  })
})
