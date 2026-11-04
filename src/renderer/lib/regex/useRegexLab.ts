import { useEffect, useRef, useState } from 'react'
import RegexLabWorker from './regexLabWorker?worker'
import { MATCH_TIME_BUDGET_MS } from './engine'
import type { RegexBenchResult, RegexCaseResult, RegexLabResponse, RegexTestCase } from './lab'

export interface RegexLabState {
  status: 'idle' | 'running' | 'ok' | 'timeout' | 'error'
  cases: RegexCaseResult[]
  bench: RegexBenchResult | null
  error: string | null
}

const IDLE: RegexLabState = { status: 'idle', cases: [], bench: null, error: null }

/**
 * Runs the test cases (on every change) and the benchmark (only when `benchNonce` changes, from
 * the Run button) in a dedicated Worker with the same budget as the live preview. A worker that
 * has not answered in time is terminated and the tab says so; it never freezes the window.
 */
export function useRegexLab(
  pattern: string,
  flags: string,
  cases: readonly RegexTestCase[],
  benchSample: string,
  benchNonce: number
): RegexLabState {
  const [state, setState] = useState<RegexLabState>(IDLE)
  const seq = useRef(0)
  const lastBench = useRef(benchNonce)
  const casesKey = JSON.stringify(cases)
  // A benchmark describes one pattern. Changing the pattern or flags drops the old timing rather
  // than showing it beside a pattern it was never measured on.
  const patternKey = `${pattern}\u0000${flags}`
  const benchKey = useRef<string | null>(null)

  useEffect(() => {
    const wantBench = benchNonce !== lastBench.current
    lastBench.current = benchNonce
    if (!pattern.trim() || (cases.length === 0 && !wantBench)) {
      setState(benchKey.current === patternKey ? (s) => ({ ...s, status: 'idle', cases: [] }) : IDLE)
      return
    }
    const id = ++seq.current
    setState((s) => ({ ...s, status: 'running', error: null }))
    const worker = new RegexLabWorker()
    const timer = window.setTimeout(() => {
      worker.terminate()
      setState({
        status: 'timeout',
        cases: [],
        bench: null,
        error: `No answer within ${MATCH_TIME_BUDGET_MS} ms. This pattern is likely too slow on these inputs.`
      })
    }, MATCH_TIME_BUDGET_MS * 2)
    worker.onmessage = (e: MessageEvent<RegexLabResponse>) => {
      if (e.data.id !== id) return
      window.clearTimeout(timer)
      worker.terminate()
      if (e.data.ok) {
        const { cases: caseResults, bench } = e.data
        if (bench) benchKey.current = patternKey
        setState((s) => ({
          status: 'ok',
          cases: caseResults,
          bench: bench ?? (benchKey.current === patternKey ? s.bench : null),
          error: null
        }))
      } else setState({ status: 'error', cases: [], bench: null, error: e.data.error })
    }
    worker.postMessage({ id, pattern, flags, cases: [...cases], benchSample: wantBench ? benchSample : null })
    return () => {
      window.clearTimeout(timer)
      worker.terminate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, flags, casesKey, benchNonce])

  return state
}
