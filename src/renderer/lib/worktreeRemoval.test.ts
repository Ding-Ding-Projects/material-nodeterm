import { describe, expect, it, vi } from 'vitest'
import type { GroupWorktree } from '@shared/worktree'
import type { GitStatus } from '@shared/types'

import {
  worktreeDiskRemovalNeedsTwoKey,
  createWorktreeRemovalCommitBarrier,
  sameWorktreeRemovalTarget,
  worktreeRemovalStatusIdentity,
  worktreeRemovalStatusUsable,
  worktreeRemovalTargetIdentity
} from './worktreeRemoval'

const WORKTREE: GroupWorktree = {
  bindingId: 'binding-1',
  repoPath: '/repo',
  path: '/worktrees/feature',
  branch: 'feature',
  baseRef: 'main',
  createdByApp: true
}

const target = (worktree: GroupWorktree = WORKTREE) => ({
  projectId: 'project',
  groupId: 'group',
  groupIncarnation: 1,
  affectedNodes: ['node-generation-1'],
  worktree
})

describe('worktree removal commit policy', () => {
  it('sends disk deletion through the same two-key Kids gate for app-created and adopted worktrees', () => {
    expect(worktreeDiskRemovalNeedsTwoKey(true, true)).toBe(true)
    // Ownership is intentionally absent from the policy input: it changes branch cleanup, not the
    // authorization required to delete either directory.
  })

  it('does not gate a non-destructive unbind', () => {
    expect(worktreeDiskRemovalNeedsTwoKey(false, true)).toBe(false)
  })

  it('keeps the known-off ordinary confirmation contract', () => {
    expect(worktreeDiskRemovalNeedsTwoKey(true, false)).toBe(false)
  })

  it('changes identity when the group is rebound or any disk target fact changes', () => {
    const original = worktreeRemovalTargetIdentity(target())
    const variants = [
      { ...target(), projectId: 'other-project' },
      { ...target(), groupId: 'other-group' },
      { ...target(), groupIncarnation: 2 },
      { ...target(), affectedNodes: ['node-generation-2'] },
      target({ ...WORKTREE, bindingId: 'binding-2' }),
      target({ ...WORKTREE, repoPath: '/other-repo' }),
      target({ ...WORKTREE, path: '/other' }),
      target({ ...WORKTREE, branch: 'replacement' }),
      target({ ...WORKTREE, baseRef: 'release' }),
      target({ ...WORKTREE, createdByApp: false })
    ]
    for (const variant of variants) {
      expect(worktreeRemovalTargetIdentity(variant)).not.toBe(original)
    }
  })

  it('changes the final disclosure identity when worktree contents mutate', () => {
    const clean: Pick<GitStatus, 'hasRepo' | 'branch' | 'staged' | 'changes' | 'authoritative' | 'removalProof'> = {
      hasRepo: true,
      authoritative: true,
      removalProof: { headOid: 'head-a', generation: 'generation-a', fingerprint: 'content-a' },
      branch: 'feature',
      staged: [],
      changes: []
    }
    const dirty = {
      ...clean,
      changes: [{ path: 'new.txt', status: 'U', added: 1, deleted: 0 }]
    }

    expect(worktreeRemovalStatusIdentity(dirty)).not.toBe(worktreeRemovalStatusIdentity(clean))
    expect(
      worktreeRemovalStatusIdentity({
        ...dirty,
        changes: [{ ...dirty.changes[0], added: 2 }]
      })
    ).not.toBe(worktreeRemovalStatusIdentity(dirty))
    expect(worktreeRemovalStatusIdentity({
      ...clean,
      removalProof: { ...clean.removalProof!, fingerprint: 'content-b' }
    })).not.toBe(worktreeRemovalStatusIdentity(clean))
    expect(worktreeRemovalStatusUsable(clean)).toBe(true)
    expect(worktreeRemovalStatusUsable({ ...clean, authoritative: false })).toBe(false)
    expect(worktreeRemovalStatusUsable({ ...clean, hasRepo: false })).toBe(false)
  })

  it('upgrades instead of deleting when Kids safety tightens under the plain dialog', () => {
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

  it('performs zero disk removal after the group is rebound', () => {
    const disclosedTarget = target()
    const perform = vi.fn()
    const refuse = vi.fn()
    const commit = createWorktreeRemovalCommitBarrier({
      disclosedTarget,
      authorization: 'two-key',
      readCurrent: () => target({ ...WORKTREE, path: '/worktrees/replacement' }),
      kidsGateRequired: () => true,
      perform,
      upgradeToTwoKey: vi.fn(),
      refuse
    })

    expect(commit()).toBe('target-changed')
    expect(perform).not.toHaveBeenCalled()
    expect(refuse).toHaveBeenCalledWith('target-changed')
    expect(
      sameWorktreeRemovalTarget(disclosedTarget, target({ ...WORKTREE, path: '/worktrees/replacement' }))
    ).toBe(false)
  })
})
