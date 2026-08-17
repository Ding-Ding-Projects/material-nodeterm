import { describe, expect, it, vi } from 'vitest'
import type { CodexAccount } from '@shared/types'
import {
  applyResolvedCodexAccounts,
  discoverResolvedCodexAccounts
} from './codexAccountReconcile'

const accounts: CodexAccount[] = [
  { id: 'ready', label: 'Ready', pending: false, createdAt: 1 },
  { id: 'pending-ok', label: 'New Codex account', pending: true, createdAt: 2 },
  { id: 'pending-no', label: 'Waiting', pending: true, createdAt: 3 }
]

describe('Codex account startup reconciliation', () => {
  it('discovers only authenticated pending accounts', async () => {
    const identity = vi.fn(async (id: string) =>
      id === 'pending-ok' ? { email: 'second@example.test' } : null
    )

    await expect(discoverResolvedCodexAccounts(accounts, identity)).resolves.toEqual([
      { id: 'pending-ok', email: 'second@example.test' }
    ])
    expect(identity.mock.calls.map(([id]) => id)).toEqual(['pending-ok', 'pending-no'])
  })

  it('merges against fresh state without reviving removed or already changed accounts', () => {
    const fresh = [accounts[0], accounts[1]]
    const result = applyResolvedCodexAccounts(fresh, [
      { id: 'pending-ok', email: 'second@example.test' },
      { id: 'pending-no', email: 'removed@example.test' }
    ])

    expect(result).toEqual([
      accounts[0],
      {
        ...accounts[1],
        label: 'second@example.test',
        email: 'second@example.test',
        pending: false
      }
    ])
  })
})
