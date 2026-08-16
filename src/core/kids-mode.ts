// Kids mode — the store. The safety policy it enforces lives in kids-mode-policy.ts; the PIN
// credential it uses is shared with School mode in shared-mode-credential.ts.
//
// SHAPE, and why it mirrors School mode without being School mode:
//
// The record lives in the same SHARED local application-data directory (`~/.nodeterm/shared`),
// so several apps on one machine honour the same switch and a running app picks up a change
// LIVE. Entering needs no proof; leaving needs the grown-up PIN. That much is identical, which
// is exactly why the credential half was extracted rather than copied.
//
// Everything the modes MEAN is different, and they must not be collapsed into one:
//
//   School mode   removes playfulness — forces English, hides dim sum, Cantonese, funny levels,
//                 personal vocabulary — so a screen looks serious in a classroom.
//   Kids mode     KEEPS all of that, and restricts what can happen without an adult instead.
//
// So they are separate records with separate credentials. A child should not be able to leave
// kids mode using a PIN somebody set for an exam, and turning one on must not turn the other on.
//
// BOTH CAN BE ON AT ONCE, and the composition is deliberate: School mode's suppression wins over
// Kids mode's playfulness (it is the stricter presentation lock, and a classroom that also wants
// the safety restrictions should get both), while Kids mode's safety restrictions always apply
// regardless. Neither mode weakens the other — a rule that only ever adds restrictions cannot
// produce a surprising combination.

import os from 'os'
import path from 'path'

import { IPC } from '../shared/ipc'
import type { KidsModeRecord, KidsModeSnapshot } from '../shared/types'
import { DEFAULT_KIDS_MODE_NAME } from '../shared/kids-mode-name'
import { platform } from './platform'
import {
  hasCredential as credentialExists,
  isAcceptablePin,
  persistFile,
  setCredential as writeCredential,
  verifyPin as checkPin,
  MIN_PIN_LENGTH
} from './shared-mode-credential'
import { readSharedJson, SharedRecordWatcher } from './shared-record-watch'

const MAX_NAME_LENGTH = 80

// Re-exported from src/shared so the renderer can use it as a pre-IPC default without importing
// this node:fs-using module into the browser bundle. One definition, so the two cannot drift.
export { DEFAULT_KIDS_MODE_NAME } from '../shared/kids-mode-name'

const DEFAULT_RECORD: KidsModeRecord = { version: 1, enabled: false, name: DEFAULT_KIDS_MODE_NAME }

/** The same shared directory School mode uses — one place any app in this family can read. */
export function sharedDir(): string {
  return path.join(os.homedir(), '.nodeterm', 'shared')
}
function recordFile(): string {
  return path.join(sharedDir(), 'kids-mode.json')
}
function credentialFile(): string {
  return path.join(sharedDir(), 'kids-mode.credential.json')
}

function isValidRecord(v: unknown): v is KidsModeRecord {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return r.version === 1 && typeof r.enabled === 'boolean' && typeof r.name === 'string'
}

function sanitizeName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH) || DEFAULT_KIDS_MODE_NAME
}

export class KidsModeStore {
  constructor(private readonly persistRecord: typeof persistFile = persistFile) {}

  private cache: KidsModeRecord = DEFAULT_RECORD
  private readAuthoritative = false
  private watcherHealthy = false
  private listeners = new Set<(r: KidsModeSnapshot) => void>()
  private watcher = new SharedRecordWatcher(
    recordFile(),
    () => this.queueReload(),
    undefined,
    (healthy) => {
      if (healthy === this.watcherHealthy) return
      this.watcherHealthy = healthy
      this.notify()
    }
  )
  /** Every write is FIFO'd: the watcher's own reload can race a write we just issued. */
  private chain: Promise<unknown> = Promise.resolve()
  /** Invalidates watcher reloads that were queued before dispose/re-init. */
  private lifecycle = 0
  /** Invalidates a read that began before a newer watcher event announced possible replacement. */
  private recordChangeGeneration = 0

  async init(): Promise<void> {
    const lifecycle = ++this.lifecycle
    // Arm first, then read. Reading before installing the watcher leaves a lost-update window in
    // which another app can create an ON record after our ENOENT result and before the watch is
    // live, making a stale OFF snapshot look authoritative forever. Watcher events queue behind
    // this initial read on `chain`, so a write during the read is deterministically re-read after it.
    this.readAuthoritative = false
    this.watcher.start()
    const run = this.chain.then(() => this.reload(lifecycle))
    this.chain = run.catch(() => {})
    await run
  }

