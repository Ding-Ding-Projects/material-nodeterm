// The converter engine: bounded-concurrency queue runner over the bundled adapter registry, with
// crash-recoverable persistence (store.ts), paged folder discovery (fs-scan.ts), atomic writes,
// pre-write validation, and the lossy/overwrite confirmation gate. See docs/file-converter.md.

import { access, mkdir, open, stat, type FileHandle } from 'node:fs/promises'
import { constants as fsConstants, promises as fs } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { freeDiskBytes } from '../disk-space'
import {
  CONVERTER_CATALOG,
  CONVERTER_DEFAULT_CONCURRENCY,
  CONVERTER_MAX_CONCURRENCY,
  CONVERTER_SNIFF_BYTES,
  type ConvertItemStatus,
  type ConvertQueueItem,
  type ConverterDetectionResult,
  type ConverterPreflightResult,
  type ConverterQueueState
} from '../../shared/converter'
import { sniffFormat } from './detect'
import { DEFAULT_SKIP_DIRS, listTopLevelFiles, nextPage, walkFiles } from './fs-scan'
import { getAdapter } from './registry'
import { ConverterStore } from './store'
import { removeAtomic, renameAtomic, tempNameFor } from '../fs-atomic'

let nextId = 1
function freshId(): string {
  return `cv_${Date.now().toString(36)}_${(nextId++).toString(36)}`
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : ''
}

function uniqueDestPath(destDir: string, sourceName: string, targetExt: string): string {
  const base = basename(sourceName, extname(sourceName))
  return join(destDir, `${base}${targetExt}`)
}

export interface ConverterServiceDeps {
  userDataDir: string
  /** Fired after any single item's status/progress changes. */
  onItemChange?: (item: ConvertQueueItem) => void
  /** Fired after a queue-wide fact changes (running/scanning/concurrency/total). */
  onSummaryChange?: (summary: Pick<ConverterQueueState, 'running' | 'scanning' | 'concurrency' | 'total'>) => void
}

export class ConverterService {
  private readonly store: ConverterStore
  private readonly deps: ConverterServiceDeps
  private items: ConvertQueueItem[] = []
  private byId = new Map<string, ConvertQueueItem>()
  private concurrency = CONVERTER_DEFAULT_CONCURRENCY
  private running = false
  private scanning = false
  private activeRunners = 0
  private cancelRequested = new Set<string>()
  private scanAbort: AbortController | null = null
  private loaded: Promise<void>

  constructor(deps: ConverterServiceDeps) {
    this.deps = deps
    this.store = new ConverterStore(deps.userDataDir)
    this.loaded = this.store.load().then((items) => {
      this.items = items.map((i) =>
        // A crash mid-run leaves 'running' items stranded — resume as queued rather than lost.
        i.status === 'running' ? { ...i, status: 'queued' as ConvertItemStatus, updatedAt: Date.now() } : i
      )
      for (const i of this.items) this.byId.set(i.id, i)
    })
  }

  private async ready(): Promise<void> {
    await this.loaded
  }

  /**
   * Persist the queue snapshot without making the caller wait for the disk.
   *
   * `void promise` is NOT enough here, and the failure it causes is not local: an unhandled
   * rejection terminates the process by default on every supported Node, so a single failed
   * background queue write would take down the whole Electron main process (or the Server
   * Edition) for a purely advisory save. The write can genuinely fail — `renameAtomic` gives up
   * after its bounded retries when something on Windows keeps holding `queue.json`, and a
   * userData directory can disappear underneath a long-running app.
   *
   * A queue snapshot is best effort by design: the in-memory queue is authoritative for this run
   * and the store only makes it survive a restart. So report the loss and carry on; do not
   * escalate it into "the app is gone".
   */
  private persistInBackground(): void {
    this.store.save(this.items).catch((e) => {
      console.warn('[converter] queue snapshot write failed; queue is still live in memory', e)
    })
  }

  private touch(item: ConvertQueueItem): void {
    item.updatedAt = Date.now()
    this.deps.onItemChange?.(item)
    this.persistInBackground()
  }

  private emitSummary(): void {
    this.deps.onSummaryChange?.({
      running: this.running,
      scanning: this.scanning,
      concurrency: this.concurrency,
      total: this.items.length
    })
  }

  // -------------------------------------------------------------------------------------------
  // Detection
  // -------------------------------------------------------------------------------------------

