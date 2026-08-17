import { describe, expect, it, vi } from 'vitest'

import {
  createDestructiveCommitBarrier,
  destructiveTargetIdentity,
  type LiveDestructiveTarget
} from './destructiveAuthorization'

const live = <T>(
  identity: string,
  target: T,
  kidsGateRequired = false
): LiveDestructiveTarget<T> => ({ identity, target, kidsGateRequired })

describe('destructive commit authorization', () => {
  it('performs the exact disclosed target once', () => {
    const target = { projectId: 'project-a', nodeId: 'node-a', incarnation: 4 }
    const perform = vi.fn()
    const commit = createDestructiveCommitBarrier({
      disclosedIdentity: destructiveTargetIdentity(Object.values(target)),
      authorization: 'ordinary',
      readCurrent: () => live(destructiveTargetIdentity(Object.values(target)), target),
      perform,
      upgradeToTwoKey: vi.fn()
    })

    expect(commit()).toBe('performed')
    expect(commit()).toBe('already-settled')
    expect(perform).toHaveBeenCalledOnce()
    expect(perform).toHaveBeenCalledWith(target)
  })

  it('performs nothing when an id now names another incarnation', () => {
    const perform = vi.fn()
    const refuse = vi.fn()
    const commit = createDestructiveCommitBarrier({
      disclosedIdentity: destructiveTargetIdentity(['project-a', 'node-a', 1]),
      authorization: 'two-key',
      readCurrent: () =>
        live(destructiveTargetIdentity(['project-a', 'node-a', 2]), {
          projectId: 'project-a',
          nodeId: 'node-a',
          incarnation: 2
        }),
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
    ['unreadable', (): never => { throw new Error('live store unreadable') }]
  ] as const)('fails closed when the live target is %s', (_label, readCurrent) => {
    const perform = vi.fn()
    const refuse = vi.fn()
    const commit = createDestructiveCommitBarrier({
      disclosedIdentity: 'target',
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

  it('upgrades an ordinary approval when authoritative policy tightens', () => {
    const target = { id: 'node-a' }
    const perform = vi.fn()
    const upgrade = vi.fn()
    const commit = createDestructiveCommitBarrier({
      disclosedIdentity: 'node-a',
      authorization: 'ordinary',
      readCurrent: () => live('node-a', target, true),
      perform,
      upgradeToTwoKey: upgrade
    })

    expect(commit()).toBe('upgraded-to-two-key')
    expect(perform).not.toHaveBeenCalled()
    expect(upgrade).toHaveBeenCalledWith(target)
  })

  it('does not weaken an already completed two-key approval when policy relaxes', () => {
    const perform = vi.fn()
    const commit = createDestructiveCommitBarrier({
      disclosedIdentity: 'node-a',
      authorization: 'two-key',
      readCurrent: () => live('node-a', { id: 'node-a' }, false),
      perform,
      upgradeToTwoKey: vi.fn()
    })

    expect(commit()).toBe('performed')
    expect(perform).toHaveBeenCalledOnce()
  })

  it('settles before a caller-controlled callback can re-enter it', () => {
    const perform = vi.fn()
    let commit!: () => unknown
    const readCurrent = vi.fn(() => {
      expect(commit()).toBe('already-settled')
      return live('node-a', { id: 'node-a' })
    })
    commit = createDestructiveCommitBarrier({
      disclosedIdentity: 'node-a',
      authorization: 'ordinary',
      readCurrent,
      perform,
      upgradeToTwoKey: vi.fn()
    })

    expect(commit()).toBe('performed')
    expect(readCurrent).toHaveBeenCalledOnce()
    expect(perform).toHaveBeenCalledOnce()
  })
})