  private async reload(
    lifecycle: number,
    recordGeneration = this.recordChangeGeneration
  ): Promise<boolean> {
    const result = await readSharedJson(recordFile())
    if (
      lifecycle !== this.lifecycle ||
      recordGeneration !== this.recordChangeGeneration
    ) {
      this.readAuthoritative = false
      return false
    }
    if (result.kind === 'value') {
      const parsed = result.value
      if (isValidRecord(parsed)) {
        this.cache = { version: 1, enabled: parsed.enabled, name: sanitizeName(parsed.name) }
        this.readAuthoritative = true
      } else {
        this.cache = DEFAULT_RECORD
        this.readAuthoritative = false
      }
    } else if (result.kind === 'absent') {
      // Only a proven absence means the default OFF is authoritative. Corrupt or unreadable data
      // remains display-OFF on first boot but destructive policy must report unavailable.
      this.cache = DEFAULT_RECORD
      this.readAuthoritative = true
    } else if (result.kind === 'invalid') {
      this.cache = DEFAULT_RECORD
      this.readAuthoritative = false
    } else {
      this.readAuthoritative = false
    }
    return this.readAuthoritative
  }

  private queueReload(): void {
    const lifecycle = this.lifecycle
    const recordGeneration = ++this.recordChangeGeneration
    const wasAuthoritative = this.snapshot().authoritative
    // fs.watch says the bytes MAY have changed. That fact alone invalidates the old OFF/ON verdict
    // synchronously; a slow queued read must not leave destructive callers spending stale OFF.
    this.readAuthoritative = false
    if (wasAuthoritative) this.notify()
    const run = this.chain.then(async () => {
      const before = this.snapshot()
      await this.reload(lifecycle, recordGeneration)
      const after = this.snapshot()
      if (
        before.enabled !== after.enabled ||
        before.name !== after.name ||
        before.authoritative !== after.authoritative
      ) this.notify()
    })
    this.chain = run.catch(() => {})
  }

  dispose(): void {
    this.lifecycle += 1
    this.watcher.dispose()
  }

  get(): KidsModeRecord {
    return this.cache
  }

  snapshot(): KidsModeSnapshot {
    return {
      ...this.cache,
      authoritative: this.readAuthoritative && this.watcherHealthy
    }
  }

  /** Convenience for the many callers that only need the boolean. */
  isOn(): boolean {
    return this.cache.enabled
  }

  onChange(cb: (r: KidsModeSnapshot) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private notify(): void {
    for (const cb of this.listeners) {
      try {
        cb(this.snapshot())
      } catch {
        // A listener must never break the store or its siblings.
      }
    }
  }

  private async writeRecord(next: KidsModeRecord): Promise<KidsModeRecord> {
    await this.persistRecord(recordFile(), JSON.stringify(next, null, 2))
    // Durable bytes first. A disk-full/EACCES failure must leave the authoritative in-memory policy
    // unchanged rather than reporting OFF while the shared record still says ON.
    this.cache = next
    this.readAuthoritative = true
    this.watcher.recordWritten()
    this.notify()
    return this.cache
  }

  rename(name: string): Promise<KidsModeRecord> {
    const run = this.chain.then(() => this.writeRecord({ ...this.cache, name: sanitizeName(name) }))
    this.chain = run.catch(() => {})
    return run
  }

  hasCredential(): Promise<boolean> {
    return credentialExists(credentialFile())
  }

  /** Turn it ON. A PIN is required only the first time, and becomes the grown-up PIN. */
  enable(pin?: string): Promise<KidsModeRecord> {
    const run = this.chain.then(async () => {
      if (!(await this.hasCredential())) {
        const trimmed = (pin ?? '').trim()
        if (!isAcceptablePin(trimmed)) {
          throw new Error(
            `a PIN of at least ${MIN_PIN_LENGTH} characters is required the first time kids mode is turned on`
          )
        }
        await writeCredential(credentialFile(), trimmed)
      }
      return this.writeRecord({ ...this.cache, enabled: true })
    })
    this.chain = run.catch(() => {})
    return run
  }

  /** Turn it OFF. Requires the grown-up PIN — this is the whole point of the mode. */
  disable(pin: string): Promise<{ ok: true; record: KidsModeRecord } | { ok: false; error: string }> {
    const run = this.chain.then(async () => {
      if (!(await checkPin(credentialFile(), pin))) return { ok: false as const, error: 'incorrect PIN' }
      return { ok: true as const, record: await this.writeRecord({ ...this.cache, enabled: false }) }
    })
    this.chain = run.catch(() => ({ ok: false as const, error: 'incorrect PIN' }))
    return run
  }

  changePin(currentPin: string, nextPin: string): Promise<boolean> {
    const run = this.chain.then(async () => {
      if (!(await checkPin(credentialFile(), currentPin))) return false
      const trimmed = nextPin.trim()
      if (!isAcceptablePin(trimmed)) return false
      await writeCredential(credentialFile(), trimmed)
      return true
    })
    this.chain = run.catch(() => false)
    return run
  }

  registerIpc(): void {
    const p = platform()
    p.handle(IPC.kidsModeLoad, () => this.snapshot())
    p.handle(IPC.kidsModeEnable, (pin?: string) => this.enable(pin))
    p.handle(IPC.kidsModeDisable, (pin: string) => this.disable(pin))
    p.handle(IPC.kidsModeRename, (name: string) => this.rename(name))
    p.handle(IPC.kidsModeChangePin, (a: string, b: string) => this.changePin(a, b))
    p.handle(IPC.kidsModeHasCredential, () => this.hasCredential())
    this.onChange((r) => p.broadcast(IPC.kidsModeChanged, r))
  }
}
