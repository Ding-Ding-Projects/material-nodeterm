import type { ClaudeAccount, ClaudeUsage } from '@shared/types'

export interface ClaudeUsageSnapshot {
  accountId: string | null
  usage: ClaudeUsage
}

const usageByAccount = new Map<string, ClaudeUsage>()

function key(accountId: string | undefined): string {
  return accountId ?? ''
}

/** Keep the latest usage read available to the synchronous node-creation funnel. */
export function recordClaudeUsage(accountId: string | undefined, usage: ClaudeUsage): void {
  usageByAccount.set(key(accountId), usage)
}

/** Replace the cache with the service's latest per-account snapshot. */
export function replaceClaudeUsageSnapshots(snapshots: ClaudeUsageSnapshot[]): void {
  usageByAccount.clear()
  for (const snapshot of snapshots) recordClaudeUsage(snapshot.accountId ?? undefined, snapshot.usage)
}

export function clearClaudeUsageSnapshots(): void {
  usageByAccount.clear()
}

function usedPercent(accountId: string | undefined): number | null {
  const usage = usageByAccount.get(key(accountId))
  if (!usage || usage.status !== 'ok') return null
  if (usage.limits.length === 0) return null
  // Rotation is driven by whichever subscription window is closest to exhaustion. This includes
  // a weekly window even when the provider has not marked it as the currently active limiter.
  return Math.max(...usage.limits.map((limit) => limit.usedPercent))
}

function resetAt(accountId: string | undefined): number {
  const usage = usageByAccount.get(key(accountId))
  const limits = usage?.limits ?? []
  const highest = usedPercent(accountId)
  return (
    limits.find((limit) => limit.usedPercent === highest)?.resetsAt ?? Number.POSITIVE_INFINITY
  )
}

/**
 * Select the account for a new default Claude node. A missing or stale usage row never triggers a
 * switch. When the current account is at the threshold, the account with the most headroom wins;
 * if every known account is at or above the threshold, the least-used account wins so launching
 * remains non-blocking.
 */
export function rotatedClaudeAccount(
  currentAccountId: string | undefined,
  accounts: ClaudeAccount[],
  threshold: number
): string | undefined {
  const currentUsed = usedPercent(currentAccountId)
  if (currentUsed === null || currentUsed < threshold) return currentAccountId

  const candidates: Array<string | undefined> = [
    undefined,
    ...accounts.filter((account) => !account.pending && !account.host).map((account) => account.id)
  ]
  const available = candidates
    .map((accountId) => ({ accountId, used: usedPercent(accountId), reset: resetAt(accountId) }))
    .filter((candidate): candidate is typeof candidate & { used: number } => candidate.used !== null)
    .filter((candidate) => candidate.accountId !== currentAccountId)
    .sort((a, b) => a.used - b.used || a.reset - b.reset)
  if (available.length === 0) return currentAccountId

  const belowThreshold = available.filter((candidate) => candidate.used < threshold)
  return (belowThreshold[0] ?? available[0]).accountId
}
