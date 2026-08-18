import { describe, expect, it } from 'vitest'
import { createNodeUnlockRegistry } from './node-unlock-registry'

const LOCKED = () => true
const UNLOCKED_TARGET = () => false

describe('node unlock registry', () => {
  it('never blocks a node that has no lock record', () => {
    const reg = createNodeUnlockRegistry(() => 1000)
    expect(reg.mayWrite('n1', UNLOCKED_TARGET)).toBe(true)
  })

  it('blocks a locked node with no live unlock — the locked-on-launch default', () => {
    // A fresh process has an empty registry by construction, so every locked node starts blocked.
    // This is the dictation bypass closing: core no longer assumes writable.
    const reg = createNodeUnlockRegistry(() => 1000)
    expect(reg.mayWrite('n1', LOCKED)).toBe(false)
  })

  it('allows writes while an unlock is live, and re-blocks after relock', () => {
    const reg = createNodeUnlockRegistry(() => 1000)
    reg.markUnlocked('lock-a', 'n1', Infinity)
    expect(reg.mayWrite('n1', LOCKED)).toBe(true)
    reg.relock('lock-a')
    expect(reg.mayWrite('n1', LOCKED)).toBe(false)
  })

  it('expires a minutes-mode unlock on read, with no timer', () => {
    let t = 1000
    const reg = createNodeUnlockRegistry(() => t)
    reg.markUnlocked('lock-a', 'n1', 2000)
    expect(reg.mayWrite('n1', LOCKED)).toBe(true)
    t = 2000
    // `<` not `<=`: at the exact expiry instant the unlock is over. A stale entry authorizing one
    // more write at the boundary is exactly the class of leak the registry exists to stop.
    expect(reg.mayWrite('n1', LOCKED)).toBe(false)
  })

  it('an unlock for one node never authorizes another', () => {
    const reg = createNodeUnlockRegistry(() => 1000)
    reg.markUnlocked('lock-a', 'n1', Infinity)
    expect(reg.mayWrite('n2', LOCKED)).toBe(false)
  })

  it('drop removes the entry so a deleted lock cannot leave a ghost unlock', () => {
    const reg = createNodeUnlockRegistry(() => 1000)
    reg.markUnlocked('lock-a', 'n1', Infinity)
    reg.drop('lock-a')
    // The lock record is gone too, so hasLock is false and writes flow — but if a NEW lock is
    // created for the same node, the old entry must not resurrect as its unlock.
    expect(reg.mayWrite('n1', LOCKED)).toBe(false)
  })

  it('re-marking replaces the entry rather than accumulating', () => {
    let t = 1000
    const reg = createNodeUnlockRegistry(() => t)
    reg.markUnlocked('lock-a', 'n1', 1500)
    reg.markUnlocked('lock-a', 'n1', 3000)
    t = 2000
    expect(reg.mayWrite('n1', LOCKED)).toBe(true)
  })
})
