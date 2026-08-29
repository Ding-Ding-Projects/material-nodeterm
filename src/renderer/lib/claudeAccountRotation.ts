import type { ClaudeAccount, ClaudeAccountRotationSettings, ClaudeUsage, UsageLimit } from '@shared/types'

/** The source key used for the system Claude login in usage and rotation records. */
export const SYSTEM_ACCOUNT_KEY = ''
const ROTATION_STATE_KEY = 'nodeterm:claude-account-rotation:v1'
const DEFAULT_ROTATION: ClaudeAccountRotationSettings = {
  enabled: false,
  thresholdPercent: 90,
  hysteresisPercent: 5,
  cooldownMinutes: 30
}

export interface RotationAccountEvidence {
  accountId?: string
  label: string
  status: ClaudeUsage['status'] | 'missing'
  usedPercent: number | null
  resetsAt: number | null
  eligible: boolean
}

export type RotationReason =
  | 'disabled'
  | 'explicit-account'
  | 'remote-project'
  | 'source-usage-unavailable'
  | 'below-threshold'
  | 'cooldown'
  | 'hysteresis'
  | 'rotated'
  | 'no-alternative'

export interface RotationDecision {
  accountId?: string
  sourceAccountId?: string
  sourceLabel: string
  targetLabel?: string
  sourcePercent: number | null
  targetPercent: number | null
  reason: RotationReason
  /** Evidence for every configured local account considered, including the system login. */
  evidence: RotationAccountEvidence[]
  nextState?: RotationMemory
}

export interface RotationMemory {
  sourceKey: string
  lastRotatedAt: number
  blockedUntilRecovery: boolean
  lastTargetKey?: string
  lastNoticeAt?: number
}

function finitePercent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** Re-validate hand-editable Settings values at the decision boundary. */
export function normalizeClaudeAccountRotation(
  input: Partial<ClaudeAccountRotationSettings> | null | undefined
): ClaudeAccountRotationSettings {
  const threshold = finitePercent(input?.thresholdPercent)
  const hysteresis = finitePercent(input?.hysteresisPercent)
  const cooldown = typeof input?.cooldownMinutes === 'number' && Number.isFinite(input.cooldownMinutes)
    ? input.cooldownMinutes
    : DEFAULT_ROTATION.cooldownMinutes
  return {
    enabled: input?.enabled === true,
    thresholdPercent: threshold === null ? DEFAULT_ROTATION.thresholdPercent : Math.max(50, threshold),
    hysteresisPercent:
      hysteresis === null
        ? DEFAULT_ROTATION.hysteresisPercent
        : Math.min(25, Math.max(0, hysteresis)),
    cooldownMinutes: Math.min(240, Math.max(1, cooldown))
  }
}

/** The limit that should gate rotation: highest usage first, then the earliest reset. */
export function rotationLimit(usage: ClaudeUsage | null | undefined): UsageLimit | null {
  if (!usage || usage.status !== 'ok') return null
  const limits = (Array.isArray(usage.limits) ? usage.limits : []).filter(
    (limit): limit is UsageLimit =>
      !!limit && typeof limit === 'object' && finitePercent(limit.usedPercent) !== null
  )
  if (limits.length === 0) return null
  return [...limits].sort((a, b) => {
    const usageDelta = (finitePercent(b.usedPercent) ?? 0) - (finitePercent(a.usedPercent) ?? 0)
    if (usageDelta !== 0) return usageDelta
    const aReset = finiteTimestamp(a.resetsAt)
    const bReset = finiteTimestamp(b.resetsAt)
    if (aReset === null) return 1
    if (bReset === null) return -1
    return aReset - bReset
  })[0]
}

function usageFor(map: ReadonlyMap<string, ClaudeUsage>, accountId?: string): ClaudeUsage | undefined {
  return map.get(accountId ?? SYSTEM_ACCOUNT_KEY)
}

function keyFor(accountId?: string): string {
  return accountId ?? SYSTEM_ACCOUNT_KEY
}

function evidenceFor(
  account: { accountId?: string; label: string },
  usage: ClaudeUsage | undefined
): RotationAccountEvidence {
  const limit = rotationLimit(usage)
  return {
    accountId: account.accountId,
    label: account.label,
    status: usage?.status ?? 'missing',
    usedPercent: limit ? finitePercent(limit.usedPercent) : null,
    resetsAt: finiteTimestamp(limit?.resetsAt),
    eligible: limit !== null
  }
}

