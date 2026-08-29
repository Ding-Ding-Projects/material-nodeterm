import fs, { promises as fsPromises } from 'fs'
import path from 'path'
import { IPC } from '../shared/ipc'
import type { ScheduledSettingsSaveResult } from '../shared/types'
import { platform } from './platform'
import { renameAtomic, tempNameFor } from './fs-atomic'
import {
  defaultScheduledSettingsFile,
  normalizeScheduledSettingsFile,
  validateScheduledSettingsFile,
  type ScheduledSettingsLoadError,
  type ScheduledSettingsLoadState,
  type ScheduledSettingsFile
} from '../shared/scheduled-settings'

/**
 * Stores the scheduled-settings rules in `scheduled-settings.json`, mirroring `SettingsStore`'s
 * shape exactly (synchronous cache, atomic tmp+rename write, an `onChange` hook for the service
 * layer below to react to). Kept as its OWN file rather than a field on `settings.json` because it
 * has its own save cadence (rule edits are infrequent and deliberate, unlike the coalesced
 * per-keystroke settings save) and its own bounded-schema validation that a plain settings merge
 * doesn't need.
 */
export class ScheduledSettingsStore {
  private cache: ScheduledSettingsFile = defaultScheduledSettingsFile()
  private loadError: ScheduledSettingsLoadError | null = null
  private listeners = new Set<
    (file: ScheduledSettingsFile, previous: ScheduledSettingsFile) => void | Promise<void>
  >()
  private saveChain: Promise<unknown> = Promise.resolve()
  private get filePath(): string {
    return path.join(platform().userDataDir, 'scheduled-settings.json')
  }

  /** Fires after every successful save with the new file AND the file it replaced, so a listener
   *  can diff (e.g. prune tokens for rules that disappeared) without keeping its own copy. */
  onChange(
    cb: (file: ScheduledSettingsFile, previous: ScheduledSettingsFile) => void | Promise<void>
  ): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Load synchronously into cache (call once at boot, same as `SettingsStore.init`). A failed
   * read leaves the original evidence untouched, publishes a structured recovery state, and
   * installs an empty in-memory schedule so startup continues with every automation disabled. */
  init(): ScheduledSettingsLoadState {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8')
      this.cache = normalizeScheduledSettingsFile(JSON.parse(raw))
      this.loadError = null
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        this.cache = defaultScheduledSettingsFile()
        this.loadError = null
        return this.loadState()
      }
      // Absence is the only NORMAL empty schedule. Corrupt JSON, EACCES, EIO, and a directory at
      // this path are distinct failed reads: keep the file/directory byte-for-byte, run no rules,
      // and tell the UI what must be repaired. Throwing here used to abort both shell boot paths.
      this.cache = defaultScheduledSettingsFile()
      const code = (error as NodeJS.ErrnoException)?.code
      const boundedCode = typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : undefined
      const corrupt = error instanceof SyntaxError
      this.loadError = {
        kind: corrupt ? 'corrupt' : 'unreadable',
        ...(boundedCode ? { code: boundedCode } : {}),
        path: this.filePath,
        message: corrupt
          ? 'The scheduled-settings file is not valid JSON.'
          : 'The scheduled-settings file could not be read.'
      }
    }
    return this.loadState()
  }

  get(): ScheduledSettingsFile {
    return this.cache
  }

  loadState(): ScheduledSettingsLoadState {
    return this.loadError
      ? { ok: false, file: this.cache, error: this.loadError }
      : { ok: true, file: this.cache, error: null }
  }

  registerIpc(): void {
    platform().handle(IPC.scheduledSettingsLoad, () => this.loadState())
    platform().handle(IPC.scheduledSettingsSave, (file: ScheduledSettingsFile) => this.save(file))
  }

  /** Returns `{ok:false, error}` on a bounds/shape violation OR a disk-level failure — never
   *  throws — so the renderer can always show `error` inline next to the Save button rather than
   *  treating either kind of failure as an IPC crash. */
  async save(raw: ScheduledSettingsFile): Promise<ScheduledSettingsSaveResult> {
    // Never overwrite the only recovery evidence. The operator must repair/move the original and
    // restart; until then the structured load error stays visible and the safe empty cache stays
    // authoritative. This is distinct from a first run (ENOENT), where saving is allowed.
    if (this.loadError) {
      return {
        ok: false,
        error:
          'Scheduled settings are locked until the corrupt or unreadable file is repaired and nodeterm is restarted.'
      }
    }
    // Validate the caller's bytes BEFORE tolerant disk migration. Normalizing first used to slice
    // rule lists/labels and turn malformed external sources into local rules, then report success.
    // A rejected save must leave both the cache and the file exactly as they were.
    const shapeError = validateScheduledSettingsFile(raw)
    if (shapeError) return { ok: false, error: shapeError }
    const normalized = normalizeScheduledSettingsFile(raw)
    const run = this.saveChain.then(() => this.saveNow(normalized))
    this.saveChain = run.catch(() => {})
    try {
      await run
      return { ok: true }
    } catch (error) {
      return error instanceof ScheduledSettingsPostSaveError
        ? {
            ok: false,
            persisted: true,
            warning: 'credential-cleanup-incomplete',
            error: 'The schedule was saved, but related credentials could not be fully cleared.'
          }
        : { ok: false, error: 'Could not write the schedule to disk.' }
    }
  }

  private async saveNow(next: ScheduledSettingsFile): Promise<void> {
    const previous = this.cache
    this.cache = next
    const tmp = tempNameFor(this.filePath)
    try {
      await fsPromises.writeFile(tmp, JSON.stringify(next, null, 2), { encoding: 'utf-8', mode: 0o600 })
      // Retries briefly on Windows if the destination is momentarily held open (AV/indexer/sync) — see fs-atomic.ts.
      await renameAtomic(tmp, this.filePath)
    } catch (e) {
      this.cache = previous // the write failed — don't let the in-memory cache lie about disk
      await fsPromises.rm(tmp, { force: true }).catch(() => {})
      throw e
    }
    let listenerFailed = false
    for (const cb of this.listeners) {
      try {
        await cb(next, previous)
      } catch {
        // Run every sibling, but do not turn a post-publication cleanup failure into a false
        // "could not write" result. The schedule is durable; its credential lifecycle is not.
        listenerFailed = true
      }
    }
    if (listenerFailed) throw new ScheduledSettingsPostSaveError()
  }
}

class ScheduledSettingsPostSaveError extends Error {}
