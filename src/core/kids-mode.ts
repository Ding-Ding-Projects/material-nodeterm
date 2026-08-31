// Kids mode — the store. The safety policy it enforces lives in kids-mode-policy.ts; the PIN
// credential it uses is shared with School mode in shared-mode-credential.ts.
//
// SHAPE, and why it mirrors School mode without being School mode:
//
// The record lives in the same SHARED local application-data directory (`~/.nodeterm/shared`),
// so several apps on one machine honour the same switch and a running app picks up a change
// LIVE. First enrollment chooses a PIN; later entry and leaving require the grown-up PIN. The
// credential half is shared with School mode, while record semantics remain separate.
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
import { promises as fs } from 'fs'

import { IPC } from '../shared/ipc'
import type { KidsCredentialState, KidsModeRecord, KidsModeSnapshot } from '../shared/types'
import { DEFAULT_KIDS_MODE_NAME } from '../shared/kids-mode-name'
import { platform } from './platform'
import {
  isAcceptablePin,
  setCredential as writeCredential,
  verifyPin as checkPin,
  MIN_PIN_LENGTH
} from './shared-mode-credential'
import {
  readAtomicFileSnapshot,
  withCrossProcessLock,
  writeAtomicFileCompared,
  type AtomicFileSnapshot,
  type CrossProcessLease
} from './fs-transaction-lock'
import {
  SharedRecordWatcher,
  type SharedRecordWatch,
  type SharedRecordWatchToken
} from './shared-record-watch'

const MAX_NAME_LENGTH = 80
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

// Re-exported from src/shared so the renderer can use it as a pre-IPC default without importing
// this node:fs-using module into the browser bundle. One definition, so the two cannot drift.
export { DEFAULT_KIDS_MODE_NAME } from '../shared/kids-mode-name'

const DEFAULT_RECORD: KidsModeRecord = { version: 1, enabled: false, name: DEFAULT_KIDS_MODE_NAME }

export interface KidsModeStoreDeps {
  readSnapshot?: typeof readAtomicFileSnapshot
  withLock?: typeof withCrossProcessLock
  writeCompared?: typeof writeAtomicFileCompared
  createWatcher?: (
    file: string,
    onSyncRequired: (token: SharedRecordWatchToken) => void,
    onHealthChange: (healthy: boolean) => void
  ) => SharedRecordWatch
}

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

export class KidsModeRecordUnavailableError extends Error {
  readonly code = 'kids-mode-record-unavailable' as const

  constructor(
    readonly reason: 'invalid' | 'unreadable',
    cause?: unknown
  ) {
    super(
      reason === 'invalid'
        ? 'The Kids mode record is malformed; no change was saved.'
        : 'The Kids mode record could not be read; no change was saved.',
      cause === undefined ? undefined : { cause }
    )
  }
}

interface LoadedKidsRecord {
  record: KidsModeRecord
  revision: string
}

function parseKidsRecord(snapshot: AtomicFileSnapshot): LoadedKidsRecord {
  if (!snapshot.exists) return { record: DEFAULT_RECORD, revision: snapshot.revision }

  let parsed: unknown
  try {
    parsed = JSON.parse(snapshot.data.toString('utf8'))
  } catch (cause) {
    throw new KidsModeRecordUnavailableError('invalid', cause)
  }
  if (!isValidRecord(parsed)) throw new KidsModeRecordUnavailableError('invalid')
  return {
    record: { version: 1, enabled: parsed.enabled, name: sanitizeName(parsed.name) },
    revision: snapshot.revision
  }
}

export class KidsModeStore {
  private readonly readSnapshot: typeof readAtomicFileSnapshot
  private readonly withLock: typeof withCrossProcessLock
  private readonly writeCompared: typeof writeAtomicFileCompared
  private readonly watcher: SharedRecordWatch
  private cache: KidsModeRecord = DEFAULT_RECORD
  private readAuthoritative = false
  private watcherHealthy = false
  private generation = 0
  private listeners = new Set<(r: KidsModeSnapshot) => void>()
  /** Every write is FIFO'd: the watcher's own reload can race a write we just issued. */
  private chain: Promise<unknown> = Promise.resolve()
  /** Invalidates watcher reloads that were queued before dispose/re-init. */
  private lifecycle = 0
  /** Invalidates a read that began before a newer watcher event announced possible replacement. */
  private recordChangeGeneration = 0

