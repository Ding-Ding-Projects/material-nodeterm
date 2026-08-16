import { describe, expect, it, vi } from 'vitest'
import type { GitWorktreeRemovalProof } from '@shared/types'

import {
  createWorktreeDiskRemovalCommit,
  createWorktreeRemovalCommitBarrier,
  sameWorktreeRemovalBinding,
  worktreeDiskRemovalNeedsTwoKey,
  worktreeRemovalProofForTarget,
  worktreeRemovalProofWarning,
  worktreeRemovalTargetIdentity,
  type WorktreeRemovalTarget
} from './worktreeRemoval'

const target = (overrides: Partial<WorktreeRemovalTarget> = {}): WorktreeRemovalTarget => ({
  projectId: 'project-a',
  groupId: 'group-a',
  groupIncarnation: 1,
  affectedNodes: [{ id: 'node-a', incarnation: 3, cwd: '/worktrees/feature' }],
  worktree: {
    bindingId: 'binding-a',
    repoPath: '/repo',
    path: '/worktrees/feature',
    branch: 'feature',
    baseRef: 'main',
    createdByApp: true
  },
  ...overrides
})

const proof = (overrides: Partial<GitWorktreeRemovalProof> = {}): GitWorktreeRemovalProof => ({
  version: 1,
  token: 'one-shot-token',
  fingerprint: 'fingerprint-a',
  repoPath: '/repo',
  worktreePath: '/worktrees/feature',
  commonDir: '/repo/.git',
  adminDir: '/repo/.git/worktrees/feature',
  branchRef: 'refs/heads/feature',
  branchTip: 'abc123',
  summary: {
    trackedFiles: 4,
    untrackedFiles: 1,
    ignoredFiles: 2,
    otherFiles: 0,
    symlinks: 1,
    directories: 3,
    bytes: 512
  },
  ownership: {
    ownershipId: 'ownership-a',
    directoryCreatedByApp: true,
    branchCreatedByApp: true
  },
  ...overrides
})

describe('worktree removal target and policy', () => {
  it('binds project, group/node incarnations, binding id, and every disk target field', () => {
    const original = worktreeRemovalTargetIdentity(target())
    const variants = [
      target({ projectId: 'project-b' }),
      target({ groupId: 'group-b' }),
      target({ groupIncarnation: 2 }),
      target({ affectedNodes: [{ id: 'node-a', incarnation: 4 }] }),
      target({ worktree: { ...target().worktree, bindingId: 'binding-b' } }),
      target({ worktree: { ...target().worktree, path: '/worktrees/replacement' } }),
      target({ worktree: { ...target().worktree, branch: 'replacement' } })
    ]
    for (const variant of variants) expect(worktreeRemovalTargetIdentity(variant)).not.toBe(original)
  })

  it('keeps post-ack binding identity stable across incidental affected-node UI drift', () => {
    const disclosed = target()
    expect(
      sameWorktreeRemovalBinding(disclosed, target({
        groupIncarnation: 2,
        affectedNodes: [{ id: 'node-a', incarnation: 99, cwd: '/worktrees/feature' }]
      }))
    ).toBe(true)
    expect(
      sameWorktreeRemovalBinding(disclosed, target({
        worktree: { ...disclosed.worktree, bindingId: 'replacement-binding' }
      }))
    ).toBe(false)
  })

  it('requires authoritative exact proof paths and branch ref', () => {
    const disclosed = target()
    expect(worktreeRemovalProofForTarget({ ok: true, message: 'ok', proof: proof() }, disclosed)).toEqual(proof())
    expect(worktreeRemovalProofForTarget({ ok: false, message: 'unreadable' }, disclosed)).toBeNull()
    expect(worktreeRemovalProofForTarget({ ok: true, message: 'wrong', proof: proof({ worktreePath: '/other' }) }, disclosed)).toBeNull()
    expect(worktreeRemovalProofForTarget({ ok: true, message: 'wrong', proof: proof({ branchRef: 'refs/heads/other' }) }, disclosed)).toBeNull()
  })

  it('renders the complete proof summary without pretending ignored files are absent', () => {
    expect(worktreeRemovalProofWarning(proof())).toContain('7 file(s)')
    expect(worktreeRemovalProofWarning(proof())).toContain('1 untracked')
    expect(worktreeRemovalProofWarning(proof())).toContain('2 ignored')
    expect(worktreeRemovalProofWarning(proof())).toContain('512 byte(s)')
  })

  it('gates disk removal under fail-closed Kids policy but never gates unbind', () => {
    expect(worktreeDiskRemovalNeedsTwoKey(true, true)).toBe(true)
    expect(worktreeDiskRemovalNeedsTwoKey(true, false)).toBe(false)
    expect(worktreeDiskRemovalNeedsTwoKey(false, true)).toBe(false)
  })

  it('upgrades an ordinary approval instead of deleting after policy tightens', () => {
    const disclosed = target()
    const perform = vi.fn()
    const upgrade = vi.fn()
    const commit = createWorktreeRemovalCommitBarrier({
      disclosedTarget: disclosed,
      authorization: 'ordinary',
      readCurrent: () => disclosed,
      kidsGateRequired: () => true,
      perform,
      upgradeToTwoKey: upgrade
    })

    expect(commit()).toBe('upgraded-to-two-key')
    expect(perform).not.toHaveBeenCalled()
    expect(upgrade).toHaveBeenCalledWith(disclosed)
  })
})

