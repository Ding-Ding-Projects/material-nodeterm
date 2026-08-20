// Transcript search plus the two READ channels — the command-palette search (`transcript:search`),
// the ⌘M chat view (`chat:read-transcript`) and the full-transcript reader
// (`claude:read-transcript`) — registered through the CorePlatform seam so BOTH shells serve them.
//
// The read handlers used to live inline in `src/main/index.ts`; transcript search remained there
// after they moved. Either split recreates the same failure mode: the Server Edition has no
// handler, and its bridge silently degrades a real host-side feature into an empty result.
//
// The remote (SSH-project) leg stays an injected dep: it needs a ControlMaster, which only the
// Electron shell has. Absent deps ⇒ local-only, which is the correct and complete answer on the
// server — it runs ON the host whose transcripts it is reading.
import { IPC } from '../shared/ipc'
import type { ChatTranscriptResult, TranscriptLine } from '../shared/types'
import { platform } from './platform'
import { searchTranscripts } from './transcript-index'
import {
  parseChatMessages,
  parseTranscriptLines,
  readChatMessages,
  readTranscriptLines,
  resolveTranscriptPath,
  transcriptPathForCwd,
  SESSION_ID_RE
} from './transcript-reader'

/** What a read is asked for. `nodeId` is only meaningful to the remote leg. */
export interface TranscriptQuery {
  sessionId: string | undefined
  cwd: string | undefined
  accountId: string | undefined
  nodeId: string | undefined
}

export interface TranscriptIpcDeps {
  /** Transcript path a live context tail already knows for this session (hook-fed — authoritative
   *  when present). Optional: the sessionId scan below finds any transcript in a standard root. */
  pathFor?(sessionId: string): string | undefined
  /**
   * Tail text of a REMOTE node's transcript, or null when this is not a remote session (or it
   * could not be resolved). Electron-only — the server has no SSH-project manager.
   */
  readRemote?(q: TranscriptQuery): Promise<string | null>
}

/**
 * Resolve a session's transcript path: the exact session file when a (valid) sessionId is known,
 * else the node's cwd — durable, and needing no live hook event. `accountId` scopes BOTH legs to
 * the same root: dropping it on the fallback sent a managed-account node to the system root, where
 * it found nothing or adopted an unrelated session's newest transcript.
 */
export async function resolveTranscript(
  q: Pick<TranscriptQuery, 'sessionId' | 'cwd' | 'accountId'>,
  pathFor?: (sessionId: string) => string | undefined
): Promise<string | undefined> {
  let p: string | undefined
  if (q.sessionId && SESSION_ID_RE.test(q.sessionId)) {
    p = pathFor?.(q.sessionId) ?? (await resolveTranscriptPath(q.sessionId, q.accountId))
  }
  if (!p && q.cwd) p = await transcriptPathForCwd(q.cwd, q.accountId)
  return p
}

export function registerTranscriptIpc(deps: TranscriptIpcDeps = {}): void {
  const remoteText = (q: TranscriptQuery): Promise<string | null> =>
    deps.readRemote ? deps.readRemote(q) : Promise.resolve(null)

  platform().handle(IPC.transcriptSearch, (query: string) => searchTranscripts(query))

  platform().handle(
    IPC.claudeReadTranscript,
    async (
      sessionId: string | undefined,
      cwd: string | undefined,
      accountId: string | undefined,
      nodeId: string | undefined
    ): Promise<TranscriptLine[]> => {
      const remote = await remoteText({ sessionId, cwd, accountId, nodeId })
      if (remote !== null) return parseTranscriptLines(remote)
      const p = await resolveTranscript({ sessionId, cwd, accountId }, deps.pathFor)
      return p ? readTranscriptLines(p) : []
    }
  )

  platform().handle(
    IPC.chatReadTranscript,
    async (
      sessionId: string | undefined,
      cwd: string | undefined,
      accountId: string | undefined,
      nodeId: string | undefined
    ): Promise<ChatTranscriptResult> => {
      const remote = await remoteText({ sessionId, cwd, accountId, nodeId })
      // A resolved-but-unreadable remote file is NOT "no conversation yet" — the read failed
      // (master down, transcript gone), and the panel must be able to say so.
      if (remote !== null) return { messages: parseChatMessages(remote.split('\n')), found: !!remote }
      const p = await resolveTranscript({ sessionId, cwd, accountId }, deps.pathFor)
      return p
        ? { messages: await readChatMessages(p), found: true }
        : { messages: [], found: false }
    }
  )
}
