import type { CorePlatform } from './platform'
import { BoardLogStore, type RemoteLogExec } from './board-log'
import { IPC } from '../shared/ipc'
import type { BoardLogEntry, BoardLogReadOpts, BoardLogReadResult } from '../shared/types'
import {
  decodeBoardAttachmentBase64,
  readBoardAttachment,
  readBoardAttachmentSource,
  remoteBoardAttachmentPath
} from './board-attachments'
import type {
  BoardAttachmentDraft,
  BoardAttachmentReadResult,
  BoardLogAppendResult
} from '../shared/comment-attachments'
import { createHash } from 'node:crypto'

// Board-log RPC surface, registered ONCE for every shell (Electron main + Server Edition) through
// CorePlatform — the same seam fs-handlers.ts uses, so the two can never drift. The pure log I/O is
// already in core/board-log.ts; this only wires request/response + the per-project change push, and
// delegates the "where does this project's log live?" question to an injected BoardLogRouter (the one
// piece that differs per shell: desktop resolves SSH connections, the server never does).

/** Where a project's board log lives, resolved per call by the shell.
 *  - `local`  → node:fs under `cwd/.nodeterm/board-log.jsonl`.
 *  - `remote` → desktop SSH: `exec` does the append/tail over the ControlMaster; `fingerprint`
 *               returns a cheap size/hash (`wc -c`) the change-poll compares every 5s.
 *  - `unsupported` → inline/no-cwd canvas, a disconnected SSH project, or an SSH project on the
 *               Server Edition (v1). Reads answer `{ entries: [], unsupported: true }`; appends `false`. */
export type BoardLogRoute =
  | { kind: 'local'; cwd: string }
  | { kind: 'remote'; remoteCwd: string; exec: RemoteLogExec; fingerprint: () => Promise<string> }
  | { kind: 'unsupported' }

export interface BoardLogRouter {
  route(projectId: string): BoardLogRoute
}

const POLL_MS = 5000

/** Registers boardLogAppend / boardLogRead / boardLogSubscribe / boardLogUnsubscribe and drives the
 *  per-project `boardLogChanged` push. Ref-counted per project: the first subscriber starts a watch
 *  (local fs.watch) or a poll (desktop SSH), the last one stops it. */
/**
 * Append one entry through a router — the same routing the `boardLogAppend` IPC handler performs,
 * exported so an in-process writer (the agent-messaging delivery trace) appends through the
 * identical local/remote/unsupported decision instead of restating it. `false` covers both "no
 * reachable log" (a cwd-less inline project, a disconnected SSH project) and a failed write —
 * exactly the answer `recordDelivery` treats as "ring only".
 */
export function appendBoardLogVia(
  router: BoardLogRouter,
  projectId: string,
  entry: BoardLogEntry,
  localStore = new BoardLogStore({})
): Promise<boolean> {
  const r = router.route(projectId)
  if (r.kind === 'local') return localStore.append(r.cwd, entry)
  if (r.kind === 'remote') return new BoardLogStore({ remote: r.exec }).append(r.remoteCwd, entry)
  return Promise.resolve(false)
}

/** What `registerBoardLogHandlers` hands back: an in-process `append` that a MAIN-side caller (the
 *  `browser --cookies` trace, PR 9 Task 9.2) uses to write a board-log line WITHOUT an IPC round-trip
 *  through the renderer — the same local/remote/unsupported routing the `boardLogAppend` handler
 *  performs, sharing the one `localStore`. */
export interface BoardLogHandlers {
  append(projectId: string, entry: BoardLogEntry): Promise<boolean>
  appendWithAttachments(projectId: string, entry: BoardLogEntry, drafts: BoardAttachmentDraft[]): Promise<BoardLogAppendResult>
  readAttachment(projectId: string, attachment: import('../shared/comment-attachments').BoardAttachmentRef): Promise<BoardAttachmentReadResult>
}