function compareCandidates(a: RotationAccountEvidence, b: RotationAccountEvidence): number {
  const aPercent = a.usedPercent ?? Number.POSITIVE_INFINITY
  const bPercent = b.usedPercent ?? Number.POSITIVE_INFINITY
  if (aPercent !== bPercent) return aPercent - bPercent
  const aReset = finiteTimestamp(a.resetsAt)
  const bReset = finiteTimestamp(b.resetsAt)
  if (aReset === null) return 1
  if (bReset === null) return -1
  return aReset - bReset
}

/**
 * Decide which account a NEW Claude node should use. This function has no renderer or network
 * dependency, so the launch path and focused tests can share one exact policy.
 */
export function decideClaudeAccountRotation(input: {
  explicitAccountId?: string
  sourceAccountId?: string
  accounts: ClaudeAccount[]
  systemLabel: string
  projectIsRemote?: boolean
  settings: Partial<ClaudeAccountRotationSettings> | null | undefined
  usageByAccount: ReadonlyMap<string, ClaudeUsage>
  now: number
  memory?: RotationMemory
}): RotationDecision {
  const sourceAccountId = input.sourceAccountId
  const managedAccounts = Array.isArray(input.accounts) ? input.accounts : []
  const sourceLabel = sourceAccountId
    ? managedAccounts.find((account) => account.id === sourceAccountId)?.label ?? 'Selected Claude account'
    : input.systemLabel || 'System Claude account'
  const normalized = normalizeClaudeAccountRotation(input.settings)
  const allAccounts = [
    { accountId: undefined, label: input.systemLabel || 'System Claude account' },
    ...managedAccounts
      .filter((account) => !account.pending && !account.host)
      .map((account) => ({ accountId: account.id, label: account.label }))
  ]
  const evidence = allAccounts.map((account) => evidenceFor(account, usageFor(input.usageByAccount, account.accountId)))
  const sourceEvidence = evidence.find((account) => keyFor(account.accountId) === keyFor(sourceAccountId))
  const sourcePercent = sourceEvidence?.usedPercent ?? null
  const base = {
    accountId: sourceAccountId,
    sourceAccountId,
    sourceLabel,
    sourcePercent,
    targetPercent: null,
    evidence
  }
  const rememberedTarget = (memory: RotationMemory | undefined): RotationAccountEvidence | undefined => {
    if (!memory || memory.sourceKey !== keyFor(sourceAccountId) || memory.lastTargetKey === undefined) return undefined
    return evidence.find((account) => keyFor(account.accountId) === memory.lastTargetKey && account.eligible)
  }
  if (!normalized.enabled) return { ...base, reason: 'disabled' }
  if (input.explicitAccountId !== undefined) return { ...base, reason: 'explicit-account' }
  if (input.projectIsRemote) return { ...base, reason: 'remote-project' }
  if (!sourceEvidence?.eligible || sourcePercent === null) {
    return { ...base, reason: 'source-usage-unavailable' }
  }
  if (sourcePercent < normalized.thresholdPercent) return { ...base, reason: 'below-threshold' }

  const memory = input.memory
  if (memory && memory.sourceKey === keyFor(sourceAccountId)) {
    if (
      memory.blockedUntilRecovery &&
      sourcePercent > normalized.thresholdPercent - normalized.hysteresisPercent
    ) {
      const target = rememberedTarget(memory)
      return target
        ? {
            ...base,
            accountId: target.accountId,
            targetLabel: target.label,
            targetPercent: target.usedPercent,
            reason: 'hysteresis'
          }
        : { ...base, reason: 'hysteresis' }
    }
    if (
      memory.lastRotatedAt > 0 &&
      input.now - memory.lastRotatedAt < normalized.cooldownMinutes * 60_000
    ) {
      const target = rememberedTarget(memory)
      return target
        ? {
            ...base,
            accountId: target.accountId,
            targetLabel: target.label,
            targetPercent: target.usedPercent,
            reason: 'cooldown'
          }
        : { ...base, reason: 'cooldown' }
    }
  }

  const candidates = evidence.filter(
    (account) => keyFor(account.accountId) !== keyFor(sourceAccountId) && account.eligible
  )
  if (candidates.length === 0) return { ...base, reason: 'no-alternative' }
  const belowThreshold = candidates.filter(
    (account) => (account.usedPercent ?? 100) < normalized.thresholdPercent
  )
  const target = [...(belowThreshold.length ? belowThreshold : candidates)].sort(compareCandidates)[0]
  const targetPercent = target.usedPercent
  const noAlternative = belowThreshold.length === 0
  return {
    accountId: target.accountId,
    sourceAccountId,
    sourceLabel,
    targetLabel: target.label,
    sourcePercent,
    targetPercent,
    reason: noAlternative ? 'no-alternative' : 'rotated',
    evidence,
    nextState: {
      sourceKey: keyFor(sourceAccountId),
      lastRotatedAt: input.now,
      blockedUntilRecovery: true,
      lastTargetKey: keyFor(target.accountId),
      lastNoticeAt: memory?.lastNoticeAt
    }
  }
}

