// Small generic helper for "persist an array snapshot to one JSON file, atomically, with crash
// recovery" — shared by the converter queue and the Ollama pull queue so the same atomic-write +
// corrupt-file-quarantine discipline lives in exactly one place.

import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { renameAtomic, writeFileAtomic } from './fs-atomic'

export class AtomicJsonArrayStore<T> {
  constructor(private readonly file: string) {}
  private writing: Promise<void> = Promise.resolve()

  async load(): Promise<T[]> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) throw new Error('not an array')
      return parsed as T[]
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      try {
        await mkdir(dirname(this.file), { recursive: true })
        await renameAtomic(this.file, `${this.file}.corrupt-${Date.now()}`)
      } catch {
        // best-effort — start empty regardless
      }
      return []
    }
  }

  /**
   * Queue one whole-document publication behind the previous one and return ITS outcome.
   *
   * The FIFO chain and the caller's promise are deliberately two different values. The obvious
   * one-liner (`this.writing = this.writing.then(() => this.writeNow(items)); return this.writing`)
   * fails twice on a single rejected write, and both failures are silent:
   *
   *  - `rejected.then(onFulfilled)` never calls `onFulfilled`, so `this.writing` stays rejected
   *    forever and EVERY later `save()` is skipped without writing anything. One transient
   *    Windows `EPERM` (Defender/indexer/OneDrive holding the target — the exact reason
   *    `renameAtomic` exists) therefore disables the queue's persistence for the life of the
   *    process, and the in-memory queue silently stops surviving restarts.
   *  - the chain is also the value returned to fire-and-forget callers, so that same rejection
   *    resurfaces later as an unhandled rejection attributed to an unrelated save.
   *
   * So: the internal chain is kept SETTLED (a failed write only ORDERS the next one, it never
   * cancels it), while the returned promise still carries this write's real error to whoever
   * awaits it. Failing to persist must degrade to "this one write failed", never to "no write
   * ever happens again". This is the same `run` / `chain = run.catch()` shape `SettingsStore`,
   * `ScheduledSettingsStore`, `KidsMode` and `SchoolMode` already use — this store was the outlier.
   */
  save(items: T[]): Promise<void> {
    const run = this.writing.then(() => this.writeNow(items))
    this.writing = run.catch(() => {})
    return run
  }

  private async writeNow(items: T[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, JSON.stringify(items))
  }
}
