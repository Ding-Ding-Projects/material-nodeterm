import { describe, expect, it } from 'vitest'
import {
  LOOP_DEFAULT_INTERVAL_MS,
  LOOP_MAX_INTERVAL_MS,
  LOOP_MIN_INTERVAL_MS,
  loopMessageId,
  loopRunDue,
  nextLoopRun,
  parseLoopInterval,
  validLoopInterval
} from './nativeLoop'

describe('native Loop scheduling', () => {
  it('clamps malformed and unsafe intervals', () => {
    expect(validLoopInterval(undefined)).toBe(LOOP_DEFAULT_INTERVAL_MS)
    expect(validLoopInterval(1)).toBe(LOOP_MIN_INTERVAL_MS)
    expect(validLoopInterval(Number.POSITIVE_INFINITY)).toBe(LOOP_DEFAULT_INTERVAL_MS)
    expect(validLoopInterval(LOOP_MAX_INTERVAL_MS * 2)).toBe(LOOP_MAX_INTERVAL_MS)
  })

  it('preserves a future run and advances a missed run exactly once from now', () => {
    expect(nextLoopRun(1_000, 60_000, 40_000)).toBe(40_000)
    expect(nextLoopRun(100_000, 60_000, 40_000)).toBe(160_000)
    expect(nextLoopRun(100_000, 60_000)).toBe(160_000)
  })

  it('detects only finite due instants', () => {
    expect(loopRunDue(100, 100)).toBe(true)
    expect(loopRunDue(100, 101)).toBe(false)
    expect(loopRunDue(100, Number.NaN)).toBe(false)
  })

  it('creates a deterministic safe message id per target and due instant', () => {
    expect(loopMessageId('scheduler-a', 'term-b', 1234.9)).toBe(
      'loopmsg-scheduler-a-term-b-1234'
    )
    expect(loopMessageId('scheduler-a', 'term-c', 1234.9)).not.toBe(
      loopMessageId('scheduler-a', 'term-b', 1234.9)
    )
  })

  it('parses the control cadence grammar and rejects unsafe ranges', () => {
    expect(parseLoopInterval(undefined)).toBe(15 * 60_000)
    expect(parseLoopInterval('15m')).toBe(15 * 60_000)
    expect(parseLoopInterval('2h')).toBe(2 * 3_600_000)
    expect(parseLoopInterval('1d')).toBe(86_400_000)
    expect(parseLoopInterval('0m')).toBeNull()
    expect(parseLoopInterval('')).toBeNull()
    expect(parseLoopInterval('1s')).toBeNull()
    expect(parseLoopInterval('366d')).toBeNull()
  })
})
