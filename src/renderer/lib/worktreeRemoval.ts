import type {
  GitWorktreeRemovalProof,
  GitWorktreeRemovalProofResult
} from '@shared/types'
import type { GroupWorktree } from '@shared/worktree'
import { requiresDestructiveGate } from '@shared/kids-mode-policy'
import {
  createDestructiveCommitBarrier,
  destructiveTargetIdentity,
  type DestructiveAuthorization,
  type DestructiveCommitRefusal,
  type DestructiveCommitResult
} from './destructiveAuthorization'

export type IdentifiedGroupWorktree = GroupWorktree & { bindingId: string }

export interface WorktreeAffectedNode {
  id: string
  incarnation: number
  cwd?: string
  filePath?: string
}

export interface WorktreeRemovalTarget {
  projectId: string
  groupId: string
  groupIncarnation: number
  affectedNodes: WorktreeAffectedNode[]
  worktree: IdentifiedGroupWorktree
}

/** Stable binding identity used after core acknowledgement; incidental node UI drift is excluded. */
export function worktreeRemovalBindingIdentity(target: WorktreeRemovalTarget): string {
  const { worktree } = target
  return destructiveTargetIdentity([
    target.projectId,
    target.groupId,
    worktree.bindingId,
    worktree.repoPath,
    worktree.path,
    worktree.branch,
    worktree.baseRef,
    worktree.createdByApp
  ])
}

