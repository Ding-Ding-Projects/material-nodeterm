import { describe, expect, it } from 'vitest'
import { isNodeLockEngaged, nodeLockTeardownMode } from './toylock'

describe('isNodeLockEngaged', () => {
  it('fails LOCKED while the store has never loaded, regardless of the other inputs', () => {
    expect(isNodeLockEngaged({ storeLoaded: false, hasRecord: false, unlockedNow: false })).toBe(true)
    expect(isNodeLockEngaged({ storeLoaded: false, hasRecord: false, unlockedNow: true })).toBe(true)
    expect(isNodeLockEngaged({ storeLoaded: false, hasRecord: true, unlockedNow: true })).toBe(true)
  })

  it('is not engaged once loaded when this node has no lock record at all', () => {
    expect(isNodeLockEngaged({ storeLoaded: true, hasRecord: false, unlockedNow: false })).toBe(false)
  })

  it('is engaged once loaded when a record exists and is not currently unlocked', () => {
    expect(isNodeLockEngaged({ storeLoaded: true, hasRecord: true, unlockedNow: false })).toBe(true)
  })

  it('is not engaged once loaded when a record exists and IS currently unlocked', () => {
    expect(isNodeLockEngaged({ storeLoaded: true, hasRecord: true, unlockedNow: true })).toBe(false)
  })
})

describe('nodeLockTeardownMode', () => {
  it('releases the client for a persistent (tmux / session-host) session — nothing is at risk', () => {
    expect(nodeLockTeardownMode(true)).toBe('release-client')
  })

  it('only detaches the view for a non-persistent (plain-shell) session — the pty IS the process', () => {
    expect(nodeLockTeardownMode(false)).toBe('detach-view-only')
  })
})