  constructor(deps: KidsModeStoreDeps = {}) {
    this.readSnapshot = deps.readSnapshot ?? readAtomicFileSnapshot
    this.withLock = deps.withLock ?? withCrossProcessLock
    this.writeCompared = deps.writeCompared ?? writeAtomicFileCompared
    this.watcher = (deps.createWatcher ?? ((file, onSyncRequired, onHealthChange) =>
      new SharedRecordWatcher(file, onSyncRequired, undefined, onHealthChange)))(
      recordFile(),
      (token) => this.queueReload(token),
      (healthy) => this.onWatcherHealthChange(healthy)
    )
  }

  async init(): Promise<void> {
    const lifecycle = ++this.lifecycle
    this.readAuthoritative = false
    const token = this.watcher.start()
    if (!token) {
      this.bumpAndNotify()
      return
    }
    const run = this.chain.then(() => this.reload(lifecycle, token))
    this.chain = run.catch(() => {})
    await run
  }

  private async loadStrict(): Promise<LoadedKidsRecord> {
    let snapshot: AtomicFileSnapshot
    try {
      snapshot = await this.readSnapshot(recordFile())
    } catch (cause) {
      throw new KidsModeRecordUnavailableError('unreadable', cause)
    }
    return parseKidsRecord(snapshot)
  }

  private async reload(lifecycle: number, token: SharedRecordWatchToken): Promise<boolean> {
    const before = this.snapshot()
    let loaded: LoadedKidsRecord
    try {
      loaded = await this.loadStrict()
    } catch (error) {
      if (lifecycle !== this.lifecycle || !this.watcher.isCurrent(token)) return false
      this.readAuthoritative = false
      // Malformed bytes have no display value. An I/O failure says nothing and therefore preserves
      // the last-known record while authorization remains unavailable.
      if (error instanceof KidsModeRecordUnavailableError && error.reason === 'invalid') {
        this.cache = DEFAULT_RECORD
      }
      this.notifyIfChanged(before)
      return false
    }

    if (lifecycle !== this.lifecycle || !this.watcher.isCurrent(token)) return false
    this.cache = loaded.record
    this.readAuthoritative = true
    if (!this.watcher.acknowledge(token)) {
      this.readAuthoritative = false
      return false
    }
    this.notifyIfChanged(before)
    return true
  }

  private queueReload(token: SharedRecordWatchToken): void {
    const lifecycle = this.lifecycle
    const before = this.snapshot()
    this.readAuthoritative = false
    this.notifyIfChanged(before)
    const run = this.chain.then(async () => {
      await this.reload(lifecycle, token)
    })
    this.chain = run.catch(() => {})
  }

  private onWatcherHealthChange(healthy: boolean): void {
    const before = this.snapshot()
    this.watcherHealthy = healthy
    // Recovery-to-healthy is published by reload() after it applies the exact acknowledged read.
    // Failure must be visible synchronously so nobody spends a stale OFF while the read is queued.
    if (!healthy) this.notifyIfChanged(before)
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
      authoritative: this.readAuthoritative && this.watcherHealthy,
      generation: this.generation
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
    const snapshot = this.snapshot()
    for (const cb of this.listeners) {
      try {
        cb(snapshot)
      } catch {
        // A listener must never break the store or its siblings.
      }
    }
  }

  private bumpAndNotify(): void {
    this.generation += 1
    this.notify()
  }

  private notifyIfChanged(before: KidsModeSnapshot): void {
    const after = this.snapshot()
    if (
      before.enabled !== after.enabled ||
      before.name !== after.name ||
      before.authoritative !== after.authoritative
    ) {
      this.bumpAndNotify()
    }
  }

  private async mutateRecord(
    mutate: (current: KidsModeRecord) => KidsModeRecord
  ): Promise<KidsModeSnapshot> {
    const file = recordFile()
    const next = await this.withLock(file, async (lease: CrossProcessLease) => {
      const loaded = await this.loadStrict()
      const record = mutate(loaded.record)
      await this.writeCompared(
        file,
        JSON.stringify(record, null, 2),
        loaded.revision,
        lease,
        { encoding: 'utf8', mode: 0o600 }
      )
      return record
    })

    const before = this.snapshot()
    this.cache = next
    this.readAuthoritative = true
    this.watcher.recordWritten()
    this.notifyIfChanged(before)
    return this.snapshot()
  }