  async detect(path: string): Promise<ConverterDetectionResult> {
    const st = await stat(path)
    if (!st.isFile()) {
      const sourceType = st.isDirectory() ? 'directory' : 'non-file filesystem entry'
      throw new Error(`Unsupported converter input: expected a regular file, received ${sourceType}.`)
    }
    const fh = await open(path, 'r')
    try {
      const buf = Buffer.alloc(Math.min(CONVERTER_SNIFF_BYTES, st.size))
      if (buf.length > 0) await fh.read(buf, 0, buf.length, 0)
      const sniff = sniffFormat(buf, basename(path))
      const compatible = CONVERTER_CATALOG.filter(
        (a) => a.fromKind === 'any' || (sniff.kind !== null && a.fromKind === sniff.kind)
      ).map((a) => a.id)
      return {
        path,
        name: basename(path),
        sizeBytes: st.size,
        detectedKind: sniff.kind,
        confidence: sniff.confidence,
        note: sniff.note,
        compatibleAdapterIds: compatible
      }
    } finally {
      await fh.close()
    }
  }

  // -------------------------------------------------------------------------------------------
  // Preflight
  // -------------------------------------------------------------------------------------------

  async preflight(destDir: string): Promise<ConverterPreflightResult> {
    let destDirExists = true
    try {
      await access(destDir, fsConstants.F_OK)
    } catch {
      destDirExists = false
    }
    let writable = false
    try {
      await access(destDirExists ? destDir : dirname(destDir), fsConstants.W_OK)
      writable = true
    } catch {
      writable = false
    }
    const freeBytes = freeDiskBytes(destDirExists ? destDir : dirname(destDir))
    await this.ready()
    const estimatedNeededBytes = this.items
      .filter((i) => i.status === 'queued' || i.status === 'needs-confirm' || i.status === 'paused')
      .reduce((sum, i) => sum + i.sourceBytes, 0)
    return {
      destDir,
      destDirExists,
      writable,
      freeBytes,
      estimatedNeededBytes,
      sufficient: freeBytes === null ? null : freeBytes > estimatedNeededBytes * 1.1
    }
  }

  // -------------------------------------------------------------------------------------------
  // Queue mutation
  // -------------------------------------------------------------------------------------------

  async state(offset = 0, limit = 200): Promise<ConverterQueueState> {
    await this.ready()
    return {
      items: this.items.slice(offset, offset + limit),
      total: this.items.length,
      concurrency: this.concurrency,
      running: this.running,
      scanning: this.scanning
    }
  }

  setConcurrency(n: number): number {
    this.concurrency = Math.max(1, Math.min(CONVERTER_MAX_CONCURRENCY, Math.floor(n) || 1))
    this.emitSummary()
    this.pump()
    return this.concurrency
  }

  private async buildItem(
    path: string,
    destDir: string,
    adapterId: string,
    lossyAcknowledged: boolean
  ): Promise<ConvertQueueItem | { error: string; path: string }> {
    const descriptor = CONVERTER_CATALOG.find((a) => a.id === adapterId)
    if (!descriptor || !descriptor.available) {
      return { error: `Adapter "${adapterId}" is not available in this build`, path }
    }
    let st
    try {
      st = await stat(path)
    } catch {
      return { error: 'File does not exist or is not readable', path }
    }
    if (!st.isFile()) return { error: 'Not a regular file', path }
    if (st.size > descriptor.maxInputBytes) {
      return {
        error: `File is ${st.size.toLocaleString()} bytes, over this adapter's ${descriptor.maxInputBytes.toLocaleString()}-byte limit`,
        path
      }
    }
    const destPath = uniqueDestPath(destDir, basename(path), descriptor.targetExt)
    let destExists = false
    try {
      await access(destPath, fsConstants.F_OK)
      destExists = true
    } catch {
      destExists = false
    }
    const reasons: ('lossy' | 'overwrite')[] = []
    if (descriptor.lossy && !lossyAcknowledged) reasons.push('lossy')
    if (destExists) reasons.push('overwrite')
    const now = Date.now()
    return {
      id: freshId(),
      sourcePath: path,
      sourceName: basename(path),
      sourceBytes: st.size,
      destPath,
      adapterId,
      status: reasons.length > 0 ? 'needs-confirm' : 'queued',
      confirmReasons: reasons.length > 0 ? reasons : undefined,
      progressBytes: 0,
      totalBytes: st.size,
      createdAt: now,
      updatedAt: now
    }
  }

