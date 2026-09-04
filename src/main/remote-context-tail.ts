// Remote counterpart of context-tail.ts: tails a Claude transcript .jsonl that lives on a
// REMOTE host (read over the project's ControlMaster via an injected RemoteFile) and pushes
// the IDENTICAL ContextWindowUsage IPC the local tail does — the renderer can't tell remote
// from local. Reuses the pure parser (parseLatestUsage) + model-window resolution from the
// local tail; differs only in being async (the read is an ssh round-trip), so it async-polls
// with a per-session in-flight `reading` flag that skips a tick instead of overlapping reads.
import { type BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { IPC } from '../shared/ipc'
import type { ContextWindowUsage } from '../shared/types'
import { cachedWindowFor, resolveModelWindow } from '../core/model-window'
import {
  parseLatestUsage,
  parseTaskNotifications,
  hasToolResult,
  type ContextTailOptions
} from '../core/context-tail'
import { splitCompleteLines } from '../core/subagent-tail'
import { sshHostKey } from '../shared/ssh'
import { MAX_REMOTE_FILE_BYTES, type RemoteFile, type RemoteFileRef } from './remote-ssh/remote-file'

const POLL_MS = 1000
// Cap the first read like the local tail: a resumed transcript can be many MB. Only the LATEST
// assistant usage matters, so a tail of the file is enough. Defined locally (not imported) so
// context-tail.ts stays untouched; value mirrors its INITIAL_READ_CAP.
const INITIAL_READ_CAP = 1024 * 1024 // 1 MB
const MAX_RETIRED_EPOCHS = 4096
const remoteSource = (ref: RemoteFileRef): string => `${sshHostKey(ref.conn)}:${ref.conn.port ?? 22}`

interface Tracked {
  ref: RemoteFileRef
  offset: number
  used: number
  window: number
  model: string | null
  // In-flight guard: a slow ssh read must not overlap with the next tick.
  reading: boolean
  // Last pushed snapshot — a push fires only when one of these changes.
  lastUsed: number
  lastModel: string | null
  lastWindow: number
  /** Partial trailing line held back until the next read completes it (see subagent-tail.ts). */
  carry: Buffer | null
  generation: number
  epoch: string
  source: string
  epochHistory: string[]
  incarnation: number
  producerId: string
  lifecycle: number
  producerHistory: string[]
}

export interface RemoteContextTail {
  track(sessionId: string | undefined, ref: RemoteFileRef | undefined): void
  untrack(sessionId: string | undefined): void
  /** The transcript path currently tracked for a session, if any. */
  pathFor(sessionId: string | undefined): string | undefined
}

export function createRemoteContextTail(
  win: BrowserWindow,
  remoteFile: RemoteFile,
  opts?: ContextTailOptions
): RemoteContextTail {
  const sessions = new Map<string, Tracked>()
  const producerId = randomUUID()
  let nextLifecycle = 0
  const nextEpoch = (): { epoch: string; lifecycle: number } => {
    const lifecycle = ++nextLifecycle
    return { lifecycle, epoch: `${producerId}:${lifecycle}` }
  }
  let timer: ReturnType<typeof setInterval> | null = null
  const provider = opts?.provider ?? 'claude'
  const sourceKey = opts?.sourceKey ?? `${provider}:remote`
  const sourceEpoch = randomUUID()

  // Usage parses the whole read (carry included) — it tolerates torn lines and the latest
  // value wins, so it must not wait for a newline. Notifications scan COMPLETE lines only,
  // with the torn tail carried into the next read (see subagent-tail.ts), so a torn
  // <task-notification> is completed later instead of being lost.
  const scan = (sessionId: string, t: Tracked, read: string): void => {
    const buf = Buffer.from(read)
    const combined = t.carry?.length ? Buffer.concat([t.carry, buf]) : buf
    t.carry = splitCompleteLines(combined).carry
    // ONE split shared by all three scanners (mirrors the local tail): the last element is the
    // torn tail past the final newline, so dropping it yields the complete lines.
    const lines = combined.toString('utf-8').split('\n')
    const completeLines = lines.slice(0, -1)
    const latest = parseLatestUsage(lines)
    if (latest) {
      t.used = latest.used
      t.model = latest.model ?? t.model
    }
    if (opts?.onToolResult && hasToolResult(completeLines)) opts.onToolResult(sessionId)
    if (opts?.onTaskNotification) {
      for (const n of parseTaskNotifications(completeLines)) opts.onTaskNotification(sessionId, n)
    }
  }

  const push = (sessionId: string, t: Tracked): void => {
    if (win.isDestroyed()) return
    const usedPercent =
      Number.isFinite(t.used) && Number.isFinite(t.window) && t.used >= 0 && t.window > 0
        ? Math.min(100, Math.max(0, (t.used / t.window) * 100))
        : null
    const payload: ContextWindowUsage = {
      sessionId,
      provider,
      sourceKey,
      usedTokens: Number.isFinite(t.used) && t.used >= 0 ? t.used : null,
      windowTokens: Number.isFinite(t.window) && t.window > 0 ? t.window : null,
      usedPercent,
      status: usedPercent === null ? 'unknown' : 'known',
      model: t.model,
      generation: ++t.generation,
      sourceEpoch,
      updatedAt: Date.now(),
      epoch: t.epoch,
      incarnation: t.incarnation,
      producerId: t.producerId,
      lifecycle: t.lifecycle,
      agentId: opts?.agentId ?? provider,
      source: t.source,
      epochHistory: t.epochHistory,
      producerHistory: t.producerHistory
    }
    win.webContents.send(IPC.contextUpdate, payload)
  }

  // One async read+reconcile pass for a session. Fail-open: RemoteFile already returns empty on
  // error, so a failed read keeps the last value. The `reading` flag skips overlapping ticks.
  const read = async (sessionId: string, t: Tracked): Promise<void> => {
    if (t.reading) return
    const readEpoch = t.epoch
    t.reading = true
    try {
      if (t.offset === 0) {
        // First read: grab the tail plus the remote's absolute byte length in one round trip.
        // Advancing by the returned tail length would make the next read replay most of a large
        // transcript and could let stale lines win.
        const first = await remoteFile.readTailWithSize(t.ref, INITIAL_READ_CAP)
        if (
          first &&
          Buffer.isBuffer(first.data) &&
          first.data.length <= INITIAL_READ_CAP &&
          Number.isSafeInteger(first.size) &&
          first.size >= 0 &&
          first.size <= MAX_REMOTE_FILE_BYTES &&
          first.data.length <= first.size
        ) {
          t.offset = first.size
          scan(sessionId, t, first.data.toString('utf-8'))
        }
      } else {
        const { data, newOffset } = await remoteFile.readFromCapped(t.ref, t.offset, INITIAL_READ_CAP)
        if (
          !Buffer.isBuffer(data) ||
          data.length > INITIAL_READ_CAP ||
          !Number.isSafeInteger(newOffset) ||
          newOffset < t.offset ||
          newOffset > MAX_REMOTE_FILE_BYTES
        ) {
          return
        }
        t.offset = newOffset
        if (data.length) scan(sessionId, t, data.toString('utf8'))
      }
    } catch {
      // An injected/runtime adapter may reject or expose an incomplete surface. Keep the
      // polling loop alive and preserve the last known usage instead of leaking a rejection
      // from the fire-and-forget read started by track() or setInterval().
      return
    } finally {
      t.reading = false
    }

    if (sessions.get(sessionId) !== t || t.epoch !== readEpoch) return
    // Reconcile the window every pass, same resolution as the local tail.
    if (t.model) void resolveModelWindow(t.model).catch(() => {})
    const window = cachedWindowFor(t.model)

    if (t.used > 0 && (t.used !== t.lastUsed || t.model !== t.lastModel || window !== t.lastWindow)) {
      t.window = window
      push(sessionId, t)
      t.lastUsed = t.used
      t.lastModel = t.model
      t.lastWindow = window
    }
  }

  const tick = (): void => {
    for (const [sessionId, t] of sessions) void read(sessionId, t)
    if (!sessions.size && timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    track(sessionId, ref) {
      if (!sessionId || !ref) return
      const existing = sessions.get(sessionId)
      if (existing) {
        const sameSource = existing.ref.path === ref.path && existing.ref.controlPath === ref.controlPath && existing.ref.conn.host === ref.conn.host && existing.ref.conn.user === ref.conn.user && (existing.ref.conn.port ?? 22) === (ref.conn.port ?? 22)
        if (!sameSource) {
          const priorEpoch = existing.epoch
          existing.ref = ref
          existing.offset = 0
          existing.carry = null
          existing.used = 0
          existing.window = 0
          existing.model = null
          existing.lastUsed = 0
          existing.lastModel = null
          existing.lastWindow = 0
          const next = nextEpoch()
          existing.epoch = next.epoch
          existing.lifecycle = next.lifecycle
          existing.incarnation = next.lifecycle
          existing.epochHistory = [...existing.epochHistory, priorEpoch].slice(-MAX_RETIRED_EPOCHS)
          existing.source = remoteSource(ref)
        }
        return
      }
      const { epoch, lifecycle } = nextEpoch()
      const t: Tracked = {
        ref,
        offset: 0,
        used: 0,
        window: 0,
        model: null,
        reading: false,
        lastUsed: 0,
        lastModel: null,
        lastWindow: 0,
        carry: null,
        generation: 0,
        epoch,
        source: remoteSource(ref),
        epochHistory: [],
        incarnation: lifecycle,
        producerId,
        lifecycle,
        producerHistory: []
      }
      sessions.set(sessionId, t)
      void read(sessionId, t) // immediate first value (resumed sessions already have content)
      if (!timer) timer = setInterval(tick, POLL_MS)
    },
    untrack(sessionId) {
      if (!sessionId) return
      sessions.delete(sessionId)
      generations.delete(sessionId)
      if (!sessions.size && timer) {
        clearInterval(timer)
        timer = null
      }
    },
    pathFor(sessionId) {
      if (!sessionId) return undefined
      return sessions.get(sessionId)?.ref.path
    }
  }
}