  rename(name: string): Promise<KidsModeSnapshot> {
    const sanitized = sanitizeName(name)
    const run = this.chain.then(() =>
      this.mutateRecord((current) => ({ ...current, name: sanitized }))
    )
    this.chain = run.catch(() => {})
    return run
  }

  /**
   * Classify the shared PIN without exposing any credential material. ENOENT is the only proof
   * that no PIN exists. Malformed, unreadable, or unsealable bytes remain unavailable so a stale
   * renderer can never turn an unknown credential into an enrollment or bypass.
   */
  async credentialState(): Promise<KidsCredentialState> {
    let raw: string
    try {
      raw = await fs.readFile(credentialFile(), 'utf8')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'
      return 'unavailable'
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return 'unavailable'
    }
    if (!parsed || typeof parsed !== 'object') return 'unavailable'
    const value = parsed as Record<string, unknown>
    if (
      value.version !== 1 ||
      typeof value.salt !== 'string' ||
      typeof value.hash !== 'string' ||
      typeof value.sealed !== 'boolean' ||
      value.salt.length === 0 ||
      value.hash.length === 0 ||
      !BASE64.test(value.salt) ||
      !BASE64.test(value.hash) ||
      Buffer.from(value.salt, 'base64').length === 0 ||
      Buffer.from(value.hash, 'base64').length === 0
    ) return 'unavailable'

    // A sealed record is usable only when this process can unseal it. The returned bytes stay
    // inside this method and are never returned, logged, or included in a snapshot.
    try {
      if (value.sealed) {
        const p = platform()
        if (typeof p.unsealSecret !== 'function') return 'unavailable'
        const unsealed = p.unsealSecret(Buffer.from(value.hash, 'base64')).toString('utf8')
        if (!BASE64.test(unsealed) || Buffer.from(unsealed, 'base64').length === 0) return 'unavailable'
      } else if (Buffer.from(value.hash, 'base64').length === 0) {
        return 'unavailable'
      }
    } catch {
      return 'unavailable'
    }
    return 'present'
  }

  /** Turn it ON. First enrollment chooses a PIN; every later enable verifies the existing PIN. */
  enable(pin?: string): Promise<KidsModeSnapshot> {
    const run = this.chain.then(async () => {
      const credential = await this.credentialState()
      if (credential === 'unavailable') {
        throw new Error('the grown-up PIN could not be checked on this machine')
      }
      if (credential === 'absent') {
        const trimmed = (pin ?? '').trim()
        if (!isAcceptablePin(trimmed)) {
          throw new Error(
            `a PIN of at least ${MIN_PIN_LENGTH} characters is required the first time kids mode is turned on`
          )
        }
        await writeCredential(credentialFile(), trimmed)
      } else if (!(await checkPin(credentialFile(), (pin ?? '').trim()))) {
        throw new Error('incorrect PIN')
      }
      return this.mutateRecord((current) => ({ ...current, enabled: true }))
    })
    this.chain = run.catch(() => {})
    return run
  }

  /**
   * Turn it OFF. Requires the grown-up PIN — this is the whole point of the mode.
   *
   * EXCEPT when there is no PIN to require. The mode lives in a record SHARED across every app on
   * this machine, and the credential is a separate file: another app can turn the mode on, and a
   * restore or a partial reset can bring the record back without the credential beside it. So
   * "enabled, with no credential" is a reachable state, and in it every PIN is wrong forever —
   * the user is locked out of a mode they never set a key for, with no way back short of deleting
   * application data.
   *
   * A lock nobody can open is not a lock, it is a lockout, and this one is a self-imposed
   * speed bump rather than a security boundary. So an absent credential disables freely.
   *
   * This does NOT weaken a real lock: `credentialState()` reports absent only for ENOENT. An
   * unreadable or unsealable credential remains unavailable and keeps the mode locked, because
   * "cannot verify" must never read as "no key".
   */
  disable(pin: string): Promise<{ ok: true; record: KidsModeSnapshot } | { ok: false; error: string }> {
    const run = this.chain.then(async () => {
      const credential = await this.credentialState()
      if (credential === 'absent') {
        return {
          ok: true as const,
          record: await this.mutateRecord((current) => ({ ...current, enabled: false }))
        }
      }
      if (credential === 'unavailable') throw new Error('the grown-up PIN could not be checked on this machine')
      if (!(await checkPin(credentialFile(), pin))) return { ok: false as const, error: 'incorrect PIN' }
      return {
        ok: true as const,
        record: await this.mutateRecord((current) => ({ ...current, enabled: false }))
      }
    })
    this.chain = run.catch(() => ({
      ok: false as const,
      error: 'the grown-up PIN could not be checked on this machine'
    }))
    return run
  }

