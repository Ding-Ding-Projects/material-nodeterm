import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, open, readdir, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { renameAtomic } from '../fs-atomic'
import { Writable } from 'node:stream'
import { WHISPER_DOWNLOAD_BASE, WHISPER_MODELS, whisperModel } from '../../shared/speech'

/** A foreign fragment must be untouched while another desktop/server/container may still own it.
 * Ongoing downloads refresh their part's mtime as they write; a full day without modification
 * makes an ownerless/crashed fragment eligible without turning the directory into an orphan
 * archive. */
export const WHISPER_PART_STALE_MS = 24 * 60 * 60 * 1_000
const PART_RESERVATION_ATTEMPTS = 8

function isAlreadyExists(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'
}

export interface WhisperModelStoreOptions {
  dir: string
  fetchFn?: typeof fetch
  onProgress?: (id: string, pct: number) => void
  /** Test seams. Production uses independent cryptographic ids for every store and part. */
  partOwnerId?: string
  nextPartId?: () => string
  now?: () => number
}

/** Downloads and manages the local ggml whisper models. The fences here are
 * lessons already paid for on iOS: a download streams to a per-download
 * `<file>.part.<storeId>.<partId>`
 * and renames only on completion; delete() aborts an in-flight download and a
 * late chunk can never resurrect a deleted model; concurrent download() of
 * the same id in this store joins the same promise instead of racing two writers. A second
 * desktop, Server Edition, or container may share the directory, so cleanup removes this store's
 * inactive fragments immediately but preserves foreign fragments until they are stale. */
export class WhisperModelStore {
  private readonly dir: string
  private readonly fetchFn: typeof fetch
  private readonly onProgress?: (id: string, pct: number) => void
  private readonly partOwnerId: string
  private readonly nextPartId: () => string
  private readonly now: () => number
  private readonly activeParts = new Set<string>()
  private readonly inFlight = new Map<string, { promise: Promise<void>; abort: AbortController }>()

  constructor(opts: WhisperModelStoreOptions) {
    this.dir = opts.dir
    this.fetchFn = opts.fetchFn ?? fetch
    this.onProgress = opts.onProgress
    this.partOwnerId = opts.partOwnerId ?? randomUUID()
    this.nextPartId = opts.nextPartId ?? randomUUID
    this.now = opts.now ?? Date.now
  }

  modelPath(id: string): string {
    const info = whisperModel(id)
    return join(this.dir, info ? info.file : `${id}.bin`)
  }

  async has(id: string): Promise<boolean> {
    try { await stat(this.modelPath(id)); return true } catch { return false }
  }

  async list(): Promise<Array<{ id: string; downloaded: boolean; sizeMB?: number }>> {
    const out: Array<{ id: string; downloaded: boolean; sizeMB?: number }> = []
    for (const m of WHISPER_MODELS) {
      try {
        const s = await stat(this.modelPath(m.id))
        out.push({ id: m.id, downloaded: true, sizeMB: Math.round(s.size / 1_000_000) })
      } catch {
        out.push({ id: m.id, downloaded: false })
      }
    }
    return out
  }

  download(id: string): Promise<void> {
    const existing = this.inFlight.get(id)
    if (existing) return existing.promise
    const info = whisperModel(id)
    if (!info) return Promise.reject(new Error(`unknown whisper model: ${id}`))
    const abort = new AbortController()
    const promise = this.run(id, info.file, abort).finally(() => {
      // Only clear our own slot — a delete already removed it.
      if (this.inFlight.get(id)?.abort === abort) this.inFlight.delete(id)
    })
    this.inFlight.set(id, { promise, abort })
    return promise
  }

