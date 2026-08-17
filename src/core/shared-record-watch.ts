import { promises as fs, watch, type FSWatcher } from 'fs'
import path from 'path'

export type SharedJsonRead =
  | { kind: 'value'; value: unknown }
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | { kind: 'error'; error: unknown }

export type ReadUtf8 = (file: string, encoding: 'utf8') => Promise<string>

/** ENOENT means the shared record has not been created. Other read/watch failures say nothing
 * about its state and must never be laundered into "the mode is off". */
export function isEnoent(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
}

export async function readSharedJson(
  file: string,
  readUtf8: ReadUtf8 = (target, encoding) => fs.readFile(target, encoding)
): Promise<SharedJsonRead> {
  let raw: string
  try {
    raw = await readUtf8(file, 'utf8')
  } catch (error) {
    return isEnoent(error) ? { kind: 'absent' } : { kind: 'error', error }
  }

  try {
    return { kind: 'value', value: JSON.parse(raw) }
  } catch {
    return { kind: 'invalid' }
  }
}

export interface DirectoryWatchHandle {
  close(): void
  on(event: 'error', listener: (error: Error) => void): unknown
}

export type WatchDirectory = (
  directory: string,
  listener: (eventType: string, filename: string | Buffer | null) => void
) => DirectoryWatchHandle

/**
 * Identifies both the OS watch handle and the exact record-sync obligation created while that
 * handle was current. A handle can survive many record changes, so these are deliberately two
 * counters: using one counter for both would make every later callback from a still-live handle
 * look stale after the first change.
 */
export interface SharedRecordWatchToken {
  handleGeneration: number
  syncEpoch: number
}

export interface SharedRecordWatch {
  start(): SharedRecordWatchToken | null
  recordWritten(): void
  isCurrent(token: SharedRecordWatchToken): boolean
  acknowledge(token: SharedRecordWatchToken): boolean
  dispose(): void
}

const watchDirectory: WatchDirectory = (directory, listener) =>
  watch(directory, { persistent: false }, listener) as FSWatcher

/**
 * Watches one record without assuming its directory exists at boot.
 *
 * Exactly one watcher is live. If the target directory is absent, it watches the nearest
 * existing ancestor and promotes toward the target as directories appear. Promotion triggers a
 * reload because the record may have been written before the narrower watcher was armed. A
 * successful local write also retries promotion, which closes the mkdir/write event race without
 * a polling timer.
 */
export class SharedRecordWatcher {
  private watcher: DirectoryWatchHandle | null = null
  private watchedDirectory: string | null = null
  /** Rejects callbacks from a handle that has been replaced or closed. */
  private handleGeneration = 0
  /** Rejects a read that began before a later event, error, promotion, or rearm. */
  private syncEpoch = 0
  private disposed = false
  /** A handle is only recovering until its exact sync epoch has been read and acknowledged. */
  private healthy = false

  private readonly targetDirectory: string
  private readonly targetBasename: string

  constructor(
    recordFile: string,
    private readonly onRecordChange: (token: SharedRecordWatchToken) => void,
    private readonly createWatcher: WatchDirectory = watchDirectory,
    private readonly onHealthChange: (healthy: boolean) => void = () => {}
  ) {
    this.targetDirectory = path.dirname(recordFile)
    this.targetBasename = path.basename(recordFile)
  }

  start(): SharedRecordWatchToken | null {
    this.disposed = false
    this.invalidateSync()
    if (!this.armClosestDirectory(false)) return null
    return this.currentToken()
  }

  /** A successful write may have created the directory while only an ancestor was watched. */
  recordWritten(): void {
    if (this.disposed) return
    const forceReplace = !this.healthy
    // The SQLite lease ends before the caller can publish its response. Another process may win a
    // write in that interval, so our just-written cache is display-only until a strict read tied to
    // this new epoch observes the canonical bytes.
    this.invalidateSync()
    // An unhealthy handle is only a recovery hook. Replacing it is the proof that watching can be
    // attempted again; retaining it merely because it already names the target would stay stuck.
    if (!this.armClosestDirectory(forceReplace)) return
    this.requestSync()
  }