export function registerBoardLogHandlers(platform: CorePlatform, router: BoardLogRouter): BoardLogHandlers {
  const localStore = new BoardLogStore({})

  platform.handle(IPC.boardLogAppend, async (projectId: string, entry: BoardLogEntry): Promise<boolean> => {
    return appendBoardLogVia(router, projectId, entry, localStore)
  })

  const appendWithAttachments = async (projectId: string, entry: BoardLogEntry, drafts: BoardAttachmentDraft[]): Promise<BoardLogAppendResult> => {
    const route = router.route(projectId)
    if (route.kind === 'unsupported') return { ok: false, reason: 'unsupported', message: 'Comments with files need a project folder.' }
    if (!Array.isArray(drafts) || drafts.length > 16 || !entry || entry.attachments !== undefined) return { ok: false, reason: 'invalid-entry', message: 'The comment or attachment queue is invalid.' }
    if (route.kind === 'local') return localStore.appendWithAttachments(route.cwd, entry, drafts)
    if (!route.exec.writeAttachment || !route.exec.removeAttachment) return { ok: false, reason: 'unsupported', message: 'This remote project cannot store comment attachments yet.' }
    const stored: Array<{ ref: import('../shared/comment-attachments').BoardAttachmentRef; path: string }> = []
    try {
      for (const draft of drafts) {
        const source = await readBoardAttachmentSource(draft)
        const remotePath = remoteBoardAttachmentPath(route.remoteCwd, source.ref)
        await route.exec.writeAttachment(remotePath, Buffer.from(source.data).toString('base64'))
        stored.push({ ref: source.ref, path: remotePath })
      }
      const enriched = { ...entry, attachments: stored.map((item) => item.ref) }
      if (!await new BoardLogStore({ remote: route.exec }).append(route.remoteCwd, enriched)) throw Object.assign(new Error('The comment could not be saved; attachment files were rolled back.'), { attachmentReason: 'log-failed' })
      return { ok: true, entry: enriched }
    } catch (error) {
      for (const item of stored) await route.exec.removeAttachment(item.path).catch(() => {})
      const reason = (error as { attachmentReason?: string }).attachmentReason
      return { ok: false, reason: reason === 'log-failed' ? 'log-failed' : 'read-failed', message: error instanceof Error ? error.message : 'The comment could not be saved.' }
    }
  }
  platform.handle(IPC.boardLogAppendWithAttachments, appendWithAttachments)

  const readAttachment = async (projectId: string, attachment: import('../shared/comment-attachments').BoardAttachmentRef): Promise<BoardAttachmentReadResult> => {
    const route = router.route(projectId)
    if (route.kind === 'unsupported') return { ok: false, reason: 'unsupported', message: 'This project has no attachment folder.' }
    try {
      let data: Uint8Array
      if (route.kind === 'local') data = await readBoardAttachment(route.cwd, attachment)
      else {
        if (!route.exec.readAttachment) return { ok: false, reason: 'unsupported', message: 'This remote project cannot read comment attachments yet.' }
        const encoded = await route.exec.readAttachment(remoteBoardAttachmentPath(route.remoteCwd, attachment))
        if (!encoded) return { ok: false, reason: 'missing', message: `Attachment carrier is missing: ${attachment.name}` }
        data = decodeBoardAttachmentBase64(encoded)
      }
      const encoded = Buffer.from(data).toString('base64')
      const digest = createHash('sha256').update(data).digest('hex')
      const detected = (await import('./board-attachments')).detectBoardAttachmentKind(data)
      if (data.byteLength !== attachment.bytes || digest !== attachment.sha256 || detected.kind !== attachment.kind || detected.mime !== attachment.mime) return { ok: false, reason: 'integrity-failed', message: `Attachment integrity validation failed for ${attachment.name}.` }
      return { ok: true, attachment, dataBase64: encoded }
    } catch (error) {
      return { ok: false, reason: 'read-failed', message: error instanceof Error ? error.message : 'The attachment could not be read.' }
    }
  }
  platform.handle(IPC.boardLogReadAttachment, readAttachment)

  platform.handle(
    IPC.boardLogRead,
    async (projectId: string, opts?: BoardLogReadOpts): Promise<BoardLogReadResult> => {
      const r = router.route(projectId)
      if (r.kind === 'local') return { entries: await localStore.read(r.cwd, opts) }
      if (r.kind === 'remote')
        return { entries: await new BoardLogStore({ remote: r.exec }).read(r.remoteCwd, opts) }
      return { entries: [], unsupported: true }
    }
  )

  // Change subscription, ref-counted per project id (the renderer subscribes/unsubscribes as its
  // board panel mounts/unmounts; a leaked subscription is at worst one idle fs.watch/poll).
  interface Sub {
    count: number
    stop: () => void
  }
  const subs = new Map<string, Sub>()

  const startWatch = (projectId: string): (() => void) => {
    const emit = (): void => platform.broadcast(IPC.boardLogChanged(projectId), projectId)
    const r = router.route(projectId)
    if (r.kind === 'local') return localStore.watch(r.cwd, emit)
    if (r.kind === 'remote') {
      let last: string | undefined
      let alive = true
      const tick = async (): Promise<void> => {
        if (!alive) return
        try {
          const fp = await r.fingerprint()
          if (last !== undefined && fp !== last) emit()
          last = fp
        } catch {
          /* transient ssh failure: keep the last fingerprint, retry next tick */
        }
      }
      void tick()
      const timer = setInterval(() => void tick(), POLL_MS)
      return () => {
        alive = false
        clearInterval(timer)
      }
    }
    return () => {}
  }

  platform.on(IPC.boardLogSubscribe, (projectId: string) => {
    const existing = subs.get(projectId)
    if (existing) {
      existing.count++
      return
    }
    subs.set(projectId, { count: 1, stop: startWatch(projectId) })
  })

  platform.on(IPC.boardLogUnsubscribe, (projectId: string) => {
    const existing = subs.get(projectId)
    if (!existing) return
    existing.count--
    if (existing.count <= 0) {
      existing.stop()
      subs.delete(projectId)
    }
  })

  // The in-process append: shares this registration's router + localStore, so a main-side writer and
  // the IPC handler can never route a project's log differently.
  return {
    append: (projectId: string, entry: BoardLogEntry): Promise<boolean> =>
      appendBoardLogVia(router, projectId, entry, localStore),
    appendWithAttachments,
    readAttachment
  }
}