/** Full pre-mutation identity: project, group and affected-node incarnations plus exact binding. */
export function worktreeRemovalTargetIdentity(target: WorktreeRemovalTarget): string {
  const affected = [...target.affectedNodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((node) => [node.id, node.incarnation, node.cwd, node.filePath])
  return destructiveTargetIdentity([
    worktreeRemovalBindingIdentity(target),
    target.groupIncarnation,
    ...affected
  ])
}

export function sameWorktreeRemovalTarget(
  disclosed: WorktreeRemovalTarget,
  current: WorktreeRemovalTarget | null
): boolean {
  return !!current && worktreeRemovalTargetIdentity(current) === worktreeRemovalTargetIdentity(disclosed)
}

export function sameWorktreeRemovalBinding(
  disclosed: WorktreeRemovalTarget,
  current: WorktreeRemovalTarget | null
): boolean {
  return !!current && worktreeRemovalBindingIdentity(current) === worktreeRemovalBindingIdentity(disclosed)
}

/**
 * Validate that a core proof describes the exact disclosed physical target.
 *
 * The opaque token is intentionally not interpreted. The core consumes it once and independently
 * remeasures immediately before mutation; the renderer only checks the canonical disclosure facts.
 */
export function worktreeRemovalProofForTarget(
  result: GitWorktreeRemovalProofResult | null,
  target: WorktreeRemovalTarget
): GitWorktreeRemovalProof | null {
  const proof = result?.ok ? result.proof : undefined
  if (!proof || proof.version !== 1 || !proof.token || !proof.fingerprint) return null
  if (proof.repoPath !== target.worktree.repoPath) return null
  if (proof.worktreePath !== target.worktree.path) return null
  if (proof.branchRef !== `refs/heads/${target.worktree.branch}`) return null
  return proof
}

/** Fingerprint is the core-owned identity of every disclosed/live physical fact except the token. */
export function sameWorktreeRemovalProof(
  disclosed: GitWorktreeRemovalProof,
  current: GitWorktreeRemovalProof
): boolean {
  return disclosed.fingerprint === current.fingerprint
}

export function worktreeRemovalProofWarning(proof: GitWorktreeRemovalProof): string {
  const { summary } = proof
  const nonTracked = summary.untrackedFiles + summary.ignoredFiles + summary.otherFiles
  const totalFiles = summary.trackedFiles + nonTracked
  const details = [
    summary.untrackedFiles ? `${summary.untrackedFiles} untracked` : '',
    summary.ignoredFiles ? `${summary.ignoredFiles} ignored` : '',
    summary.otherFiles ? `${summary.otherFiles} other` : ''
  ].filter(Boolean)
  return (
    `Removal proof covers ${totalFiles} file(s), ${summary.directories} director${summary.directories === 1 ? 'y' : 'ies'}, ` +
    `${summary.symlinks} symlink(s), and ${summary.bytes} byte(s)` +
    (details.length ? ` (${details.join(', ')}).` : '.')
  )
}

/** Only disk removal is destructive; leaving the checkout in place remains a plain unbind. */
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

/** Synchronous target/policy boundary used immediately before any helper or bridge call. */
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

export type WorktreeDiskRemovalResult<TResult> =
  | { kind: 'performed'; result: TResult }
  | { kind: 'already-settled' }
  | { kind: 'upgraded-to-two-key' }
  | { kind: DestructiveCommitRefusal }
  | { kind: 'proof-unavailable' | 'proof-changed' }

export interface WorktreeDiskRemovalOptions<TResult> {
  disclosedTarget: WorktreeRemovalTarget
  disclosedProof: GitWorktreeRemovalProof
  authorization: DestructiveAuthorization
  readCurrent(): WorktreeRemovalTarget | null
  kidsGateRequired(): boolean
  readProof(target: WorktreeRemovalTarget): Promise<GitWorktreeRemovalProofResult>
  /** Called synchronously after the final target/policy re-read with the exact fresh proof. */
  remove(target: WorktreeRemovalTarget, proof: GitWorktreeRemovalProof): Promise<TResult>
  upgradeToTwoKey(target: WorktreeRemovalTarget): void
  refuse?(reason: Exclude<WorktreeDiskRemovalResult<TResult>['kind'], 'performed' | 'already-settled' | 'upgraded-to-two-key'>): void
}

/**
 * Once-only disk-removal commit spanning the post-confirm asynchronous proof read.
 *
 * The target/policy is checked when confirmation completes, the whole-tree proof is re-read, and
 * then target/policy is checked a second time immediately before `remove`. Any failed read, changed
 * fingerprint, rebinding, replacement incarnation, or policy tightening produces zero mutation.
 */
export function createWorktreeDiskRemovalCommit<TResult>(
  options: WorktreeDiskRemovalOptions<TResult>
): () => Promise<WorktreeDiskRemovalResult<TResult>> {
  let started = false

  return async () => {
    if (started) return { kind: 'already-settled' }
    started = true

    let approvedTarget: WorktreeRemovalTarget | undefined
    const first = createWorktreeRemovalCommitBarrier({
      disclosedTarget: options.disclosedTarget,
      authorization: options.authorization,
      readCurrent: options.readCurrent,
      kidsGateRequired: options.kidsGateRequired,
      perform: (target) => { approvedTarget = target },
      upgradeToTwoKey: options.upgradeToTwoKey,
      refuse: options.refuse
    })()
    if (first !== 'performed') return { kind: first }

    let proofResult: GitWorktreeRemovalProofResult | null = null
    try {
      proofResult = await options.readProof(approvedTarget!)
    } catch {
      // A rejected bridge read is not evidence that the target/proof still exists.
    }
    const freshProof = worktreeRemovalProofForTarget(proofResult, approvedTarget!)
    if (!freshProof) {
      options.refuse?.('proof-unavailable')
      return { kind: 'proof-unavailable' }
    }
    if (!sameWorktreeRemovalProof(options.disclosedProof, freshProof)) {
      options.refuse?.('proof-changed')
      return { kind: 'proof-changed' }
    }

    let finalTarget: WorktreeRemovalTarget | undefined
    const final = createWorktreeRemovalCommitBarrier({
      disclosedTarget: approvedTarget!,
      authorization: options.authorization,
      readCurrent: options.readCurrent,
      kidsGateRequired: options.kidsGateRequired,
      perform: (target) => { finalTarget = target },
      upgradeToTwoKey: options.upgradeToTwoKey,
      refuse: options.refuse
    })()
    if (final !== 'performed') return { kind: final }

    // No await or caller code occurs between the final exact target/policy read and this bridge call.
    const result = await options.remove(finalTarget!, freshProof)
    return { kind: 'performed', result }
  }
}
