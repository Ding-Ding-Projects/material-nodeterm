import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { promises as fs, type FSWatcher, watch } from 'fs'
import os from 'os'
import path from 'path'
import { IPC } from '../shared/ipc'
import type { SchoolModeRecord } from '../shared/types'
import { platform } from './platform'

/**
 * "School mode" — a self-imposed, USER-EXPERIENCE switch, not a security boundary. While on,
 * every surface forces English presentation and behaves as if the Cantonese / bilingual /
 * funny-level / dim-sum-surprise / personal-vocabulary capabilities were not installed: omitted,
 * never merely disabled-and-visible.
 *
 * The record lives in a SHARED local application-data location — deliberately OUTSIDE any one
 * app's own userData/settings.json — so several apps on the same machine can read and honor the
 * same switch (see the feature brief: "several apps could read it"). `~/.nodeterm/shared/` is
 * that location: not tied to Electron's per-app userData dir, not per-window, not per-project.
 *
 * Turning the mode OFF requires a PIN, checked against a stored HASH (scrypt), never a stored
 * plaintext PIN. The hash+salt is written to its OWN file, sealed at rest via the platform's
 * seal/unseal hooks when available (Desktop: Electron `safeStorage`, which is itself backed by
 * the OS credential vault — DPAPI / Keychain / libsecret) and as raw 0600 bytes when it is not
 * (the Server Edition has no OS keychain to seal into — same documented trade-off
 * `core/agents/node-auth-secret.ts` already makes for the exact same reason). The credential
 * NEVER rides in the shared record file itself (that file is meant to be readable by any local
 * app, and must never carry secret material), never in settings.json, never in an export, log,
 * screenshot or Git history.
 *
 * Turning the mode ON never requires the PIN — entering a focus mode needs no proof, only
 * leaving it does. The very first `enable()` call on a machine with no stored credential yet
 * establishes one from the supplied PIN.
 *
 * Deleting `~/.nodeterm/shared/` is the documented, self-service reset: it drops the record back
 * to defaults (off) and the credential along with it. Every surface that shows the unlock route
 * must name this path in plain words — see docs/school-mode.md.
 */

const SCRYPT_KEYLEN = 32
const MIN_PIN_LENGTH = 4
const MAX_PIN_LENGTH = 128
const MAX_NAME_LENGTH = 80

export const DEFAULT_SCHOOL_MODE_NAME = 'School mode'

const DEFAULT_RECORD: SchoolModeRecord = { version: 1, enabled: false, name: DEFAULT_SCHOOL_MODE_NAME }

interface StoredCredential {
  version: 1
  /** base64 scrypt salt. */
  salt: string
  /** base64 scrypt hash — sealed (via the platform's sealSecret) when `sealed` is true, raw
   *  base64 bytes when it is not. Never a stored plaintext PIN, either way. */
  hash: string
  sealed: boolean
}

/** `~/.nodeterm/shared` — a location any locally installed app in this family can read, distinct
 *  from Electron's per-app `userData` dir (which `platform().userDataDir` resolves to). */
export function sharedDir(): string {
  return path.join(os.homedir(), '.nodeterm', 'shared')
}
function recordFile(): string {
  return path.join(sharedDir(), 'school-mode.json')
}
function credentialFile(): string {
  return path.join(sharedDir(), 'school-mode.credential.json')
}

/** Write bytes atomically: unique tmp with 0600, rename into place. A reader never observes a
 *  partial file, and a crash mid-write never corrupts the previous good record. Mirrors the
 *  pattern in core/agents/node-auth-secret.ts and core/settings-store.ts. */
