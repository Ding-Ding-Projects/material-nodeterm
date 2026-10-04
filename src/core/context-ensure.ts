// The context meter's mount-time rehydration (`context:ensure`), registered through the
// CorePlatform seam so BOTH shells serve it.
//
// This used to be written twice, once inline in `src/main/index.ts` and once in the Server Edition
// (where it was even registered twice: `src/server/agent-status.ts` and `src/server/index.ts` each
// added a listener, so every browser ensure ran two resolves with two different claude fallbacks).
// One handler in core is the cure for that drift, exactly as `core/transcript-ipc.ts` was for the
// transcript READ channels.
//
// What it is for: a tmux session outlives the app, so after a restart a continuing agent session is
// idle and emits no hook event, and a hook event is the only other thing that ever feeds the
// meter. Without a mount-time read the meter stays blank until the user sends a prompt.
//
// THREE rules shape everything below.
//
// 1. **Per agent, never one resolver for all of them.** Claude's `resolveTranscript` has a cwd
//    fallback that answers *the newest claude transcript for that cwd*, and a codex/gemini session
//    id always misses its sessionId leg, so pointing it at a non-claude node hands that node a
//    STRANGER's session as its meter (wrong numerator and wrong denominator), then flaps against
//    the correct tail. So each agent resolves through its OWN locator and tracks on its OWN tail
//    (whose own `parse` keeps the per-agent token formulas separate, as they must be).
// 2. **A remote session is resolved on the HOST or not at all.** For an SSH-project node the
//    transcript is on the other machine; falling through to any local resolver searches this
//    machine's disk for a file that only ever existed there. So the remote leg's "could not
//    resolve" is TERMINAL, never a fall-through, and it is never remembered as an absence either
//    (see `ContextEnsureDeps.ensureRemote`). Remoteness has TWO independent claims, OR-ed: the
//    renderer's (`remote`, which knows the node belongs to an SSH project from the moment it
//    mounts) and the shell's (a live ControlMaster for the node, which only exists once the pty
//    has been created). A mount races pty creation, so the shell's claim alone would send an early
//    remote ensure down the local path.
// 3. **A located path is admitted through the shell's own jail when the shell gives one.** The
//    locators only walk their own roots, but the same jail the hook-fed paths pass costs nothing
//    and keeps one rule for every path a tail is ever handed.
import { IPC } from '../shared/ipc'
import { platform } from './platform'
import type { ContextTail } from './context-tail'
import { locateCodex, locateGemini } from './handoff/locate'
import { resolveTranscript } from './transcript-ipc'
import { SESSION_ID_RE } from './transcript-reader'

/** What an ensure is asked for. `nodeId` and `remote` are only meaningful to the remote leg. */
export interface ContextEnsureQuery {
  sessionId: string
  cwd: string | undefined
  accountId: string | undefined
  agentId: string | undefined
  nodeId: string | undefined
  /** The renderer's claim that this node runs on an SSH project's host. */
  remote: boolean
}

/**
 * The remote leg's answer.
 *
 * `'tracked'`: the host was asked, a transcript was found, the remote tail now has it.
 * `'unresolved'`: this IS a remote session and we do not have a path for it: the host looked and
 *   found nothing, the ControlMaster was down or not yet up, the home was unresolved, or this
 *   agent has no remote locator at all. Deliberately ONE value: the remote locator cannot tell a
 *   clean miss from a failed ssh call, and inventing that distinction here would be a claim it
 *   cannot support. Both mean the same two things: no meter this pass, and NOTHING cached, so the
 *   next mount (or the next hook event) tries again from scratch. A failed read must never be
 *   remembered as an absence.
 *
 * `null` (not this type) means "not a remote session at all": take the local path.
 */
export type RemoteEnsureOutcome = 'tracked' | 'unresolved'

/** Which leg tracked a session: the shell maps it to its own context source key. */
export type ContextEnsureLeg = 'local' | 'remote'

export interface ContextEnsureDeps {
  /**
   * The tail that meters this agent locally, or `undefined` when the agent has no local
   * rehydration path. One tail per agent, each with its own `parse`; see `createContextTail`.
   */
  tailFor(agentId: string | undefined): ContextTail | undefined
  /**
   * Resolve and track a REMOTE (SSH-project) node's transcript on its host, or `null` when this is
   * not a remote session: the same `null` convention `TranscriptIpcDeps.readRemote` uses, and the
   * signal to take the local path below. Desktop-only: the Server Edition has no SSH-project
   * manager, and needs none (it runs ON the host whose transcripts it reads).
   */
  ensureRemote?(q: ContextEnsureQuery): Promise<RemoteEnsureOutcome | null>
  /**
   * The shell's local transcript jail: the normalized path when it lies under an allowed root,
   * else `undefined`. Absent means every located path is admitted as-is.
   */
  admitLocalPath?(transcriptPath: string): string | undefined
  /**
   * Called after a session is tracked (or found already tracked) for a query that named its node,
   * so the shell can record the node to session association its hook listener records for a live
   * event: closing the node then releases the tail, and the per-node context ring can find it.
   */
  onTracked?(q: ContextEnsureQuery, leg: ContextEnsureLeg): void
}

