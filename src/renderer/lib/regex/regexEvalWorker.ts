/**
 * Runs the builder's live match preview OFF the main thread. This is the real protection against
 * catastrophic backtracking: `looksCatastrophic` in safety.ts is a static heuristic used to guard
 * SYNCHRONOUS inline filters (menus, lists) where there's no time for a message round-trip, but it
 * can miss a pathological pattern. A pattern this worker can't finish in time just gets its Worker
 * killed by the caller (useSafeEval.ts) — the sample text and pattern never touch the network, and
 * nothing here persists past the message itself.
 *
 * The substitution preview (`substituted`) runs the SAME pattern against the SAME sample a second
 * time, via native `.replace()`, inside this same time-boxed worker — deliberately not
 * reimplemented by hand as a $-token expander on the main thread. Native `.replace()` is the
 * ground truth for `$1`/`$<name>`/`$&`/`` $` ``/`$'` semantics, and running it here means it is
 * covered by the exact same wall-clock kill switch as the match preview rather than being a
 * second, unguarded ReDoS surface.
 */
import { runMatches } from './matcher'

export interface RegexWorkerRequest {
  id: number
  pattern: string
  flags: string
  sample: string
  /** Substitution template — may be empty (a valid "delete every match" preview). */
  replacement: string
}

export type RegexWorkerResponse =
  | {
      id: number
      ok: true
      matches: ReturnType<typeof runMatches>['matches']
      truncated: boolean
      substituted: string
    }
  | { id: number; ok: false; error: string }

self.onmessage = (e: MessageEvent<RegexWorkerRequest>) => {
  const { id, pattern, flags, sample, replacement } = e.data
  try {
    const { matches, truncated } = runMatches(pattern, flags, sample)
    const globalFlags = flags.includes('g') ? flags : `${flags}g`
    const substituted = sample.replace(new RegExp(pattern, globalFlags), replacement)
    const res: RegexWorkerResponse = { id, ok: true, matches, truncated, substituted }
    ;(self as unknown as Worker).postMessage(res)
  } catch (err) {
    const res: RegexWorkerResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
    ;(self as unknown as Worker).postMessage(res)
  }
}
