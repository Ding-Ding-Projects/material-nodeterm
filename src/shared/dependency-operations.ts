import { branchParentConfigKey, isValidGitRef } from './worktree'
import type { Endpoint, Link } from './types'

/** The complete first-class operation inventory for same-repository branch dependencies. */
export const DEPENDENCY_OPERATION_IDS = [
  'set-parent',
  'clear-parent',
  'sync',
  'propose',
  'ship'
] as const

export type DependencyOperationId = (typeof DEPENDENCY_OPERATION_IDS)[number]
export type DependencyOperationPhase =
  | 'queued'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'unavailable'

export interface DependencyOperationDescriptor {
  id: DependencyOperationId
  label: string
  executable: 'git' | 'gh'
  mutatesRepository: boolean
  requiresNetwork: boolean
  cancellableBeforeStart: boolean
}

/** Hand-written inventory. Keep this list exhaustive so an operation cannot disappear silently. */
export const DEPENDENCY_OPERATIONS: readonly DependencyOperationDescriptor[] = [
  {
    id: 'set-parent',
    label: 'Set branch parent',
    executable: 'git',
    mutatesRepository: true,
    requiresNetwork: false,
    cancellableBeforeStart: true
  },
  {
    id: 'clear-parent',
    label: 'Clear branch parent',
    executable: 'git',
    mutatesRepository: true,
    requiresNetwork: false,
    cancellableBeforeStart: true
  },
  {
    id: 'sync',
    label: 'Sync branch onto parent',
    executable: 'git',
    mutatesRepository: true,
    requiresNetwork: false,
    cancellableBeforeStart: true
  },
  {
    id: 'propose',
    label: 'Propose pull request',
    executable: 'gh',
    mutatesRepository: false,
    requiresNetwork: true,
    cancellableBeforeStart: true
  },
  {
    id: 'ship',
    label: 'Ship branch by fast-forward',
    executable: 'git',
    mutatesRepository: true,
    requiresNetwork: false,
    cancellableBeforeStart: true
  }
] as const

export interface DependencyBranchPair {
  repoPath: string
  child: string
  parent: string
}

export interface DependencyLinkOwnership {
  projectId: string
  linkId: string
  link: Link
}

export interface DependencyOperationRequest extends DependencyLinkOwnership {
  operation: DependencyOperationId
  /** The owning branch checkout, or the repository root for config writes. */
  cwd: string
}

export interface DependencyOperationPlan {
  operationId: DependencyOperationId
  executable: 'git' | 'gh'
  cwd: string
  args: readonly string[]
  branch: DependencyBranchPair
  maxOutputBytes: number
}

export interface DependencyOperationAvailability {
  available: boolean
  operation: DependencyOperationId
  reason: string | null
  branch: DependencyBranchPair | null
}

export interface DependencyOperationProgress {
  operationId: string
  operation: DependencyOperationId
  phase: DependencyOperationPhase
  completed: number
  total: number | null
  message: string
}

export interface DependencyOperationResult {
  ok: boolean
  operationId: string | null
  operation: DependencyOperationId
  phase: DependencyOperationPhase
  message: string
  projectId: string
  linkId: string
}

export const DEPENDENCY_MAX_PROJECT_ID_LENGTH = 128
export const DEPENDENCY_MAX_LINK_ID_LENGTH = 128
export const DEPENDENCY_MAX_PATH_LENGTH = 4096
export const DEPENDENCY_MAX_BRANCH_LENGTH = 256
export const DEPENDENCY_MAX_OUTPUT_BYTES = 512 * 1024

function boundedText(value: string, max: number): boolean {
  return value.trim().length > 0 && value.trim().length <= max
}

function comparableRepoPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')
    ? normalized.toLocaleLowerCase('en-US')
    : normalized
}

function branchEndpoint(value: Endpoint): { repoPath: string; branch: string } | null {
  return value.ref === 'branch' ? { repoPath: value.repoPath.trim(), branch: value.branch.trim() } : null
}

