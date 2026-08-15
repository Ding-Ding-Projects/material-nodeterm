/**
 * Runs the builder's live match preview OFF the main thread. This is the real protection against
 * catastrophic backtracking: `looksCatastrophic` in safety.ts is a static heuristic used to guard
 * SYNCHRONOUS inline filters (menus, lists) where there's no time for a message round-trip, but it
 * can miss a pathological pattern. A pattern this worker can't finish in time just gets its Worker
 * killed by the caller (useSafeEval.ts) — the sample text and pattern never touch the network, and
 * nothing here persists past the message itself.
 */
import { runMatches } from './matcher'

export interface RegexWorkerRequest {
  id: number
  pattern: string
  flags: string
  sample: string
}

export type RegexWorkerResponse =
  | { id: number; ok: true; matches: ReturnType<typeof runMatches>['matches']; truncated: boolean }
  | { id: number; ok: false; error: string }

self.onmessage = (e: MessageEvent<RegexWorkerRequest>) => {
  const { id, pattern, flags, sample } = e.data
  try {
    const { matches, truncated } = runMatches(pattern, flags, sample)
    const res: RegexWorkerResponse = { id, ok: true, matches, truncated }
    ;(self as unknown as Worker).postMessage(res)
  } catch (err) {
    const res: RegexWorkerResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
    ;(self as unknown as Worker).postMessage(res)
  }
}
