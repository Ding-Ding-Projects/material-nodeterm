import { describe, expect, it } from 'vitest'
import { BENCH_MAX_RUNS, caseSummary, runBenchmark, runCases } from './lab'
import { pushRegexHistory, regexHistory, REGEX_HISTORY_MAX } from './history'

describe('runCases', () => {
  it('passes when the outcome matches the expectation', () => {
    const r = runCases('\\d+', '', [
      { text: 'abc 12', expect: 'match' },
      { text: 'abc', expect: 'match' },
      { text: 'xyz', expect: 'no-match' }
    ])
    expect(r.map((x) => x.pass)).toEqual([true, false, true])
    expect(r[0].first).toBe('12')
    expect(caseSummary(r)).toEqual({ passed: 2, failed: 1 })
  })
})

describe('runBenchmark', () => {
  it('stops at the run cap and reports the spread from the injected clock', () => {
    let t = 0
    const r = runBenchmark('a', 'g', 'aaa', () => (t += 0.5))
    expect(r.runs).toBeLessThanOrEqual(BENCH_MAX_RUNS)
    expect(r.runs).toBeGreaterThan(0)
    expect(r.matches).toBe(3)
    expect(r.medianMs).toBe(0.5)
  })

  it('stops on the time budget too', () => {
    let t = 0
    const r = runBenchmark('a', 'g', 'a', () => (t += 100))
    expect(r.runs).toBeLessThan(3)
  })
})

describe('regex history', () => {
  it('is newest first, de-duplicated, capped, and ignores blanks', () => {
    let h = pushRegexHistory([], { pattern: 'a', flags: '', at: 1 })
    h = pushRegexHistory(h, { pattern: 'b', flags: '', at: 2 })
    h = pushRegexHistory(h, { pattern: 'a', flags: '', at: 3 })
    expect(h.map((e) => e.pattern)).toEqual(['a', 'b'])
    expect(pushRegexHistory(h, { pattern: '  ', flags: '', at: 4 })).toEqual(h)
    let big = h
    for (let i = 0; i < 40; i++) big = pushRegexHistory(big, { pattern: `p${i}`, flags: '', at: i })
    expect(big.length).toBe(REGEX_HISTORY_MAX)
  })

  it('the store notifies subscribers and clears', () => {
    let calls = 0
    const off = regexHistory.subscribe(() => calls++)
    regexHistory.record({ pattern: 'z', flags: 'i', at: 1 })
    expect(regexHistory.get()[0].pattern).toBe('z')
    regexHistory.clear()
    expect(regexHistory.get()).toEqual([])
    expect(calls).toBe(2)
    off()
  })
})
