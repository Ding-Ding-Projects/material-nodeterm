import { runMatches } from './matcher'

/** One assertion in the Test cases tab: this text should (or should not) contain a match. */
export interface RegexTestCase {
  text: string
  expect: 'match' | 'no-match'
}

export interface RegexCaseResult {
  matched: boolean
  pass: boolean
  /** The first match, for display, or null. */
  first: string | null
}

export interface RegexBenchResult {
  runs: number
  /** Median wall time of one full scan of the sample, in milliseconds. */
  medianMs: number
  fastestMs: number
  slowestMs: number
  matches: number
}

export interface RegexLabRequest {
  id: number
  pattern: string
  flags: string
  cases: RegexTestCase[]
  /** The sample to benchmark against, or null to skip the benchmark. */
  benchSample: string | null
}

export type RegexLabResponse =
  | { id: number; ok: true; cases: RegexCaseResult[]; bench: RegexBenchResult | null }
  | { id: number; ok: false; error: string }

export const MAX_TEST_CASES = 50
/** A benchmark stops after this many scans or this much total time, whichever comes first, so it
 *  always answers well inside the caller's kill-switch budget. */
export const BENCH_MAX_RUNS = 200
export const BENCH_MAX_TOTAL_MS = 300

export function runCases(pattern: string, flags: string, cases: readonly RegexTestCase[]): RegexCaseResult[] {
  return cases.slice(0, MAX_TEST_CASES).map((c) => {
    const { matches } = runMatches(pattern, flags, c.text)
    const matched = matches.length > 0
    return { matched, pass: matched === (c.expect === 'match'), first: matched ? matches[0].text : null }
  })
}

/** Scan the sample repeatedly and report the spread. `now` is injected so tests are exact. */
export function runBenchmark(pattern: string, flags: string, sample: string, now: () => number): RegexBenchResult {
  const times: number[] = []
  let matches = 0
  const begin = now()
  while (times.length < BENCH_MAX_RUNS && now() - begin < BENCH_MAX_TOTAL_MS) {
    const t0 = now()
    matches = runMatches(pattern, flags, sample).matches.length
    times.push(now() - t0)
  }
  const sorted = [...times].sort((a, b) => a - b)
  return {
    runs: times.length,
    medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
    fastestMs: sorted[0] ?? 0,
    slowestMs: sorted[sorted.length - 1] ?? 0,
    matches
  }
}

/** Summary line for the Test cases tab. */
export function caseSummary(results: readonly RegexCaseResult[]): { passed: number; failed: number } {
  const passed = results.filter((r) => r.pass).length
  return { passed, failed: results.length - passed }
}
