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
  private generation = 0
  private disposed = false

  private readonly targetDirectory: string
  private readonly targetBasename: string

  constructor(
    recordFile: string,
    private readonly onRecordChange: () => void,
    private readonly createWatcher: WatchDirectory = watchDirectory
  ) {
    this.targetDirectory = path.dirname(recordFile)
    this.targetBasename = path.basename(recordFile)
  }

  start(): void {
    this.disposed = false
    this.armClosestDirectory(false)
  }

  /** A successful write may have created the directory while only an ancestor was watched. */
  recordWritten(): void {
    if (!this.disposed) this.armClosestDirectory(false)
  }

  dispose(): void {
    this.disposed = true
    this.generation += 1
    this.watcher?.close()
    this.watcher = null
    this.watchedDirectory = null
  }

  private armClosestDirectory(forceReplace: boolean): void {
    if (this.disposed) return

    let candidate = this.targetDirectory
    while (true) {
      if (!forceReplace && this.watcher && candidate === this.watchedDirectory) return

      const nextGeneration = this.generation + 1
      try {
        const nextWatcher = this.createWatcher(candidate, (eventType, filename) => {
          this.handleEvent(nextGeneration, candidate, eventType, filename)
        })
        nextWatcher.on('error', (error) => this.handleWatcherError(nextGeneration, error))

        const previous = this.watcher
        this.generation = nextGeneration
        this.watcher = nextWatcher
        this.watchedDirectory = candidate
        previous?.close()
        return
      } catch (error) {
        // Only a proven absence justifies climbing to an ancestor. Permission/resource errors
        // leave the current watcher intact; a later successful local write will retry.
        if (!isEnoent(error)) return
        const parent = path.dirname(candidate)
        if (parent === candidate) return
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
    if (this.disposed || generation !== this.generation) return

    if (watchedDirectory !== this.targetDirectory) {
      const before = this.watchedDirectory
      this.armClosestDirectory(false)
      if (this.watchedDirectory !== before) this.onRecordChange()
      return
    }

    // A rename can mean either atomic record replacement or deletion of the directory itself.
    // Reopening moves the watcher to an ancestor if needed, instead of leaving it attached to a
    // deleted inode. The old handle closes only after its replacement is live.
    if (eventType === 'rename') this.armClosestDirectory(true)

    const name = Buffer.isBuffer(filename) ? filename.toString() : filename
    if (name === null || name === this.targetBasename) this.onRecordChange()
  }

  private handleWatcherError(generation: number, error: Error): void {
    if (this.disposed || generation !== this.generation) return

    const failed = this.watcher
    this.generation += 1
    this.watcher = null
    this.watchedDirectory = null
    failed?.close()

    // ENOENT means the watched directory disappeared, so fall back to its nearest ancestor.
    // Other failures are not absence and stop watching until a successful local write retries.
    if (isEnoent(error)) this.armClosestDirectory(false)
  }
}