/** Return the child and parent only for an owned, same-repository branch dependency link. */
export function dependencyBranchPair(link: Link): DependencyBranchPair | null {
  if (link.kind !== 'dependency') return null
  const source = branchEndpoint(link.source)
  const target = branchEndpoint(link.target)
  if (!source || !target) return null
  if (!boundedText(source.repoPath, DEPENDENCY_MAX_PATH_LENGTH)) return null
  if (!boundedText(target.repoPath, DEPENDENCY_MAX_PATH_LENGTH)) return null
  if (comparableRepoPath(source.repoPath) !== comparableRepoPath(target.repoPath)) return null
  if (!boundedText(source.branch, DEPENDENCY_MAX_BRANCH_LENGTH) || !isValidGitRef(source.branch)) return null
  if (!boundedText(target.branch, DEPENDENCY_MAX_BRANCH_LENGTH) || !isValidGitRef(target.branch)) return null
  if (source.branch === target.branch) return null
  return { repoPath: source.repoPath, child: source.branch, parent: target.branch }
}

/** Validate project and link identity before an operation can be planned. */
export function dependencyOperationAvailability(
  request: DependencyOperationRequest
): DependencyOperationAvailability {
  const operation = DEPENDENCY_OPERATIONS.find((item) => item.id === request.operation)
  if (!operation) {
    return { available: false, operation: request.operation, reason: 'Unknown dependency operation.', branch: null }
  }
  if (!boundedText(request.projectId, DEPENDENCY_MAX_PROJECT_ID_LENGTH)) {
    return { available: false, operation: request.operation, reason: 'A project owner is required.', branch: null }
  }
  if (!boundedText(request.linkId, DEPENDENCY_MAX_LINK_ID_LENGTH) || request.link.id !== request.linkId) {
    return { available: false, operation: request.operation, reason: 'The dependency link identity is not owned by this request.', branch: null }
  }
  if (!boundedText(request.cwd, DEPENDENCY_MAX_PATH_LENGTH)) {
    return { available: false, operation: request.operation, reason: 'The owning branch checkout is unavailable.', branch: null }
  }
  const branch = dependencyBranchPair(request.link)
  if (!branch) {
    return {
      available: false,
      operation: request.operation,
      reason: 'This link is not an owned same-repository branch dependency.',
      branch: null
    }
  }
  return { available: true, operation: request.operation, reason: null, branch }
}

/** Build the only argv forms this lane permits. No shell text or caller-provided executable exists. */
export function planDependencyOperation(request: DependencyOperationRequest): DependencyOperationPlan | null {
  const availability = dependencyOperationAvailability(request)
  if (!availability.available || !availability.branch) return null
  const { branch } = availability
  const key = branchParentConfigKey(branch.child)
  if (!key) return null
  switch (request.operation) {
    case 'set-parent':
      return {
        operationId: request.operation,
        executable: 'git',
        cwd: branch.repoPath,
        args: ['config', key, branch.parent],
        branch,
        maxOutputBytes: DEPENDENCY_MAX_OUTPUT_BYTES
      }
    case 'clear-parent':
      return {
        operationId: request.operation,
        executable: 'git',
        cwd: branch.repoPath,
        args: ['config', '--unset', key],
        branch,
        maxOutputBytes: DEPENDENCY_MAX_OUTPUT_BYTES
      }
    case 'sync':
      return {
        operationId: request.operation,
        executable: 'git',
        cwd: request.cwd,
        args: ['rebase', branch.parent],
        branch,
        maxOutputBytes: DEPENDENCY_MAX_OUTPUT_BYTES
      }
    case 'propose':
      return {
        operationId: request.operation,
        executable: 'gh',
        cwd: request.cwd,
        args: [
          'pr',
          'create',
          '--base',
          branch.parent,
          '--head',
          branch.child,
          '--title',
          branch.child,
          '--body',
          `This pull request stacks ${branch.child} on ${branch.parent}.`
        ],
        branch,
        maxOutputBytes: DEPENDENCY_MAX_OUTPUT_BYTES
      }
    case 'ship':
      return {
        operationId: request.operation,
        executable: 'git',
        cwd: request.cwd,
        args: ['merge', '--ff-only', branch.child],
        branch,
        maxOutputBytes: DEPENDENCY_MAX_OUTPUT_BYTES
      }
  }
}
