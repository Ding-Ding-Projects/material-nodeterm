import { promises as fs, readFileSync } from 'fs'
import path from 'path'
import { IPC } from '../shared/ipc'
import { platform } from './platform'
import { renameAtomic, tempNameFor } from './fs-atomic'
import {
  defaultScheduledSettingsFile,
  normalizeScheduledSettingsFile,
  validateScheduledSettingsFile,
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
  private listeners = new Set<(file: ScheduledSettingsFile, previous: ScheduledSettingsFile) => void>()
  private saveChain: Promise<unknown> = Promise.resolve()
  private get filePath(): string {
    return path.join(platform().userDataDir, 'scheduled-settings.json')
  }

  /** Fires after every successful save with the new file AND the file it replaced, so a listener
   *  can diff (e.g. prune tokens for rules that disappeared) without keeping its own copy. */
  onChange(cb: (file: ScheduledSettingsFile, previous: ScheduledSettingsFile) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Load synchronously into cache (call once at boot, same as `SettingsStore.init`). */
  init(): void {
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      this.cache = normalizeScheduledSettingsFile(JSON.parse(raw))
    } catch (error) {
      // Absence is the only empty schedule. Treating corrupt JSON, EACCES, EIO, or a directory at
      // this path as "no rules" can silently remove an active automation and lets the next save
      // overwrite the evidence needed to recover it.
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        this.cache = defaultScheduledSettingsFile()
        return
      }
      throw error
    }
  }

  get(): ScheduledSettingsFile {
    return this.cache
  }

  registerIpc(): void {
    platform().handle(IPC.scheduledSettingsLoad, () => this.cache)
    platform().handle(IPC.scheduledSettingsSave, (file: ScheduledSettingsFile) => this.save(file))
  }

  /** Returns `{ok:false, error}` on a bounds/shape violation OR a disk-level failure — never
   *  throws — so the renderer can always show `error` inline next to the Save button rather than
   *  treating either kind of failure as an IPC crash. */
  async save(raw: ScheduledSettingsFile): Promise<{ ok: boolean; error?: string }> {
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
    } catch {
      return { ok: false, error: 'Could not write the schedule to disk.' }
    }
  }

  private async saveNow(next: ScheduledSettingsFile): Promise<void> {
    const previous = this.cache
    this.cache = next
    const tmp = tempNameFor(this.filePath)
    try {
      await fs.writeFile(tmp, JSON.stringify(next, null, 2), { encoding: 'utf-8', mode: 0o600 })
      // Retries briefly on Windows if the destination is momentarily held open (AV/indexer/sync) — see fs-atomic.ts.
      await renameAtomic(tmp, this.filePath)
    } catch (e) {
      this.cache = previous // the write failed — don't let the in-memory cache lie about disk
      await fs.rm(tmp, { force: true }).catch(() => {})
      throw e
    }
    for (const cb of this.listeners) {
      try {
        cb(next, previous)
      } catch {
        // A listener must never break a save (or its siblings).
      }
    }
  }
}
