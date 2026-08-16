import { describe, expect, it, vi } from 'vitest'

import {
  createDestructiveCommitBarrier,
  destructiveTargetIdentity,
  type LiveDestructiveTarget
} from './destructiveAuthorization'

function live<T>(identity: string, target: T, kidsGateRequired = false): LiveDestructiveTarget<T> {
  return { identity, target, kidsGateRequired }
}

describe('live destructive commit barrier', () => {
  it('performs once when the disclosed target and live policy still match', () => {
    const perform = vi.fn()
    const commit = createDestructiveCommitBarrier({
      disclosedIdentity: 'node:a',
      authorization: 'ordinary',
      readCurrent: () => live('node:a', { id: 'a' }),
      perform,
      upgradeToTwoKey: vi.fn()
    })

    expect(commit()).toBe('performed')
    expect(commit()).toBe('already-settled')
    expect(perform).toHaveBeenCalledOnce()
    expect(perform).toHaveBeenCalledWith({ id: 'a' })
  })

  it('performs nothing when the id now describes a different disclosed target', () => {
    const perform = vi.fn()
    const refuse = vi.fn()
    const commit = createDestructiveCommitBarrier({
      disclosedIdentity: destructiveTargetIdentity(['node', 'a', 'Old title']),
      authorization: 'two-key',
      readCurrent: () =>
        live(destructiveTargetIdentity(['node', 'a', 'Replacement title']), { id: 'a' }),
      perform,
      upgradeToTwoKey: vi.fn(),
      refuse
    })

    expect(commit()).toBe('target-changed')
    expect(perform).not.toHaveBeenCalled()
    expect(refuse).toHaveBeenCalledWith('target-changed')
  })

  it.each([
    ['missing', (): null => null],
    ['failed read', (): never => { throw new Error('store unavailable') }]
  ] as const)('fails closed when the current target is %s', (_label, readCurrent) => {
    const perform = vi.fn()
    const refuse = vi.fn()
    const commit = createDestructiveCommitBarrier({
      disclosedIdentity: 'account:a',
      authorization: 'two-key',
      readCurrent,
      perform,
      upgradeToTwoKey: vi.fn(),
      refuse
    })

    expect(commit()).toBe('target-unavailable')
    expect(perform).not.toHaveBeenCalled()
    expect(refuse).toHaveBeenCalledWith('target-unavailable')
  })

  it('replaces a stale ordinary approval with a fresh two-key request on a live policy transition', () => {
    const target = { id: 'a' }
    const perform = vi.fn()
    const upgrade = vi.fn()
    const commit = createDestructiveCommitBarrier({
      disclosedIdentity: 'node:a',
      authorization: 'ordinary',
      readCurrent: () => live('node:a', target, true),
      perform,
      upgradeToTwoKey: upgrade
    })

    expect(commit()).toBe('upgraded-to-two-key')
    expect(perform).not.toHaveBeenCalled()
    expect(upgrade).toHaveBeenCalledWith(target)
  })

  it('keeps a completed two-key authorization strong enough after the policy relaxes', () => {
    const perform = vi.fn()
    const commit = createDestructiveCommitBarrier({
      disclosedIdentity: 'node:a',
      authorization: 'two-key',
      readCurrent: () => live('node:a', { id: 'a' }, false),
      perform,
      upgradeToTwoKey: vi.fn()
    })

    expect(commit()).toBe('performed')
    expect(perform).toHaveBeenCalledOnce()
  })
})
