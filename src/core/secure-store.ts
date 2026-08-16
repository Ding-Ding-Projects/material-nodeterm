// A small, generic "sealed-secret list" file, shared by the toy-lock and authenticator services
// (src/core/toylocks/). Each record splits into cleartext METADATA (safe to hand the renderer —
// names, timestamps, algorithm choices) and a sealed SECRET payload (a password hash, or a TOTP
// key) that only this module ever unseals.
//
// Sealing follows the exact convention core/agents/node-auth-secret.ts already established: use
// the shell's OS-vault seal/unseal when the platform offers one (Desktop: Electron `safeStorage`);
// otherwise store the payload as raw bytes in a 0600 file (the Server Edition's documented "no
// keychain here" configuration — see CorePlatform.sealSecret's doc comment). Either way the file
// itself is written 0600 via an atomic tmp+rename, so a reader never observes a half-written file
// and nothing but this process' own user can read it at rest.

import { promises as fs } from 'fs'
import path from 'path'
import { platform } from './platform'
import { renameAtomic, tempNameFor } from './fs-atomic'

export interface SealedEntry<TMeta> {
  meta: TMeta
  /** base64 of the sealed (or, on a no-seal shell, raw) JSON-encoded secret payload. */
  secretEnc: string
}

interface StoreFile<TMeta> {
  version: 1
  entries: SealedEntry<TMeta>[]
}

function isSealedEntry<TMeta extends { id: string }>(value: unknown): value is SealedEntry<TMeta> {
  if (!value || typeof value !== 'object') return false
  const entry = value as { meta?: unknown; secretEnc?: unknown }
  if (typeof entry.secretEnc !== 'string' || !entry.meta || typeof entry.meta !== 'object') {
    return false
  }
  return typeof (entry.meta as { id?: unknown }).id === 'string'
}

export interface SecureStoreMutation<TResult> {
  /** False leaves the current file byte-for-byte untouched. */
  changed: boolean
  result: TResult
}

// A SecureStore is cheap enough that services and tests can construct more than one for the same
// file. The queue therefore belongs to the resolved path, not to an instance. It is intentionally
// process-local: UUID temp names keep independent processes from sharing scratch files, while a
// cross-process read/modify/write transaction would require a separate lock or compare-and-swap
// protocol.
const operationTails = new Map<string, Promise<void>>()

function serializeForFile<TResult>(file: string, operation: () => Promise<TResult>): Promise<TResult> {
  const key = path.resolve(file)
  const previous = operationTails.get(key) ?? Promise.resolve()
  const result = previous.then(operation)
  // Store a never-rejecting tail so one failed request cannot poison every later request.
  const tail = result.then(
    () => undefined,
    () => undefined
  )
  operationTails.set(key, tail)
  void tail.then(() => {
    // A newer request may already have replaced this tail. Only the last request removes the key.
    if (operationTails.get(key) === tail) operationTails.delete(key)
  })
  return result
}

/** Whether this platform can seal secrets at rest. Throws if it supplies exactly one of the two
 *  hooks — a shell must supply BOTH or NEITHER (programming error), matching node-auth-secret.ts. */
function seals(): boolean {
  const p = platform()
  const hasSeal = typeof p.sealSecret === 'function'
  const hasUnseal = typeof p.unsealSecret === 'function'
  if (hasSeal !== hasUnseal) {
    throw new Error('CorePlatform must supply both sealSecret and unsealSecret, or neither')
  }
  return hasSeal
}

/** Write bytes atomically: unique tmp, 0600, rename into place, unlink the tmp in `finally` — a
 *  reader never sees a partial file, and two overlapping saves (renderer debounce + a shutdown
 *  flush) can never interleave their bytes. */
async function persistFile(file: string, data: string): Promise<void> {
  const tmp = tempNameFor(file)
  await fs.mkdir(path.dirname(file), { recursive: true })
  try {
    await fs.writeFile(tmp, data, { mode: 0o600 })
    // Tighten the owned temp before publication. A failure here leaves the prior canonical bytes
    // intact; doing this after rename can falsely report failure after the new entry is durable.
    await fs.chmod(tmp, 0o600)
    // Retries briefly on Windows if the destination is momentarily held open (AV/indexer/sync) — see fs-atomic.ts.
    await renameAtomic(tmp, file)
  } finally {
    await fs.unlink(tmp).catch(() => {})
  }
}

async function loadFile<TMeta extends { id: string }>(file: string): Promise<SealedEntry<TMeta>[]> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as StoreFile<TMeta>
    if (
      parsed?.version !== 1 ||
      !Array.isArray(parsed.entries) ||
      !parsed.entries.every(isSealedEntry<TMeta>)
    ) {
      throw new Error('Secure store has an unsupported or malformed document')
    }
    return parsed.entries
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    // A failed read is not an empty credential list. Propagate corruption/permissions so callers
    // can show an unavailable state without hiding locks or authenticator entries as absent.
    throw error
  }
}

export class SecureStore<TMeta extends { id: string }> {
  constructor(private readonly filename: string) {}

  private file(): string {
    return path.join(platform().userDataDir, this.filename)
  }

  /** Seal an arbitrary JSON-serializable secret payload (a password hash record, a TOTP secret +
   *  its algorithm/digits/period) into the base64 string a `SealedEntry.secretEnc` carries. */
  seal(payload: unknown): string {
    const json = Buffer.from(JSON.stringify(payload), 'utf8')
    if (seals()) return platform().sealSecret!(json).toString('base64')
    return json.toString('base64')
  }

  unseal<T>(secretEnc: string): T {
    const raw = Buffer.from(secretEnc, 'base64')
    const json = seals() ? platform().unsealSecret!(raw) : raw
    return JSON.parse(json.toString('utf8')) as T
  }

  /** Every record, metadata + sealed secret. A missing file is an empty list, not an error — a
   *  fresh install has neither locks nor authenticator entries yet. Corrupt/unreadable input
   *  rejects and remains untouched; callers must render it as unavailable, never as an empty list. */
  load(): Promise<SealedEntry<TMeta>[]> {
    const file = this.file()
    return serializeForFile(file, () => loadFile<TMeta>(file))
  }

  save(entries: SealedEntry<TMeta>[]): Promise<void> {
    const file = this.file()
    const body: StoreFile<TMeta> = { version: 1, entries }
    // Snapshot at invocation time. A caller retaining and later mutating `entries` must not change
    // what an already-enqueued save eventually publishes.
    const data = JSON.stringify(body, null, 2)
    return serializeForFile(file, () => persistFile(file, data))
  }

  /**
   * Serialize one complete read/modify/write transaction with every load, save, and mutation for
   * this resolved path, including calls made through another SecureStore instance. The callback
   * must use the supplied entries rather than calling this store recursively (which would wait on
   * its own transaction). A strict read aborts on corrupt or unreadable input so a failed read can
   * never become evidence that the credential list is empty.
   */
  mutate<TResult>(
    mutation: (
      entries: SealedEntry<TMeta>[]
    ) => SecureStoreMutation<TResult> | Promise<SecureStoreMutation<TResult>>
  ): Promise<TResult> {
    const file = this.file()
    return serializeForFile(file, async () => {
      const entries = await loadFile<TMeta>(file)
      const change = await mutation(entries)
      if (change.changed) {
        const body: StoreFile<TMeta> = { version: 1, entries }
        await persistFile(file, JSON.stringify(body, null, 2))
      }
      return change.result
    })
  }
}