describe('post-confirm worktree proof transaction', () => {
  const setup = (overrides: Partial<Parameters<typeof createWorktreeDiskRemovalCommit<string>>[0]> = {}) => {
    const disclosedTarget = target()
    const disclosedProof = proof()
    const remove = vi.fn(async (
      _target: WorktreeRemovalTarget,
      _proof: GitWorktreeRemovalProof
    ) => 'removed')
    const options: Parameters<typeof createWorktreeDiskRemovalCommit<string>>[0] = {
      disclosedTarget,
      disclosedProof,
      authorization: 'two-key',
      readCurrent: () => disclosedTarget,
      kidsGateRequired: () => true,
      readProof: async () => ({ ok: true, message: 'fresh', proof: proof({ token: 'fresh-token' }) }),
      remove,
      upgradeToTwoKey: vi.fn(),
      refuse: vi.fn(),
      ...overrides
    }
    return { commit: createWorktreeDiskRemovalCommit(options), remove, options }
  }

  it('rechecks after confirmation and forwards the exact fresh one-shot proof once', async () => {
    const run = setup()
    await expect(run.commit()).resolves.toEqual({ kind: 'performed', result: 'removed' })
    await expect(run.commit()).resolves.toEqual({ kind: 'already-settled' })
    expect(run.remove).toHaveBeenCalledOnce()
    expect(run.remove.mock.calls[0][1].token).toBe('fresh-token')
  })

  it.each([
    ['proof rejection', { readProof: async () => { throw new Error('unreadable') } }, 'proof-unavailable'],
    ['missing proof', { readProof: async () => ({ ok: false, message: 'unreadable' }) }, 'proof-unavailable'],
    ['content drift', { readProof: async () => ({ ok: true, message: 'changed', proof: proof({ fingerprint: 'fingerprint-b' }) }) }, 'proof-changed']
  ] as const)('%s performs zero mutation', async (_label, override, expected) => {
    const run = setup(override)
    await expect(run.commit()).resolves.toEqual({ kind: expected })
    expect(run.remove).not.toHaveBeenCalled()
  })

  it('revalidates the exact binding after the asynchronous proof read', async () => {
    const disclosed = target()
    let reads = 0
    const run = setup({
      disclosedTarget: disclosed,
      readCurrent: () => {
        reads += 1
        return reads === 1
          ? disclosed
          : target({ worktree: { ...disclosed.worktree, bindingId: 'replacement' } })
      }
    })

    await expect(run.commit()).resolves.toEqual({ kind: 'target-changed' })
    expect(run.remove).not.toHaveBeenCalled()
  })

  it('upgrades if authoritative Kids policy tightens while the proof read is pending', async () => {
    let policyReads = 0
    const upgrade = vi.fn()
    const run = setup({
      authorization: 'ordinary',
      kidsGateRequired: () => ++policyReads > 1,
      upgradeToTwoKey: upgrade
    })

    await expect(run.commit()).resolves.toEqual({ kind: 'upgraded-to-two-key' })
    expect(run.remove).not.toHaveBeenCalled()
    expect(upgrade).toHaveBeenCalledOnce()
  })
})
