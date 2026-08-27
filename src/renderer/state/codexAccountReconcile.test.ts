import { describe, expect, it, vi } from 'vitest'
import type { CodexAccount } from '@shared/types'
import {
  applyResolvedCodexAccounts,
  discoverResolvedCodexAccounts,
  type ResolvedCodexAccount
} from './codexAccountReconcile'

const accounts: CodexAccount[] = [
  { id: 'ready', label: 'Ready', pending: false, createdAt: 1 },
  { id: 'pending-ok', label: 'New Codex account', pending: true, createdAt: 2 },
  { id: 'pending-no', label: 'Waiting', pending: true, createdAt: 3 }
]

const pending = (id: string, over: Partial<CodexAccount> = {}): CodexAccount => ({
  id,
  label: 'New Codex account',
  pending: true,
  createdAt: 1,
  ...over
})

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

describe('applyResolvedCodexAccounts', () => {
  it('promotes a generated label to the email and clears pending', () => {
    const out = applyResolvedCodexAccounts([pending('a')], [{ id: 'a', email: 'a@x' }])
    expect(out).toEqual([{ id: 'a', label: 'a@x', email: 'a@x', pending: false }])
  })

  it('keeps a user-chosen label but still captures the email', () => {
    const out = applyResolvedCodexAccounts(
      [pending('a', { label: 'Work' })],
      [{ id: 'a', email: 'a@x' }]
    )
    expect(out[0]).toMatchObject({ label: 'Work', email: 'a@x', pending: false })
  })

  it('merges against fresh state without reviving removed or already-changed accounts', () => {
    // Fresh list: 'a' was already settled by a concurrent edit; 'removed' is gone entirely.
    const fresh: CodexAccount[] = [{ id: 'a', label: 'Renamed', email: 'a@x', pending: false }]
    const resolved: ResolvedCodexAccount[] = [
      { id: 'a', email: 'stale@x' }, // must NOT clobber the already-changed row
      { id: 'removed', email: 'ghost@x' } // must NOT be revived into the list
    ]
    const out = applyResolvedCodexAccounts(fresh, resolved)
    expect(out).toEqual(fresh) // untouched
    expect(out.some((account) => account.id === 'removed')).toBe(false)
  })
})
