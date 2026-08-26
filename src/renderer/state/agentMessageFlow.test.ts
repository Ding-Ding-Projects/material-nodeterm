import { beforeEach, describe, expect, it } from 'vitest'
import {
  FANOUT_PER_TURN,
  FANOUT_RETRY_AFTER_MS,
  PAIR_MIN_INTERVAL_MS,
  TURN_STALE_MS,
  checkFlow,
  noteNewTurn,
  noteSent,
  pairKey,
  resetAgentMessageFlowForTests
} from './agentMessageFlow'

beforeEach(() => {
  resetAgentMessageFlowForTests()
})

describe('pairKey', () => {
  it('is injective over ids containing no NUL', () => {
    expect(pairKey('a', 'b')).not.toBe(pairKey('b', 'a'))
  })

  it('collides across the separator when an id is not pre-validated (documented precondition)', () => {
    // This is the exact hazard the module doc warns about: callers must validate ids with
    // isSafeNodeId first. Asserted here so the precondition is pinned by execution, not prose.
    const withSeparator = 'x\u0000y'
    expect(pairKey(withSeparator, 'z')).toBe(pairKey('x', 'y\u0000z'))
  })
})

describe('checkFlow / noteSent — per-pair rate limit', () => {
  it('allows the first send on a fresh pair', () => {
    expect(checkFlow('s1', 't1', 0)).toEqual({ ok: true })
  })

  it('refuses a second send inside the pair window and reports the remaining wait', () => {
    noteSent('s1', 't1', 1000)
    const check = checkFlow('s1', 't1', 1000 + PAIR_MIN_INTERVAL_MS - 1)
    expect(check.ok).toBe(false)
    expect(check.retryAfterMs).toBe(1)
  })

  it('allows a send exactly at the window boundary', () => {
    noteSent('s1', 't1', 1000)
    expect(checkFlow('s1', 't1', 1000 + PAIR_MIN_INTERVAL_MS)).toEqual({ ok: true })
  })

  it('never throttles the reverse direction of the same pair', () => {
    noteSent('a', 'b', 1000)
    expect(checkFlow('b', 'a', 1000)).toEqual({ ok: true })
  })

  it('never lets one busy target throttle a different sender', () => {
    noteSent('a', 'shared', 1000)
    expect(checkFlow('c', 'shared', 1000)).toEqual({ ok: true })
  })

  it('fails open when the clock reading is non-finite', () => {
    expect(checkFlow('s1', 't1', NaN)).toEqual({ ok: true })
    noteSent('s1', 't1', NaN) // must not record anything that could later block a valid check
    expect(checkFlow('s1', 't1', 1000)).toEqual({ ok: true })
  })

  it('fails open when the clock goes backwards past the recorded send', () => {
    noteSent('s1', 't1', 5000)
    expect(checkFlow('s1', 't1', 1000)).toEqual({ ok: true })
  })
})

describe('checkFlow / noteSent + noteNewTurn — per-turn fan-out cap', () => {
  it('allows up to FANOUT_PER_TURN distinct sends inside one turn', () => {
    let now = 0
    for (let i = 0; i < FANOUT_PER_TURN; i++) {
      const target = `t${i}`
      expect(checkFlow('s1', target, now)).toEqual({ ok: true })
      noteSent('s1', target, now)
      now += PAIR_MIN_INTERVAL_MS // clear the per-pair gate each time; a new target each time too
    }
  })

  it('refuses the send past the cap with the pair-interval floor as retryAfterMs', () => {
    let now = 0
    for (let i = 0; i < FANOUT_PER_TURN; i++) {
      noteSent('s1', `t${i}`, now)
      now += PAIR_MIN_INTERVAL_MS
    }
    const check = checkFlow('s1', 'tOverflow', now)
    expect(check).toEqual({ ok: false, retryAfterMs: FANOUT_RETRY_AFTER_MS })
  })

  it('resets on noteNewTurn even before the cap is hit', () => {
    noteSent('s1', 't0', 0)
    noteSent('s1', 't1', PAIR_MIN_INTERVAL_MS)
    noteNewTurn('s1')
    let now = PAIR_MIN_INTERVAL_MS * 2
    for (let i = 0; i < FANOUT_PER_TURN; i++) {
      expect(checkFlow('s1', `u${i}`, now)).toEqual({ ok: true })
      noteSent('s1', `u${i}`, now)
      now += PAIR_MIN_INTERVAL_MS
    }
  })

  it('self-heals once the budget has been idle for TURN_STALE_MS, without noteNewTurn ever firing', () => {
    let now = 0
    for (let i = 0; i < FANOUT_PER_TURN; i++) {
      noteSent('s1', `t${i}`, now)
      now += 1 // deliberately NOT clearing the pair gate — only the fan-out budget matters here
    }
    now += TURN_STALE_MS + 1
    expect(checkFlow('s1', 'tFresh', now)).toEqual({ ok: true })
  })

  it('does not let two independent senders share one fan-out budget', () => {
    let now = 0
    for (let i = 0; i < FANOUT_PER_TURN; i++) {
      noteSent('s1', `t${i}`, now)
      now += PAIR_MIN_INTERVAL_MS
    }
    expect(checkFlow('s2', 'tOther', now)).toEqual({ ok: true })
  })
})
