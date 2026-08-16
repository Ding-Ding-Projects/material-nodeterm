import type { GroupWorktree } from '@shared/worktree'
import type { GitStatus } from '@shared/types'
import { requiresDestructiveGate } from '@shared/kids-mode-policy'
import {
  createDestructiveCommitBarrier,
  destructiveTargetIdentity,
  type DestructiveAuthorization,
  type DestructiveCommitRefusal,
  type DestructiveCommitResult
} from './destructiveAuthorization'

export interface WorktreeRemovalTarget {
  projectId: string
  groupId: string
  groupIncarnation: number
  /** Exact live nodes whose cwd/file disclosure is affected by deleting this checkout. */
  affectedNodes: string[]
  worktree: GroupWorktree
}

export function worktreeRemovalTargetIdentity(target: WorktreeRemovalTarget): string {
  const { worktree } = target
  return destructiveTargetIdentity([
    target.projectId,
    target.groupId,
    target.groupIncarnation,
    ...[...target.affectedNodes].sort(),
    worktree.bindingId,
    worktree.repoPath,
    worktree.path,
    worktree.branch,
    worktree.baseRef,
    worktree.createdByApp
  ])
}

export function sameWorktreeRemovalTarget(
  disclosed: WorktreeRemovalTarget,
  current: WorktreeRemovalTarget | null
): boolean {
  return !!current && worktreeRemovalTargetIdentity(current) === worktreeRemovalTargetIdentity(disclosed)
}

/** The dirty-work disclosure which must still describe the directory immediately before removal. */
export function worktreeRemovalStatusIdentity(
  status: Pick<GitStatus, 'hasRepo' | 'branch' | 'staged' | 'changes' | 'authoritative' | 'removalProof'>
): string {
  const files = [...status.staged.map((change) => ['staged', change]), ...status.changes.map((change) => ['worktree', change])]
    .map(([area, change]) => {
      const file = change as GitStatus['changes'][number]
      return destructiveTargetIdentity([area as string, file.path, file.status, file.added, file.deleted])
    })
    .sort()
  return destructiveTargetIdentity([
    status.hasRepo,
    status.authoritative,
    status.branch,
    status.removalProof?.headOid,
    status.removalProof?.generation,
    status.removalProof?.fingerprint,
    ...files
  ])
}

export function worktreeRemovalStatusUsable(
  status: Pick<GitStatus, 'hasRepo' | 'authoritative' | 'removalProof'> | null
): status is Pick<GitStatus, 'hasRepo' | 'authoritative' | 'removalProof'> & {
  hasRepo: true
  authoritative: true
  removalProof: NonNullable<GitStatus['removalProof']>
} {
  return !!(
    status?.hasRepo === true &&
    status.authoritative === true &&
    status.removalProof?.headOid &&
    status.removalProof.generation &&
    status.removalProof.fingerprint
  )
}

/** Only disk removal is destructive; leaving the checkout in place is a plain unbind. */
export function worktreeDiskRemovalNeedsTwoKey(
  deleteFromDisk: boolean,
  kidsGateRequired: boolean
): boolean {
  return deleteFromDisk && requiresDestructiveGate('remove-worktree', kidsGateRequired).required
}

export interface WorktreeRemovalCommitBarrierOptions {
  disclosedTarget: WorktreeRemovalTarget
  authorization: DestructiveAuthorization
  readCurrent(): WorktreeRemovalTarget | null
  kidsGateRequired(): boolean
  perform(target: WorktreeRemovalTarget): void
  upgradeToTwoKey(target: WorktreeRemovalTarget): void
  refuse?(reason: DestructiveCommitRefusal): void
}

/** Behavior-tested commit seam used by both the plain option dialog and the two-key gate. */
export function createWorktreeRemovalCommitBarrier(
  options: WorktreeRemovalCommitBarrierOptions
): () => DestructiveCommitResult {
  return createDestructiveCommitBarrier({
    disclosedIdentity: worktreeRemovalTargetIdentity(options.disclosedTarget),
    authorization: options.authorization,
    readCurrent: () => {
      const current = options.readCurrent()
      return current
        ? {
            identity: worktreeRemovalTargetIdentity(current),
            target: current,
            kidsGateRequired: worktreeDiskRemovalNeedsTwoKey(true, options.kidsGateRequired())
          }
        : null
    },
    perform: options.perform,
    upgradeToTwoKey: options.upgradeToTwoKey,
    refuse: options.refuse
  })
}
