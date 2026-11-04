/**
 * The workbench's Test cases and Benchmark tabs, run OFF the main thread under the same kind of
 * wall-clock kill switch as the live preview (useRegexLab.ts). Separate from regexEvalWorker so a
 * slow benchmark never delays or cancels the live highlight the user is typing against.
 *
 * Nothing here is sent anywhere or kept: the request and answer die with the message.
 */
import { runCases, runBenchmark, type RegexLabRequest, type RegexLabResponse } from './lab'

self.onmessage = (e: MessageEvent<RegexLabRequest>) => {
  const { id, pattern, flags, cases, benchSample } = e.data
  try {
    const res: RegexLabResponse = {
      id,
      ok: true,
      cases: runCases(pattern, flags, cases),
      bench: benchSample === null ? null : runBenchmark(pattern, flags, benchSample, () => performance.now())
    }
    ;(self as unknown as Worker).postMessage(res)
  } catch (err) {
    const res: RegexLabResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
    ;(self as unknown as Worker).postMessage(res)
  }
}
