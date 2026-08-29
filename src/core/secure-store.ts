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

import path from 'path'
import { platform, type CorePlatform } from './platform'
import {
  readAtomicFileSnapshot,
  withCrossProcessLock,
  writeAtomicFileCompared,
  type AtomicFileSnapshot,
  type CrossProcessLease
} from './fs-transaction-lock'

export interface SealedEntry<TMeta> {
  meta: TMeta
  /** base64 of the sealed (or, on a no-seal shell, raw) JSON-encoded secret payload. */
  secretEnc: string
}

interface StoreFile<TMeta> {
  version: 1
  entries: SealedEntry<TMeta>[]
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function isSealedEntry<TMeta extends { id: string }>(value: unknown): value is SealedEntry<TMeta> {
  if (!value || typeof value !== 'object') return false
  const entry = value as { meta?: unknown; secretEnc?: unknown }
  if (typeof entry.secretEnc !== 'string' || !entry.meta || typeof entry.meta !== 'object') {
    return false
  }
  const id = (entry.meta as { id?: unknown }).id
  return typeof id === 'string' && UUID_V4_RE.test(id)
}

function validEntries<TMeta extends { id: string }>(entries: unknown): entries is SealedEntry<TMeta>[] {
  return (
    Array.isArray(entries) &&
    entries.every(isSealedEntry<TMeta>) &&
    new Set(entries.map((entry) => entry.meta.id)).size === entries.length
  )
}

function assertValidEntries<TMeta extends { id: string }>(entries: unknown): asserts entries is SealedEntry<TMeta>[] {
  if (!validEntries<TMeta>(entries)) {
    throw new Error('Secure store has an unsupported or malformed document')
  }
}

export interface SecureStoreMutation<TResult> {
  /** False leaves the current file byte-for-byte untouched. */
  changed: boolean
  result: TResult
}

// A SecureStore is cheap enough that services and tests can construct more than one for the same
// file. The queue therefore belongs to the resolved path, not to an instance. It avoids needless
// local lock intents and preserves invocation order; `withCrossProcessLock` supplies the separate
// ordering needed when Desktop and Server Edition deliberately share one physical data directory.
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
function seals(p: CorePlatform): boolean {
  const hasSeal = typeof p.sealSecret === 'function'
  const hasUnseal = typeof p.unsealSecret === 'function'
  if (hasSeal !== hasUnseal) {
    throw new Error('CorePlatform must supply both sealSecret and unsealSecret, or neither')
  }
  return hasSeal
}

/** Write bytes atomically after both the lease fence and exact-byte revision comparison. */
async function persistFile(
  file: string,
  data: string,
  expectedRevision: string,
  lease: CrossProcessLease
): Promise<void> {
  await writeAtomicFileCompared(file, data, expectedRevision, lease, { mode: 0o600 })
}

interface LoadedStore<TMeta> {
  entries: SealedEntry<TMeta>[]
  revision: string
}

async function loadFile<TMeta extends { id: string }>(file: string, maxBytes: number): Promise<LoadedStore<TMeta>> {
  const snapshot: AtomicFileSnapshot = await readAtomicFileSnapshot(file, maxBytes)
  if (!snapshot.exists) return { entries: [], revision: snapshot.revision }
  const parsed = JSON.parse(snapshot.data.toString('utf8')) as StoreFile<TMeta>
  if (
    parsed?.version !== 1 ||
    !validEntries<TMeta>(parsed.entries)
  ) {
    throw new Error('Secure store has an unsupported or malformed document')
  }
  return { entries: parsed.entries, revision: snapshot.revision }
}

export class SecureStore<TMeta extends { id: string }> {
  constructor(
    private readonly filename: string,
    private readonly hostPlatform: CorePlatform = platform(),
    private readonly maxBytes = 4 * 1024 * 1024
  ) {}

  private file(): string {
    return path.join(this.hostPlatform.userDataDir, this.filename)
  }

  /** Seal an arbitrary JSON-serializable secret payload (a password hash record, a TOTP secret +
   *  its algorithm/digits/period) into the base64 string a `SealedEntry.secretEnc` carries. */
  seal(payload: unknown): string {
    const json = Buffer.from(JSON.stringify(payload), 'utf8')
    if (seals(this.hostPlatform)) return this.hostPlatform.sealSecret!(json).toString('base64')
    return json.toString('base64')
  }

  unseal<T>(secretEnc: string): T {
    const raw = Buffer.from(secretEnc, 'base64')
    const json = seals(this.hostPlatform) ? this.hostPlatform.unsealSecret!(raw) : raw
    return JSON.parse(json.toString('utf8')) as T
  }

  /** Every record, metadata + sealed secret. A missing file is an empty list, not an error — a
   *  fresh install has neither locks nor authenticator entries yet. Corrupt/unreadable input
   *  rejects and remains untouched; callers must render it as unavailable, never as an empty list. */
  load(): Promise<SealedEntry<TMeta>[]> {
    const file = this.file()
    return serializeForFile(file, async () => (await loadFile<TMeta>(file, this.maxBytes)).entries)
  }

  save(entries: SealedEntry<TMeta>[]): Promise<void> {
    const file = this.file()
    // Refuse before enqueueing so a caller cannot receive success for a document the strict load
    // path would reject on its very next read.
    try {
      assertValidEntries<TMeta>(entries)
    } catch (error) {
      // Keep the method's asynchronous contract: IPC/service callers expect a rejected Promise,
      // not a synchronous throw before they receive the operation handle.
      return Promise.reject(error)
    }
    const body: StoreFile<TMeta> = { version: 1, entries }
    // Snapshot at invocation time. A caller retaining and later mutating `entries` must not change
    // what an already-enqueued save eventually publishes.
    const data = JSON.stringify(body, null, 2)
    return serializeForFile(file, () =>
      withCrossProcessLock(file, async (lease) => {
        const current = await readAtomicFileSnapshot(file)
        await persistFile(file, data, current.revision, lease)
      })
    )
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
    return serializeForFile(file, () =>
      withCrossProcessLock(file, async (lease) => {
        const loaded = await loadFile<TMeta>(file, this.maxBytes)
        const change = await mutation(loaded.entries)
        if (change.changed) {
          assertValidEntries<TMeta>(loaded.entries)
          const body: StoreFile<TMeta> = { version: 1, entries: loaded.entries }
          await persistFile(file, JSON.stringify(body, null, 2), loaded.revision, lease)
        }
        return change.result
      })
    )
  }
}