  changePin(currentPin: string, nextPin: string): Promise<boolean> {
    const run = this.chain.then(async () => {
      if ((await this.credentialState()) !== 'present') return false
      if (!(await checkPin(credentialFile(), currentPin))) return false
      const trimmed = nextPin.trim()
      if (!isAcceptablePin(trimmed)) return false
      await writeCredential(credentialFile(), trimmed)
      return true
    })
    this.chain = run.catch(() => false)
    return run
  }

  /**
   * Verify the grown-up PIN WITHOUT changing anything — the check the parent gate uses to reach
   * the grown-up screen without turning kids mode off. Never mutates the record and is never
   * chained behind `this.chain`: a read-only check must not queue behind (or block) a pending
   * write, and it has nothing to race.
   *
   * Mirrors `disable()`'s "no credential" honesty: a record that is ON with no credential ever
   * set (another app enabled it, or a partial restore dropped the credential file) has no PIN
   * that could ever be right, so refusing entry there would lock a grown-up out of a screen whose
   * only job is administering the mode. The mode itself is a self-imposed speed bump, not
   * security — see KIDS_DISCLOSURE — so this stays consistent with that promise rather than
   * inventing a stricter rule for one screen.
   */
  async verifyPin(pin: string): Promise<boolean> {
    const state = await this.credentialState()
    if (state === 'absent') return true
    if (state === 'unavailable') return false
    return checkPin(credentialFile(), pin)
  }

  /** Remove only the Kids credential and turn the shared Kids record off. */
  resetCredential(): Promise<
    | { ok: true; record: KidsModeSnapshot }
    | { ok: false; error: string }
  > {
    const run = this.chain.then(async () => {
      // Credential writers use this lock, so the re-read and removal cannot race a concurrent
      // enrollment. The record is written first, preserving the safe off state if file removal is
      // interrupted; a subsequent retry can finish the credential removal without touching other
      // shared records.
      const result = await this.withLock(credentialFile(), async (credentialLease: CrossProcessLease) => {
        const file = recordFile()
        const record = await this.withLock(file, async (recordLease: CrossProcessLease) => {
          const loaded = await this.loadStrict()
          const next = { ...loaded.record, enabled: false }
          await this.writeCompared(
            file,
            JSON.stringify(next, null, 2),
            loaded.revision,
            recordLease,
            { encoding: 'utf8', mode: 0o600 }
          )
          return next
        })
        await fs.rm(credentialFile(), { force: true })
        return record
      })
      const before = this.snapshot()
      this.cache = result
      this.readAuthoritative = true
      this.watcher.recordWritten()
      this.notifyIfChanged(before)
      return { ok: true as const, record: this.snapshot() }
    })
    this.chain = run.catch(() => ({
      ok: false as const,
      error: 'the Kids mode PIN reset could not be completed'
    }))
    return run
  }

  registerIpc(): void {
    const p = platform()
    p.handle(IPC.kidsModeLoad, () => this.snapshot())
    p.handle(IPC.kidsModeEnable, (pin?: string) => this.enable(pin))
    p.handle(IPC.kidsModeDisable, (pin: string) => this.disable(pin))
    p.handle(IPC.kidsModeRename, (name: string) => this.rename(name))
    p.handle(IPC.kidsModeChangePin, (a: string, b: string) => this.changePin(a, b))
    p.handle(IPC.kidsModeCredentialState, () => this.credentialState())
    p.handle(IPC.kidsModeVerifyPin, (pin: string) => this.verifyPin(pin))
    p.handle(IPC.kidsModeResetCredential, () => this.resetCredential())
    this.onChange((r) => p.broadcast(IPC.kidsModeChanged, r))
  }
}