  async addFiles(
    paths: string[],
    destDir: string,
    adapterId: string,
    opts: { lossyAcknowledged?: boolean } = {}
  ): Promise<{ added: ConvertQueueItem[]; rejected: { path: string; error: string }[] }> {
    await this.ready()
    await mkdir(destDir, { recursive: true }).catch(() => {})
    const added: ConvertQueueItem[] = []
    const rejected: { path: string; error: string }[] = []
    for (const p of paths) {
      const result = await this.buildItem(p, destDir, adapterId, opts.lossyAcknowledged === true)
      // Narrow on `id`, NOT on `error`: `ConvertQueueItem` carries its own optional `error?`, so
      // `'error' in result` does not discriminate the union — a real queue item that already had
      // an error set would be filed as a rejection and never queued at all. Only the rejection
      // shape lacks an `id`.
      if (!('id' in result)) rejected.push(result)
      else {
        this.items.push(result)
        this.byId.set(result.id, result)
        added.push(result)
        this.deps.onItemChange?.(result)
      }
    }
    await this.store.save(this.items)
    this.emitSummary()
    this.pump()
    return { added, rejected }
  }

  /** Paged, background folder scan. Uses the sourceExt hint (not full content sniffing — sniffing
   *  every file in a large tree would be slow) unless the adapter's fromKind is 'any', which matches
   *  everything. Returns immediately; progress is observable via state()/onSummaryChange (scanning).
   *  `recursive: false` (default true) scans only the files directly inside `root`. */
  async addFolder(
    root: string,
    destDir: string,
    adapterId: string,
    opts: { lossyAcknowledged?: boolean; recursive?: boolean } = {}
  ): Promise<void> {
    await this.ready()
    const descriptor = CONVERTER_CATALOG.find((a) => a.id === adapterId)
    if (!descriptor || !descriptor.available) throw new Error(`Adapter "${adapterId}" is not available`)
    await mkdir(destDir, { recursive: true }).catch(() => {})
    this.scanAbort?.abort()
    this.scanAbort = new AbortController()
    const signal = this.scanAbort.signal
    this.scanning = true
    this.emitSummary()
    const matches = (p: string): boolean =>
      descriptor.fromKind === 'any' || descriptor.sourceExt.some((ext) => p.toLowerCase().endsWith(ext))
    try {
      if (opts.recursive === false) {
        const files = (await listTopLevelFiles(root)).filter(matches)
        if (files.length > 0 && !signal.aborted) await this.addFiles(files, destDir, adapterId, opts)
        return
      }
      const gen = walkFiles(root, { skipDirs: DEFAULT_SKIP_DIRS, signal })
      for (;;) {
        const { page, done } = await nextPage(gen, 200)
        const matching = page.filter(matches)
        if (matching.length > 0 && !signal.aborted) {
          await this.addFiles(matching, destDir, adapterId, opts)
        }
        if (done || signal.aborted) break
      }
    } finally {
      this.scanning = false
      this.emitSummary()
    }
  }

  cancelScan(): void {
    this.scanAbort?.abort()
  }

  resolvePending(ids: string[], opts: { overwrite?: boolean; lossyAcknowledged?: boolean }): void {
    for (const id of ids) {
      const item = this.byId.get(id)
      if (!item || item.status !== 'needs-confirm') continue
      const remaining = (item.confirmReasons ?? []).filter((r) => {
        if (r === 'overwrite' && opts.overwrite) return false
        if (r === 'lossy' && opts.lossyAcknowledged) return false
        return true
      })
      if (opts.overwrite) item.overwriteAllowed = true
      item.confirmReasons = remaining.length > 0 ? remaining : undefined
      item.status = remaining.length > 0 ? 'needs-confirm' : 'queued'
      this.touch(item)
    }
    this.pump()
  }

  cancelItem(id: string): void {
    const item = this.byId.get(id)
    if (!item) return
    if (item.status === 'running') {
      this.cancelRequested.add(id)
      return
    }
    if (item.status === 'done' || item.status === 'cancelled') return
    item.status = 'cancelled'
    this.touch(item)
  }

