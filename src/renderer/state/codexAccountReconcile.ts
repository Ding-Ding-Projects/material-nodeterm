import type { CodexAccount } from '@shared/types'

export interface ResolvedCodexAccount {
  id: string
  email: string | null
}

export async function discoverResolvedCodexAccounts(
  accounts: readonly CodexAccount[],
  identity: (id: string) => Promise<{ email: string | null } | null>
): Promise<ResolvedCodexAccount[]> {
  const resolved = await Promise.all(
    accounts.filter((account) => account.pending).map(async (account) => ({
      id: account.id,
      identity: await identity(account.id).catch(() => null)
    }))
  )
  return resolved.flatMap(({ id, identity: value }) =>
    value ? [{ id, email: value.email }] : []
  )
}

export function applyResolvedCodexAccounts(
  accounts: readonly CodexAccount[],
  resolved: readonly ResolvedCodexAccount[]
): CodexAccount[] {
  const byId = new Map(resolved.map((account) => [account.id, account]))
  return accounts.map((account) => {
    const identity = byId.get(account.id)
    if (!identity || !account.pending) return account
    return {
      ...account,
      label:
        account.label === 'New Codex account' && identity.email
          ? identity.email
          : account.label,
      email: identity.email ?? undefined,
      pending: false
    }
  })
}