  /** Remove inactive fragments owned by this store and foreign fragments old enough to have
   * outlived a crashed owner. A recent foreign fragment may be a live writer in another process. */
  private async removeParts(id: string): Promise<void> {
    const base = this.modelPath(id)
    // basename(), not base.split('/').pop(): modelPath() is built with node:path's `join`,
    // which on win32 joins with `\`, so a `.split('/')` on a path with no `/` in it at all
    // returns the WHOLE absolute path — readdir() entries are bare filenames and none of them
    // ever start with a full path, so this swept exactly zero orphaned .part files on Windows.
    const legacyPart = `${basename(base)}.part`
    const prefix = `${legacyPart}.`
    const entries = await readdir(this.dir).catch(() => [] as string[])
    await Promise.all(
      entries.filter((entry) => entry === legacyPart || entry.startsWith(prefix)).map(async (entry) => {
        const partPath = join(this.dir, entry)
        if (this.activeParts.has(partPath)) return

        const ownerId = entry === legacyPart ? '' : entry.slice(prefix.length).split('.', 1)[0]
        if (ownerId === this.partOwnerId) {
          await rm(partPath, { force: true }).catch(() => {})
          return
        }

        // A failed stat is not evidence that a foreign writer is dead. Preserve it and let a
        // later sweep retry; only a measured age may authorize cross-owner cleanup.
        const partStat = await stat(partPath).catch(() => null)
        if (!partStat?.isFile() || this.now() - partStat.mtimeMs < WHISPER_PART_STALE_MS) return
        await rm(partPath, { force: true }).catch(() => {})
      }),
    )
  }

  /** Reserve rather than merely invent the name: UUIDs make collisions negligible, while `wx`
   * makes overwriting an existing fragment impossible even if an id source repeats. */
  private async reservePart(id: string): Promise<string> {
    for (let attempt = 0; attempt < PART_RESERVATION_ATTEMPTS; attempt += 1) {
      const partPath = `${this.modelPath(id)}.part.${this.partOwnerId}.${this.nextPartId()}`
      try {
        const reservation = await open(partPath, 'wx', 0o600)
        await reservation.close()
        this.activeParts.add(partPath)
        return partPath
      } catch (error) {
        if (!isAlreadyExists(error)) throw error
      }
    }
    throw new Error(`could not reserve a unique part file for whisper model ${id}`)
  }

  private async run(id: string, file: string, abort: AbortController): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    // Dedupe covers this store only. removeParts() must still preserve a second process's recent
    // fragment while clearing inactive fragments carrying this store's owner id and aged orphans.
    if (this.inFlight.get(id)?.abort === abort) {
      await this.removeParts(id)
    }
    const res = await this.fetchFn(WHISPER_DOWNLOAD_BASE + file, { signal: abort.signal })
    if (!res.ok || !res.body) throw new Error(`model download failed (${res.status})`)
    const partPath = await this.reservePart(id)
    const total = Number(res.headers.get('content-length')) || 0
    let received = 0
    const sink = createWriteStream(partPath, { flags: 'r+' })
    try {
      const reader = res.body.getReader()
      const writer = Writable.toWeb(sink).getWriter()
      for (;;) {
        const { done, value } = await reader.read()
        if (abort.signal.aborted) throw new Error('download cancelled')
        if (done) break
        await writer.write(value)
        received += value.byteLength
        if (total) this.onProgress?.(id, Math.min(99, Math.round((received / total) * 100)))
      }
      await writer.close()
      if (abort.signal.aborted) throw new Error('download cancelled')
      await renameAtomic(partPath, this.modelPath(id))
      this.onProgress?.(id, 100)
    } catch (err) {
      sink.destroy()
      await rm(partPath, { force: true })
      throw err
    } finally {
      this.activeParts.delete(partPath)
    }
  }

  async delete(id: string): Promise<void> {
    // modelPath() falls back to `${id}.bin` for an unrecognized id — reachable here (and via
    // has()) — so an unvalidated id let the authed delete IPC (register-ipc.ts) rm an arbitrary
    // path under this.dir, e.g. `../../etc/passwd`. Reject up front, same as download() already
    // does via whisperModel().
    if (!whisperModel(id)) throw new Error(`unknown whisper model: ${id}`)
    const inFlight = this.inFlight.get(id)
    if (inFlight) {
      this.inFlight.delete(id)
      inFlight.abort.abort()
      await inFlight.promise.catch(() => {}) // wait out the writer's cleanup
    }
    // A new download may have started while we awaited the old one's
    // cleanup — its .part is live; removing files now would yank them out
    // from under the new writer. The delete's intent (kill the OLD download,
    // remove the OLD files) is already done: the abort's error path removed
    // the old .part, and no completed file can exist mid-download.
    if (this.inFlight.has(id)) return
    await rm(this.modelPath(id), { force: true })
    await this.removeParts(id)
  }
}