  cancelAll(): void {
    for (const item of this.items) {
      if (item.status === 'queued' || item.status === 'needs-confirm' || item.status === 'paused') {
        item.status = 'cancelled'
        this.touch(item)
      } else if (item.status === 'running') {
        this.cancelRequested.add(item.id)
      }
    }
  }

  retryItem(id: string): void {
    const item = this.byId.get(id)
    if (!item || (item.status !== 'failed' && item.status !== 'cancelled')) return
    item.status = 'queued'
    item.error = undefined
    item.progressBytes = 0
    this.touch(item)
    this.pump()
  }

  removeItem(id: string): void {
    const item = this.byId.get(id)
    if (!item || item.status === 'running' || item.status === 'queued') return
    this.items = this.items.filter((i) => i.id !== id)
    this.byId.delete(id)
    this.persistInBackground()
    this.emitSummary()
  }

  clearFinished(): void {
    const before = this.items.length
    this.items = this.items.filter(
      (i) => !(i.status === 'done' || i.status === 'failed' || i.status === 'cancelled' || i.status === 'skipped')
    )
    for (const i of [...this.byId.values()]) if (!this.items.includes(i)) this.byId.delete(i.id)
    if (this.items.length !== before) {
      this.persistInBackground()
      this.emitSummary()
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.emitSummary()
    this.pump()
  }

  pause(): void {
    if (!this.running) return
    this.running = false
    this.emitSummary()
  }

  // -------------------------------------------------------------------------------------------
  // Runner
  // -------------------------------------------------------------------------------------------

  private pump(): void {
    if (!this.running) return
    while (this.activeRunners < this.concurrency) {
      const next = this.items.find((i) => i.status === 'queued')
      if (!next) break
      this.activeRunners++
      void this.runItem(next).finally(() => {
        this.activeRunners--
        this.pump()
      })
    }
  }

  private async runItem(item: ConvertQueueItem): Promise<void> {
    item.status = 'running'
    item.progressBytes = 0
    this.touch(item)

    const bail = (status: ConvertItemStatus, error?: string): void => {
      item.status = status
      item.error = error
      this.cancelRequested.delete(item.id)
      this.touch(item)
    }

    if (this.cancelRequested.has(item.id)) return bail('cancelled')

    const adapter = getAdapter(item.adapterId)
    if (!adapter) return bail('failed', `No adapter registered for "${item.adapterId}"`)

    let input: Buffer
    try {
      input = await this.boundedRead(item.sourcePath, item.totalBytes)
    } catch (e) {
      return bail('failed', `Could not read source: ${(e as Error).message}`)
    }
    if (this.cancelRequested.has(item.id)) return bail('cancelled')
    item.progressBytes = Math.round(item.totalBytes * 0.3)
    this.touch(item)

    let output: Buffer
    let warnings: string[] = []
    try {
      const result = await adapter.convert(input)
      output = result.output
      warnings = result.warnings
    } catch (e) {
      return bail('failed', (e as Error).message)
    }
    if (this.cancelRequested.has(item.id)) return bail('cancelled')
    item.progressBytes = Math.round(item.totalBytes * 0.7)
    this.touch(item)

    const validationError = await adapter.validate(output)
    if (validationError) return bail('failed', validationError)

    // Re-check overwrite right before the write — the destination could have appeared since the
    // item was queued (another item, another app writing there). Never silently clobber a file
    // the user has not explicitly allowed overwriting for THIS run.
    let existsNow = false
    try {
      await access(item.destPath, fsConstants.F_OK)
      existsNow = true
    } catch {
      existsNow = false
    }
    if (this.cancelRequested.has(item.id)) return bail('cancelled')
    if (existsNow && !item.overwriteAllowed) {
      item.status = 'needs-confirm'
      item.confirmReasons = ['overwrite']
      this.touch(item)
      return
    }

    // The temp belongs to this ONE run. Date.now() is not unique — two same-destination writers in
    // one process can reach this point in the same millisecond — and a shared temp lets one rename
    // publish the other writer's bytes or move the file out from under it. `tempNameFor` combines
    // pid + a process-local counter, so cleanup below can never remove another live writer's temp.
    let tmp = ''
    let tempHandle: FileHandle | undefined
    let tempOwned = false
    let publishError: unknown
    let cancelledBeforePublish = false
    let destinationAppeared = false
    let published = false
    let tempConsumed = false
    let tempRemoved = true
    try {
      await mkdir(dirname(item.destPath), { recursive: true })
      if (this.cancelRequested.has(item.id)) {
        cancelledBeforePublish = true
      } else {
        // `tempNameFor` makes collisions exceptional, but a stale temp after PID reuse (or a
        // pre-created sibling/symlink) is still possible. Claim a fresh path with O_EXCL and write
        // through that exact handle: never truncate/follow a path this run did not create, and
        // never remove it in the finally block unless this open established ownership.
        for (let attempt = 0; ; attempt++) {
          tmp = tempNameFor(item.destPath)
          try {
            tempHandle = await fs.open(tmp, 'wx')
            tempOwned = true
            break
          } catch (e) {
            if (errorCode(e) !== 'EEXIST' || attempt >= 31) throw e
          }
        }
        // Opening with O_EXCL may wait behind the filesystem or retry occupied names. Recheck
        // before potentially writing a large output; the finally block will close and remove the
        // empty temp this run owns when cancellation won that race.
        if (this.cancelRequested.has(item.id)) {
          cancelledBeforePublish = true
        } else {
          try {
            await tempHandle.writeFile(output)
          } finally {
            await tempHandle.close()
            tempHandle = undefined
          }
          // Cancellation cannot interrupt one atomic rename once it has started. This last check
          // is therefore the boundary: a request observed after the stream/write but before
          // publish removes this run's partial and leaves the prior destination byte-for-byte
          // intact.
          if (this.cancelRequested.has(item.id)) {
            cancelledBeforePublish = true
          } else if (item.overwriteAllowed) {
            await renameAtomic(tmp, item.destPath)
            // rename consumes the temp; nothing remains for the finally block to remove.
            published = true
            tempConsumed = true
          } else {
            // `access()` above is only a helpful early prompt, never the safety boundary: another
            // writer can create the destination immediately afterwards. A same-directory hard
            // link atomically publishes the completed temp ONLY while the name is absent. EEXIST
            // returns this item to the overwrite gate; a filesystem without link semantics fails
            // closed instead of replacing a file the user never approved overwriting.
            try {
              await fs.link(tmp, item.destPath)
              published = true
            } catch (e) {
              if (errorCode(e) === 'EEXIST') destinationAppeared = true
              else throw e
            }
          }
        }
      }
    } catch (e) {
      publishError = e
    } finally {
      // Await cleanup before reporting a terminal state. A unique temp never self-heals on the
      // next run, and removing exactly `tmp` is what prevents a failed/cancelled writer from
      // deleting a different writer that is concurrently targeting the same destination.
      if (tempHandle) {
        await tempHandle.close().catch(() => {})
        tempHandle = undefined
      }
      if (tempOwned && !tempConsumed) tempRemoved = await removeAtomic(tmp)
    }

    if (!tempRemoved) {
      const reason = publishError instanceof Error ? ` after ${publishError.message}` : ''
      const cleanupWarning = `Could not remove temporary output "${tmp}"${reason}`
      // A no-clobber link may already have published a complete destination before unlinking its
      // second name fails. Calling that conversion failed would invite a retry even though the
      // requested output is correct and visible. Report the litter explicitly while keeping the
      // truthful `done` result; before publication, cleanup failure remains a real failed write.
      if (published) warnings = [...warnings, cleanupWarning]
      else return bail('failed', cleanupWarning)
    }
    if (publishError) return bail('failed', `Could not write output: ${(publishError as Error).message}`)
    if (!published && this.cancelRequested.has(item.id)) cancelledBeforePublish = true
    if (cancelledBeforePublish) return bail('cancelled')
    if (destinationAppeared) {
      item.status = 'needs-confirm'
      item.confirmReasons = ['overwrite']
      this.touch(item)
      return
    }
    item.progressBytes = item.totalBytes
    item.warnings = warnings.length > 0 ? warnings : undefined
    item.status = 'done'
    this.cancelRequested.delete(item.id)
    this.touch(item)
  }

  private async boundedRead(path: string, maxBytes: number): Promise<Buffer> {
    const fh = await open(path, 'r')
    try {
      const st = await fh.stat()
      if (st.size > maxBytes) throw new Error('Source grew past the adapter size limit since it was queued')
      const buf = Buffer.alloc(st.size)
      if (st.size > 0) await fh.read(buf, 0, st.size, 0)
      return buf
    } finally {
      await fh.close()
    }
  }
}
