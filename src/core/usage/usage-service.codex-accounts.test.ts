import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../shared/ipc'
import type { ProviderUsage } from '../../shared/types'
import { initPlatform, resetPlatformForTests } from '../platform'
import { fakePlatform, type FakePlatform } from '../platform-fake'

const { fetchCodexUsage } = vi.hoisted(() => ({
  fetchCodexUsage: vi.fn(
    async (
      _home?: string,
      identity?: { id: string; label: string; email?: string | null }
    ): Promise<ProviderUsage> => ({
      provider: 'codex',
      accountId: identity?.id ?? null,
      account: identity?.email ?? null,
      limits: [],
      updatedAt: Date.now(),
      status: 'ok'
    })
  )
}))

vi.mock('./codex-usage', () => ({ fetchCodexUsage }))
vi.mock('./gemini-usage', () => ({ fetchGeminiUsage: async () => unavailableRow('gemini') }))
vi.mock('./grok-usage', () => ({ fetchGrokUsage: async () => unavailableRow('grok') }))
vi.mock('./kimi-usage', () => ({ fetchKimiUsage: async () => unavailableRow('kimi') }))
vi.mock('./minimax-usage', () => ({ fetchMinimaxUsage: async () => unavailableRow('minimax') }))
vi.mock('./opencode-usage', () => ({ fetchOpencodeUsage: async () => unavailableRow('opencode') }))

import { startUsageService, type UsageService } from './usage-service'

function unavailableRow(provider: string): ProviderUsage {
  return { provider, account: null, limits: [], updatedAt: 0, status: 'unavailable' }
}

let platform: FakePlatform
let service: UsageService | undefined

beforeEach(() => {
  resetPlatformForTests()
  platform = fakePlatform()
  initPlatform(platform)
  fetchCodexUsage.mockClear()
})

afterEach(() => {
  service?.dispose()
  service = undefined
  resetPlatformForTests()
})

describe('Codex multi-account usage', () => {
  it('returns the system identity and two managed account rows independently', async () => {
    const accounts = [
      { id: 'a', home: '/isolated/a', label: 'Work', email: 'work@example.com' },
      { id: 'b', home: '/isolated/b', label: 'Personal', email: 'me@example.com' }
    ]
    service = startUsageService({ shouldPoll: () => false, codexAccounts: () => accounts })

    const rows = (await platform.handlers[IPC.usageProviders]()) as ProviderUsage[]
    expect(rows.filter((row) => row.provider === 'codex').map((row) => row.accountId)).toEqual([
      null,
      'a',
      'b'
    ])
    expect(fetchCodexUsage).toHaveBeenNthCalledWith(2, '/isolated/a', accounts[0])
    expect(fetchCodexUsage).toHaveBeenNthCalledWith(3, '/isolated/b', accounts[1])
  })

  it('invalidates the provider cache when an account is added', async () => {
    let accounts = [{ id: 'a', home: '/isolated/a', label: 'Work' }]
    service = startUsageService({ shouldPoll: () => false, codexAccounts: () => accounts })
    await platform.handlers[IPC.usageProviders]()
    expect(fetchCodexUsage).toHaveBeenCalledTimes(2)

    accounts = [...accounts, { id: 'b', home: '/isolated/b', label: 'Personal' }]
    const rows = (await platform.handlers[IPC.usageProviders]()) as ProviderUsage[]
    expect(rows.filter((row) => row.provider === 'codex')).toHaveLength(3)
    expect(fetchCodexUsage).toHaveBeenCalledTimes(5)
  })
})
