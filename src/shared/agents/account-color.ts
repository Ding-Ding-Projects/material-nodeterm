import type { ClaudeAccount, CodexAccount } from '../types'

export interface AccountColorSource {
  id: string
  color?: string
}

/** A malformed or whitespace-only persisted colour falls back to the agent colour. */
export function accountNodeColor(
  accountId: string | undefined,
  accounts: readonly AccountColorSource[]
): string | undefined {
  if (!accountId) return undefined
  const color = accounts.find((account) => account.id === accountId)?.color
  if (typeof color !== 'string') return undefined
  return color.trim() || undefined
}

export interface ManagedAccountLists {
  claude: readonly ClaudeAccount[]
  codex: readonly CodexAccount[]
}

/** Resolve colour from the account list owned by the builtin agent, never by a shared id alone. */
export function agentAccountColor(
  agentId: string | undefined,
  accountId: string | undefined,
  accounts: ManagedAccountLists
): string | undefined {
  if (agentId === 'claude') return accountNodeColor(accountId, accounts.claude)
  if (agentId === 'codex') return accountNodeColor(accountId, accounts.codex)
  return undefined
}
