import { describe, expect, it } from 'vitest'
import { DECISION_ORDER, RETRYABLE, decideDelivery, type AgentMessageOutcomeKind, type DeliveryFacts } from './agentMessageDecide'

const BASE: DeliveryFacts = {
  sourceNodeId: 'sender-1',
  targetNodeId: 'target-1',
  targetLive: true,
  wouldOverflowQueue: false,
  queueCapacity: 50
}

describe('decideDelivery', () => {
  it('proceeds when every gate is clear', () => {
    expect(decideDelivery(BASE)).toEqual({ kind: 'proceed' })
  })

  it('refuses notPermitted first, ahead of every other refusal', () => {
    const outcome = decideDelivery({
      ...BASE,
      notPermitted: 'switch-off',
      retryAfterMs: 5000,
      targetLive: false
    })
    expect(outcome).toEqual({ kind: 'notPermitted', reason: 'switch-off' })
  })

  it('refuses self-send as a backstop even without an explicit notPermitted flag', () => {
    const outcome = decideDelivery({ ...BASE, sourceNodeId: 'x', targetNodeId: 'x' })
    expect(outcome).toEqual({ kind: 'notPermitted', reason: 'self-send' })
  })

  it('skips the self-send backstop when either id is absent (outer guard already ran)', () => {
    expect(decideDelivery({ ...BASE, sourceNodeId: undefined })).toEqual({ kind: 'proceed' })
    expect(decideDelivery({ ...BASE, targetNodeId: undefined })).toEqual({ kind: 'proceed' })
  })

  it('rate limits ahead of liveness/busy/queue checks', () => {
    const outcome = decideDelivery({
      ...BASE,
      retryAfterMs: 2500,
      targetLive: false,
      targetState: 'working',
      wouldOverflowQueue: true
    })
    expect(outcome).toEqual({ kind: 'rateLimited', retryAfterMs: 2500 })
  })

  it('treats a zero or negative retryAfterMs as no rate limit at all', () => {
    expect(decideDelivery({ ...BASE, retryAfterMs: 0 })).toEqual({ kind: 'proceed' })
    expect(decideDelivery({ ...BASE, retryAfterMs: -1 })).toEqual({ kind: 'proceed' })
  })

  it('reports targetGone when there is no live node, ahead of the busy/queue checks', () => {
    const outcome = decideDelivery({ ...BASE, targetLive: false, targetState: 'working', wouldOverflowQueue: true })
    expect(outcome).toEqual({ kind: 'targetGone' })
  })

  for (const state of ['working', 'blocked', 'waiting'] as const) {
    it(`reports targetBusy(${state}) ahead of the queue-full check`, () => {
      const outcome = decideDelivery({ ...BASE, targetState: state, wouldOverflowQueue: true })
      expect(outcome).toEqual({ kind: 'targetBusy', state })
    })
  }

  it('treats "done" as not busy', () => {
    expect(decideDelivery({ ...BASE, targetState: 'done' })).toEqual({ kind: 'proceed' })
  })

  it('reports queueFull only once every cheaper gate has passed', () => {
    const outcome = decideDelivery({ ...BASE, wouldOverflowQueue: true, queueCapacity: 10 })
    expect(outcome).toEqual({ kind: 'queueFull', capacity: 10 })
  })

  it('DECISION_ORDER matches the order the function actually applies gates in', () => {
    // Walk the order by clearing one fact at a time, exactly as the module's own comment requires:
    // the ordering is asserted by RUNNING decideDelivery, never by reading DECISION_ORDER's source.
    const facts: DeliveryFacts = {
      ...BASE,
      notPermitted: 'switch-off',
      retryAfterMs: 10,
      targetLive: false,
      targetState: 'working',
      wouldOverflowQueue: true
    }
    let cursor = { ...facts }
    for (const step of DECISION_ORDER) {
      const outcome = decideDelivery(cursor)
      expect(outcome.kind).toBe(step)
      if (step === 'notPermitted') cursor = { ...cursor, notPermitted: undefined }
      else if (step === 'rateLimited') cursor = { ...cursor, retryAfterMs: undefined }
      else if (step === 'targetGone') cursor = { ...cursor, targetLive: true }
      else if (step === 'targetBusy') cursor = { ...cursor, targetState: 'done' }
    }
    expect(decideDelivery(cursor)).toEqual({ kind: 'queueFull', capacity: 50 })
  })

  it('RETRYABLE is exhaustive over every outcome kind and matches the documented policy', () => {
    const expected: Record<AgentMessageOutcomeKind, boolean> = {
      delivered: false,
      queued: false,
      expired: true,
      rateLimited: true,
      queueFull: true,
      targetBusy: true,
      targetGone: false,
      notPermitted: false
    }
    expect(RETRYABLE).toEqual(expected)
  })
})