async function persistFile(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  try {
    await fs.writeFile(tmp, data, { mode: 0o600 })
    await fs.rename(tmp, file)
    await fs.chmod(file, 0o600).catch(() => {})
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

/** Whether this shell can seal secrets at rest. Throws on a shell wired with exactly one of the
 *  two hooks — a programming error, same contract `node-auth-secret.ts` enforces. */
function seals(): boolean {
  const p = platform()
  const hasSeal = typeof p.sealSecret === 'function'
  const hasUnseal = typeof p.unsealSecret === 'function'
  if (hasSeal !== hasUnseal) {
    throw new Error('CorePlatform must supply both sealSecret and unsealSecret, or neither')
  }
  return hasSeal
}

function deriveHash(pin: string, salt: Buffer): Buffer {
  return scryptSync(pin, salt, SCRYPT_KEYLEN)
}

function isValidRecord(v: unknown): v is SchoolModeRecord {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return r.version === 1 && typeof r.enabled === 'boolean' && typeof r.name === 'string'
}

function sanitizeName(name: string): string {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH)
  return trimmed || DEFAULT_SCHOOL_MODE_NAME
}

export class SchoolModeStore {
  private cache: SchoolModeRecord = DEFAULT_RECORD
  private listeners = new Set<(r: SchoolModeRecord) => void>()
  private watcher: FSWatcher | null = null
  /** Every write is FIFO'd through this chain (same idiom as SettingsStore.saveChain / WorkspaceStore
   *  .saveChain): the watcher's own reload can race a write we just issued ourselves. */
  private chain: Promise<unknown> = Promise.resolve()

  /** Load the current record from disk (or defaults) and start watching for external edits. Call
   *  once at boot, before `registerIpc()`. */
  async init(): Promise<void> {
    await this.reload()
    this.watchDir()
  }

  private async reload(): Promise<void> {
    try {
      const raw = await fs.readFile(recordFile(), 'utf-8')
      const parsed: unknown = JSON.parse(raw)
      this.cache = isValidRecord(parsed)
        ? { version: 1, enabled: parsed.enabled, name: sanitizeName(parsed.name) }
        : DEFAULT_RECORD
    } catch {
      // Absent (first run — no app has enabled the mode yet) or corrupt: defaults, silently. A
      // hand-editable shared file must never crash a boot over a malformed byte.
      this.cache = DEFAULT_RECORD
    }
  }

  /** Watch the shared directory (not the file — it may not exist yet, and editors/other
   *  processes commonly write via temp+rename, which a file-handle watch can miss) so a change
   *  made by another app or window is picked up and applied LIVE, no restart required. Best
   *  effort: if the directory cannot be created/watched yet, changes still apply on the next IPC
   *  call — never fatal. */
  private watchDir(): void {
    const dir = path.dirname(recordFile())
    try {
      this.watcher?.close()
      this.watcher = watch(dir, { persistent: false }, (_evt, filename) => {
        if (filename && filename !== path.basename(recordFile())) return
        void this.chain.then(async () => {
          const before = this.cache
          await this.reload()
          if (before.enabled !== this.cache.enabled || before.name !== this.cache.name) {
            this.notify()
          }
        })
      })
    } catch {
      // Directory doesn't exist yet (nobody has ever turned the mode on/renamed it on this
      // machine) — created lazily by the first write, at which point a later init() elsewhere
      // (or this process's own writes, which reload synchronously) will see it.
    }
  }

  dispose(): void {
    this.watcher?.close()
    this.watcher = null
  }

  get(): SchoolModeRecord {
    return this.cache
  }

  onChange(cb: (r: SchoolModeRecord) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private notify(): void {
    for (const cb of this.listeners) {
      try {
        cb(this.cache)
      } catch {
        // A listener must never break the store or its siblings.
      }
    }
  }

  private async writeRecord(next: SchoolModeRecord): Promise<SchoolModeRecord> {
    this.cache = next
    await persistFile(recordFile(), JSON.stringify(next, null, 2))
    this.notify()
    return this.cache
  }

  /** Rename the mode's display name. No PIN: renaming carries no security meaning, and the
   *  contract only ever gates LEAVING the mode. */
  rename(name: string): Promise<SchoolModeRecord> {
    const run = this.chain.then(() => this.writeRecord({ ...this.cache, name: sanitizeName(name) }))
    this.chain = run.catch(() => {})
    return run
  }

  async hasCredential(): Promise<boolean> {
    try {
      await fs.access(credentialFile())
      return true
    } catch {
      return false
    }
  }

  private async setCredential(pin: string): Promise<void> {
    const salt = randomBytes(16)
    const hash = deriveHash(pin, salt)
    const sealedOk = seals()
    const hashB64 = hash.toString('base64')
    // sealSecret encrypts the UTF-8 CONTENT of the buffer it is given (see platform-electron.ts),
    // so binary hash bytes must be base64-encoded into an ASCII string FIRST — sealing the raw
    // bytes directly would corrupt them (not every byte sequence is valid UTF-8). Mirrors
    // core/agents/node-auth-secret.ts exactly.
    const hashOut = sealedOk
      ? platform().sealSecret!(Buffer.from(hashB64, 'utf8')).toString('base64')
      : hashB64
    const body: StoredCredential = { version: 1, salt: salt.toString('base64'), hash: hashOut, sealed: sealedOk }
    await persistFile(credentialFile(), JSON.stringify(body))
  }

  private async verifyPin(pin: string): Promise<boolean> {
    let stored: StoredCredential
    try {
      stored = JSON.parse(await fs.readFile(credentialFile(), 'utf-8')) as StoredCredential
    } catch {
      return false
    }
    if (stored?.version !== 1 || typeof stored.salt !== 'string' || typeof stored.hash !== 'string') {
      return false
    }
    let expected: Buffer
    try {
      expected = stored.sealed
        ? Buffer.from(platform().unsealSecret!(Buffer.from(stored.hash, 'base64')).toString('utf8'), 'base64')
        : Buffer.from(stored.hash, 'base64')
    } catch {
      // Unseal can fail across a machine migration / keychain reset — treat as "cannot verify",
      // never as a crash. The user's documented recovery is deleting the shared record.
      return false
    }
    const candidate = deriveHash(pin, Buffer.from(stored.salt, 'base64'))
    if (expected.byteLength !== candidate.byteLength) return false
    return timingSafeEqual(expected, candidate)
  }

  /** Turn the mode ON. `pin` is required only when no credential exists yet on this machine. */
  enable(pin?: string): Promise<SchoolModeRecord> {
    const run = this.chain.then(async () => {
      if (!(await this.hasCredential())) {
        const trimmed = (pin ?? '').trim()
        if (trimmed.length < MIN_PIN_LENGTH || trimmed.length > MAX_PIN_LENGTH) {
          throw new Error(`a PIN of at least ${MIN_PIN_LENGTH} characters is required the first time this mode is turned on`)
        }
        await this.setCredential(trimmed)
      }
      return this.writeRecord({ ...this.cache, enabled: true })
    })
    this.chain = run.catch(() => {})
    return run
  }

  /** Turn the mode OFF. Requires the correct PIN. */
  disable(pin: string): Promise<{ ok: true; record: SchoolModeRecord } | { ok: false; error: string }> {
    const run = this.chain.then(async () => {
      if (!(await this.verifyPin(pin))) return { ok: false as const, error: 'incorrect PIN' }
      const record = await this.writeRecord({ ...this.cache, enabled: false })
      return { ok: true as const, record }
    })
    this.chain = run.catch(() => ({ ok: false as const, error: 'incorrect PIN' }))
    return run
  }

  /** Change the unlock PIN. Requires the current one. */
  changePin(currentPin: string, nextPin: string): Promise<boolean> {
    const run = this.chain.then(async () => {
      if (!(await this.verifyPin(currentPin))) return false
      const trimmed = nextPin.trim()
      if (trimmed.length < MIN_PIN_LENGTH || trimmed.length > MAX_PIN_LENGTH) return false
      await this.setCredential(trimmed)
      return true
    })
    this.chain = run.catch(() => false)
    return run
  }

  registerIpc(): void {
    const p = platform()
    p.handle(IPC.schoolModeLoad, () => this.get())
    p.handle(IPC.schoolModeEnable, (pin?: string) => this.enable(pin))
    p.handle(IPC.schoolModeDisable, (pin: string) => this.disable(pin))
    p.handle(IPC.schoolModeRename, (name: string) => this.rename(name))
    p.handle(IPC.schoolModeChangePin, (currentPin: string, nextPin: string) =>
      this.changePin(currentPin, nextPin)
    )
    p.handle(IPC.schoolModeHasCredential, () => this.hasCredential())
    this.onChange((r) => p.broadcast(IPC.schoolModeChanged, r))
  }
}