  isCurrent(token: SharedRecordWatchToken): boolean {
    return (
      !this.disposed &&
      this.watcher !== null &&
      token.handleGeneration === this.handleGeneration &&
      token.syncEpoch === this.syncEpoch
    )
  }

  /**
   * Complete the arm -> strict read -> acknowledge handshake. Opening an OS watcher is not itself
   * evidence that no write landed during the preceding gap; only the exact read associated with
   * the still-current epoch may make consumers authoritative again.
   */
  acknowledge(token: SharedRecordWatchToken): boolean {
    if (!this.isCurrent(token)) return false
    this.setHealthy(true)
    return true
  }

  dispose(): void {
    this.disposed = true
    this.handleGeneration += 1
    this.syncEpoch += 1
    this.watcher?.close()
    this.watcher = null
    this.watchedDirectory = null
    this.setHealthy(false)
  }

  private setHealthy(healthy: boolean): void {
    if (healthy === this.healthy) return
    this.healthy = healthy
    this.onHealthChange(healthy)
  }

  private invalidateSync(): void {
    this.syncEpoch += 1
    this.setHealthy(false)
  }

  private currentToken(): SharedRecordWatchToken | null {
    if (this.disposed || !this.watcher) return null
    return { handleGeneration: this.handleGeneration, syncEpoch: this.syncEpoch }
  }

  private requestSync(): void {
    const token = this.currentToken()
    if (token) this.onRecordChange(token)
  }

  private armClosestDirectory(forceReplace: boolean): boolean {
    if (this.disposed) return false

    let candidate = this.targetDirectory
    while (true) {
      if (!forceReplace && this.watcher && candidate === this.watchedDirectory) return true

      const nextGeneration = this.handleGeneration + 1
      try {
        const nextWatcher = this.createWatcher(candidate, (eventType, filename) => {
          this.handleEvent(nextGeneration, candidate, eventType, filename)
        })
        nextWatcher.on('error', (error) => this.handleWatcherError(nextGeneration, error))

        const previous = this.watcher
        this.handleGeneration = nextGeneration
        this.watcher = nextWatcher
        this.watchedDirectory = candidate
        this.setHealthy(true)
        previous?.close()
        // Deliberately do not set healthy here. The caller requests a strict read for this epoch;
        // acknowledge() is the only transition back to healthy.
        return true
      } catch (error) {
        // Only a proven absence justifies climbing to an ancestor. Permission/resource errors
        // leave the current watcher intact only as a recovery hook. The target may contain an ON
        // record hidden behind the failure, so the old cache cannot become authoritative.
        if (!isEnoent(error)) return false
        const parent = path.dirname(candidate)
        if (parent === candidate) return false
        candidate = parent
      }
    }
  }

  private handleEvent(
    generation: number,
    watchedDirectory: string,
    eventType: string,
    filename: string | Buffer | null
  ): void {
    if (this.disposed || generation !== this.handleGeneration) return

    if (watchedDirectory !== this.targetDirectory) {
      const before = this.watchedDirectory
      if (!this.armClosestDirectory(false)) return
      if (this.watchedDirectory !== before) {
        this.invalidateSync()
        this.requestSync()
      }
      return
    }

    // A rename can mean either atomic record replacement or deletion of the directory itself.
    // Reopening moves the watcher to an ancestor if needed, instead of leaving it attached to a
    // deleted inode. The old handle closes only after its replacement is live.
    const name = Buffer.isBuffer(filename) ? filename.toString() : filename
    const recordMayHaveChanged = name === null || name === this.targetBasename
    if (eventType !== 'rename' && !recordMayHaveChanged) return

    this.invalidateSync()
    if (eventType === 'rename' && !this.armClosestDirectory(true)) return
    this.requestSync()
  }

  private handleWatcherError(generation: number, error: Error): void {
    if (this.disposed || generation !== this.handleGeneration) return

    const failed = this.watcher
    this.handleGeneration += 1
    this.invalidateSync()
    this.watcher = null
    this.watchedDirectory = null
    this.setHealthy(false)
    failed?.close()

    // ENOENT means the watched directory disappeared, so fall back to its nearest ancestor.
    // Other failures are not absence and stay unavailable until a successful recovery attempt.
    if (isEnoent(error) && this.armClosestDirectory(false)) this.requestSync()
  }
}
