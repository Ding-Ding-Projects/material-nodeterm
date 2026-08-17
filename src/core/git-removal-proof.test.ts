import { describe, expect, it } from 'vitest'

import { gitRemovalFingerprint, type GitRemovalFingerprintInput } from './git-removal-proof'

const BASE: GitRemovalFingerprintInput = {
  headOid: 'a'.repeat(40),
  index: '100644 deadbeef 0\ta.txt\0',
  cachedDiff: '',
  worktreeDiff: '',
  porcelain: '',
  untracked: '',
  generation: 'root:1|gitdir:2'
}

describe('worktree removal fingerprint', () => {
  it.each<keyof GitRemovalFingerprintInput>([
    'headOid',
    'index',
    'cachedDiff',
    'worktreeDiff',
    'porcelain',
    'untracked',
    'generation'
  ])('changes when %s changes', (field) => {
    expect(gitRemovalFingerprint({ ...BASE, [field]: `${BASE[field]}changed` })).not.toBe(
      gitRemovalFingerprint(BASE)
    )
  })
})
