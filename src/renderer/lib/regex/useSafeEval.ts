import { useCallback, useEffect, useRef, useState } from 'react'
import RegexEvalWorker from './regexEvalWorker?worker'
import type { RegexWorkerResponse } from './regexEvalWorker'
import { MATCH_TIME_BUDGET_MS } from './engine'
import type { RegexMatchResult } from './matcher'

export type SafeEvalStatus = 'idle' | 'running' | 'ok' | 'timeout' | 'error'

export interface SafeEvalState {
  status: SafeEvalStatus
  matches: RegexMatchResult[]
  truncated: boolean
  error: string | null
  /** The sample with every match substituted per the replacement template — '' until a result
   *  lands (see `status`). */
  substituted: string
}

const IDLE: SafeEvalState = { status: 'idle', matches: [], truncated: false, error: null, substituted: '' }

/**
 * Runs pattern-against-sample matching (and the substitution preview) in a dedicated Web Worker
 * with a hard wall-clock budget (MATCH_TIME_BUDGET_MS). This is the app's real defense against
 * catastrophic backtracking: a pathological pattern can spin the WORKER thread forever, but the
 * renderer (and the rest of the app) stays responsive, and once the budget expires the worker is
 * terminated and a fresh one spun up for the next request — the user sees "this pattern is taking
 * too long" instead of a frozen tab.
 *
 * Nothing evaluated here ever leaves the machine: the worker is a same-origin bundled script, and
 * requests/responses are plain postMessage payloads that die with the worker.
 */
export function useSafeEval(pattern: string, flags: string, sample: string, replacement: string): SafeEvalState {
  const [state, setState] = useState<SafeEvalState>(IDLE)
  const workerRef = useRef<Worker | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const seq = useRef(0)

  const killWorker = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!pattern.trim()) {
      killWorker()
      setState(IDLE)
      return
    }
    const id = ++seq.current
    killWorker()
    setState({ status: 'running', matches: [], truncated: false, error: null, substituted: '' })

    const worker = new RegexEvalWorker()
    workerRef.current = worker
    worker.onmessage = (e: MessageEvent<RegexWorkerResponse>) => {
      if (e.data.id !== id) return
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      if (e.data.ok) {
        setState({ status: 'ok', matches: e.data.matches, truncated: e.data.truncated, error: null, substituted: e.data.substituted })
      } else {
        setState({ status: 'error', matches: [], truncated: false, error: e.data.error, substituted: '' })
      }
    }
    worker.postMessage({ id, pattern, flags, sample, replacement })
    timeoutRef.current = window.setTimeout(() => {
      // The worker hasn't answered within budget — presume it's stuck in catastrophic
      // backtracking and kill it. A fresh worker will be created on the next request; this
      // stale one is terminated so it can never post a late, out-of-order response.
      killWorker()
      setState({
        status: 'timeout',
        matches: [],
        truncated: false,
        error: `No answer within ${MATCH_TIME_BUDGET_MS} ms — this pattern is likely catastrophically slow. Try a narrower pattern.`,
        substituted: ''
      })
    }, MATCH_TIME_BUDGET_MS)

    return killWorker
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, flags, sample, replacement])

  useEffect(() => killWorker, [killWorker])

  return state
}