/**
 * Locate this agent's transcript on the LOCAL disk, or `undefined` when it has no local locator.
 *
 * A closed switch, not a default-to-claude: an agent that reaches here unrecognized gets NO meter,
 * which can never be wrong. Adding one means adding its locator here, next to the tail that parses
 * its numbers.
 *
 * - **claude**: `resolveTranscript`, including its `accountId`-scoped cwd fallback (correct here:
 *   the file genuinely is claude's, and the account scoping is what keeps a managed-account node
 *   off the system root).
 * - **codex / gemini**: `locateCodex` / `locateGemini`, keyed STRICTLY by session id with no cwd
 *   fallback, so neither can adopt a session that is not its own.
 * - **grok**: none, by construction rather than by omission. Grok's meter reads `signals.json` out
 *   of a session directory learned from a hook event, which is empty after a restart. There is
 *   nothing to rehydrate from.
 */
function localTranscriptFor(
  q: ContextEnsureQuery,
  pathFor?: (s: string) => string | undefined
): Promise<string | undefined> {
  switch (q.agentId) {
    // `undefined` is the legacy call shape (the channel carried no agent id, and its one caller was
    // claude-gated), so it keeps resolving as claude.
    case undefined:
    case 'claude':
      return resolveTranscript(
        { sessionId: q.sessionId, cwd: q.cwd, accountId: q.accountId },
        pathFor
      )
    case 'codex':
      return locateCodex(q.sessionId)
    case 'gemini':
      return locateGemini(q.sessionId)
    default:
      return Promise.resolve(undefined)
  }
}

/** A wire argument is a hand value: anything that is not a non-empty string reads as absent. */
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

export function registerContextEnsureIpc(deps: ContextEnsureDeps): void {
  // Ensure calls arrive on mount, and the renderer's effect re-runs when the session id, cwd or
  // account changes; the canvas node and the board card can also mount the same node at once. So
  // the same query can be asked twice while the first answer (an ssh round-trip, on a canvas that
  // can hold dozens of remote nodes) is still in flight. De-duplicating the IN-FLIGHT call is not a
  // cache: nothing is remembered once it settles, so a resolve that failed is retried by the next
  // ensure exactly as if this guard were not here.
  const inFlight = new Set<string>()
  const noteTracked = (q: ContextEnsureQuery, leg: ContextEnsureLeg): void => {
    if (q.nodeId) deps.onTracked?.(q, leg)
  }

  platform().on(
    IPC.contextEnsure,
    async (
      sessionIdArg?: unknown,
      cwdArg?: unknown,
      accountIdArg?: unknown,
      agentIdArg?: unknown,
      nodeIdArg?: unknown,
      remoteArg?: unknown
    ): Promise<void> => {
      const sessionId = str(sessionIdArg)
      if (!sessionId || !SESSION_ID_RE.test(sessionId)) return
      const q: ContextEnsureQuery = {
        sessionId,
        cwd: str(cwdArg),
        accountId: str(accountIdArg),
        agentId: str(agentIdArg),
        nodeId: str(nodeIdArg),
        remote: remoteArg === true
      }
      // Every field that changes the answer is part of the key, so a query that differs only by
      // its account or its remoteness is never swallowed by an older one still in flight.
      const key = JSON.stringify([q.agentId, q.sessionId, q.nodeId, q.accountId, q.cwd, q.remote])
      if (inFlight.has(key)) return
      inFlight.add(key)
      try {
        // Remote first, and its answer is TERMINAL either way. A remote session that could not be
        // resolved must not fall through to the local resolver: that reads the wrong machine's
        // disk, which for claude means metering an unrelated local session under this node's id.
        if (deps.ensureRemote) {
          const outcome = await deps.ensureRemote(q)
          if (outcome !== null) {
            if (outcome === 'tracked') noteTracked(q, 'remote')
            return
          }
        }
        // The renderer said remote and no remote leg answered for it (the Server Edition has none,
        // and a desktop leg only returns `null` when neither claim holds). Nothing local may answer
        // for a session that lives on another machine.
        if (q.remote) return
        const tail = deps.tailFor(q.agentId)
        if (!tail) return
        // The tail's own path is the authoritative hint for claude's resolver (hook-fed when
        // present) AND the early-out for everyone: a session already tracked needs no scan.
        if (tail.pathFor(sessionId)) {
          noteTracked(q, 'local')
          return
        }
        const located = await localTranscriptFor(q, (s) => tail.pathFor(s))
        const p = located && (deps.admitLocalPath ? deps.admitLocalPath(located) : located)
        if (!p) return
        tail.track(sessionId, p)
        noteTracked(q, 'local')
      } finally {
        inFlight.delete(key)
      }
    }
  )
}