function readState(): Record<string, RotationMemory> {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ROTATION_STATE_KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, RotationMemory>
  } catch {
    return {}
  }
}

export function readClaudeRotationMemory(scope: string): RotationMemory | undefined {
  const value = readState()[scope]
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.sourceKey !== 'string' ||
    typeof value.lastRotatedAt !== 'number' ||
    !Number.isFinite(value.lastRotatedAt) ||
    typeof value.blockedUntilRecovery !== 'boolean'
  ) {
    return undefined
  }
  return {
    sourceKey: value.sourceKey,
    lastRotatedAt: Math.max(0, value.lastRotatedAt),
    blockedUntilRecovery: value.blockedUntilRecovery,
    ...(typeof value.lastTargetKey === 'string' ? { lastTargetKey: value.lastTargetKey } : {}),
    ...(typeof value.lastNoticeAt === 'number' && Number.isFinite(value.lastNoticeAt)
      ? { lastNoticeAt: Math.max(0, value.lastNoticeAt) }
      : {})
  }
}

export function writeClaudeRotationMemory(scope: string, memory: RotationMemory): void {
  if (typeof window === 'undefined') return
  try {
    const all = readState()
    all[scope] = memory
    window.localStorage.setItem(ROTATION_STATE_KEY, JSON.stringify(all))
  } catch {
    // Rotation remains safe when browser storage is unavailable. The next decision simply has no
    // prior hysteresis/cooldown memory, and the notification names that persistence was unavailable.
  }
}

/**
 * Fetch evidence for all configured local accounts before a new launch. A failed read is retained
 * as missing evidence, never treated as zero usage or as permission to rotate blindly.
 */
export async function resolveClaudeAccountForLaunch(input: {
  explicitAccountId?: string
  /** The historical account resolution, including a remote account on an SSH project. */
  selectedAccountId?: string
  projectDefaultAccountId?: string
  accounts: ClaudeAccount[]
  systemLabel: string
  projectId?: string
  projectIsRemote?: boolean
  settings: Partial<ClaudeAccountRotationSettings> | null | undefined
  fetchUsage: (accountId?: string) => Promise<ClaudeUsage>
  now?: number
}): Promise<RotationDecision> {
  const managedAccounts = Array.isArray(input.accounts) ? input.accounts : []
  const localProjectDefault = input.projectDefaultAccountId && managedAccounts.some(
    (account) => account.id === input.projectDefaultAccountId && !account.pending && !account.host
  )
    ? input.projectDefaultAccountId
    : undefined
  const selectedSource = input.selectedAccountId ?? input.explicitAccountId ?? localProjectDefault
  const usageByAccount = new Map<string, ClaudeUsage>()
  const normalized = normalizeClaudeAccountRotation(input.settings)
  // Explicit pins, remote projects, and a disabled policy must remain the cheap historical path.
  // In particular, turning the feature off never spends usage requests or delays node creation.
  if (input.explicitAccountId !== undefined || !normalized.enabled || input.projectIsRemote) {
    return decideClaudeAccountRotation({
      explicitAccountId: input.explicitAccountId,
      sourceAccountId: selectedSource,
      accounts: managedAccounts,
      systemLabel: input.systemLabel,
      projectIsRemote: input.projectIsRemote,
      settings: input.settings,
      usageByAccount,
      now: input.now ?? Date.now(),
      memory: input.projectId ? readClaudeRotationMemory(input.projectId) : undefined
    })
  }
  const ids = [undefined, ...managedAccounts.filter((account) => !account.pending && !account.host).map((account) => account.id)]
  await Promise.all(
    ids.map(async (accountId) => {
      try {
        usageByAccount.set(accountId ?? SYSTEM_ACCOUNT_KEY, await input.fetchUsage(accountId))
      } catch {
        // Missing evidence is deliberately distinguishable from a zero-usage account.
      }
    })
  )
  const decision = decideClaudeAccountRotation({
    explicitAccountId: input.explicitAccountId,
    sourceAccountId: selectedSource,
    accounts: managedAccounts,
    systemLabel: input.systemLabel,
    projectIsRemote: input.projectIsRemote,
    settings: input.settings,
    usageByAccount,
    now: input.now ?? Date.now(),
    memory: input.projectId ? readClaudeRotationMemory(input.projectId) : undefined
  })
  if (input.projectId && decision.nextState) writeClaudeRotationMemory(input.projectId, decision.nextState)
  return decision
}
