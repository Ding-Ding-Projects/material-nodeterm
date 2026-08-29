import { describe, expect, it } from 'vitest'
import type { ContextWindowUsage } from '@shared/types'
import { isFreshEnough } from './contextWindow'

const usage = (patch: Partial<ContextWindowUsage> = {}): ContextWindowUsage => ({
  sessionId: 'session-1',
  provider: 'claude',
  sourceKey: 'claude:local',
  usedTokens: 40,
  windowTokens: 100,
  usedPercent: 40,
  status: 'known',
  model: 'claude-opus-4-8',
  updatedAt: 100,
  generation: 1,
  epoch: 'producer-a:1',
  producerId: 'producer-a',
  lifecycle: 1,
  incarnation: 1,
  agentId: 'claude',
  source: 'local',
  sourceEpoch: 'source-a',
  epochHistory: [],
  producerHistory: [],
  ...patch
})

describe('context producer admission', () => {
  it('accepts a fresh lifecycle generation one, then rejects the delayed retired epoch', () => {
    const first = usage()
    const second = usage({ epoch: 'producer-a:2', lifecycle: 2, generation: 1, epochHistory: [first.epoch] })
    const delayed = usage({ epoch: first.epoch, lifecycle: 1, generation: 99 })
    expect(isFreshEnough(second, first)).toBe(true)
    expect(isFreshEnough(delayed, { ...second, epochHistory: [first.epoch], producerHistory: [] })).toBe(false)
  })

  it('accepts one unseen producer after restart and rejects its replay after retirement', () => {
    const old = usage()
    const restarted = usage({ epoch: 'producer-b:1', producerId: 'producer-b', lifecycle: 1, incarnation: 1 })
    const delayedOld = usage({ producerHistory: ['producer-b'], epoch: 'producer-a:1', producerId: 'producer-a' })
    expect(isFreshEnough(restarted, old)).toBe(true)
    expect(isFreshEnough(delayedOld, { ...restarted, producerHistory: ['producer-a'] })).toBe(false)
  })
})
