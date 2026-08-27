import type { ClaudeAccount } from '../types'
import type { CodexAccount } from '../codex-account'

/**
 * The common shape needed to answer an account-color lookup. Claude and Codex accounts remain
 * separate records, so this structural boundary avoids making either list depend on the other.
 */
export interface AccountColorSource {
  id: string
  color?: string
}

/**
 * Return a managed account's default node color, or undefined when the account has no usable
 * color. Settings are hand-editable, so validate the runtime value before trimming it.
 */
export function accountNodeColor(
  accountId: string | undefined,
  accounts: readonly AccountColorSource[]
): string | undefined {
  if (!accountId) return undefined
  const color = accounts.find((account) => account.id === accountId)?.color
  if (typeof color !== 'string') return undefined
  return color.trim() || undefined
}

/** The managed account lists owned by the two builtin agent families. */
export interface ManagedAccountLists {
  claude: readonly ClaudeAccount[]
  codex: readonly CodexAccount[]
}

/**
 * Resolve the account color from the list that owns the selected builtin agent. The lists are
 * keyed independently, so a Claude and Codex account may share an id without cross-contaminating
 * node colors. Other agents do not inherit either managed account list.
 */
export function agentAccountColor(
  agentId: string | undefined,
  accountId: string | undefined,
  accounts: ManagedAccountLists
): string | undefined {
  if (agentId === 'claude') return accountNodeColor(accountId, accounts.claude)
  if (agentId === 'codex') return accountNodeColor(accountId, accounts.codex)
  return undefined
}
