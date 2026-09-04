// Kernel-backed cross-process transactions for credential stores.
//
// Atomic rename protects one document's bytes, but it cannot protect a complete
// read -> mutate -> save transaction: two app/server processes can read the same generation and
// publish incompatible successors. A timestamp lease is not a lock either — a suspended writer
// can wake after its lease was stolen and issue the final rename or unlink.
//
// SQLite's `BEGIN IMMEDIATE` is the portable primitive we need. SQLite holds an OS file lock until
// COMMIT/ROLLBACK or process death. A suspended process therefore keeps ownership, a crash releases
// it automatically, and no process ever guesses that a foreign PID or old timestamp means dead.
// The sidecar contains no credentials; it is only the lock rendezvous for one canonical physical
// resource. Node/Electron's runtime floor is enforced separately because `node:sqlite` is the
// dependency that makes this guarantee true on Windows and Linux.

import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import { performance } from 'perf_hooks'
import { renameAtomic, tempNameFor } from './fs-atomic'

const DEFAULT_POLL_MS = 25
const DEFAULT_WAIT_TIMEOUT_MS = 30_000

type DatabaseSync = import('node:sqlite').DatabaseSync
type DatabaseSyncConstructor = typeof import('node:sqlite').DatabaseSync

let databaseConstructor: Promise<DatabaseSyncConstructor> | undefined

async function loadDatabaseConstructor(): Promise<DatabaseSyncConstructor> {
  databaseConstructor ??= import('node:sqlite')
    .then((sqlite) => sqlite.DatabaseSync)
    .catch((cause) => {
      databaseConstructor = undefined
      throw new CrossProcessLockRuntimeError(cause)
    })
  return databaseConstructor
}

export interface CrossProcessLockOptions {
  pollMs?: number
  waitTimeoutMs?: number
}

export interface CrossProcessLease {
  /** Prove the kernel-held transaction is still usable immediately before publication/removal. */
  fence(): Promise<void>
}

export class CrossProcessLockRuntimeError extends Error {
  readonly code = 'lock-runtime-unavailable' as const

  constructor(cause: unknown) {
    super('This runtime cannot provide the required cross-process credential transaction.', {
      cause
    })
  }
}

export class CrossProcessLockEvidenceError extends Error {
  readonly code = 'lock-evidence-unreadable' as const

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options)
  }
}

export class CrossProcessLeaseLostError extends Error {
  readonly code = 'lock-lease-lost' as const

  constructor() {
    super('The cross-process credential transaction is no longer active.')
  }
}

export class CrossProcessLockTimeoutError extends Error {
  readonly code = 'lock-timeout' as const

  constructor() {
    super('Timed out waiting for another process to finish the credential transaction.')
  }
}

export class AtomicFileConflictError extends Error {
  readonly code = 'atomic-revision-conflict' as const

  constructor() {
    super('The credential document changed outside its cross-process transaction; no bytes were published.')
  }
}

export interface AtomicFileSnapshot {
  exists: boolean
  data: Buffer
  /** SHA-256 over the exact canonical bytes, or the distinguished absent generation. */
  revision: string
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function codeOf(error: unknown): string {
  return typeof error === 'object' && error && 'code' in error
    ? String((error as { code: unknown }).code)
    : ''
}

function isSqliteBusy(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ERR_SQLITE_ERROR' &&
    'errcode' in error &&
    (error as { errcode?: unknown }).errcode === 5
  )
}

function checkedOptions(options: CrossProcessLockOptions): Required<CrossProcessLockOptions> {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
  if (!Number.isSafeInteger(pollMs) || pollMs < 1 || pollMs > 1_000) {
    throw new RangeError('pollMs must be an integer from 1 to 1000')
  }
  if (!Number.isSafeInteger(waitTimeoutMs) || waitTimeoutMs < pollMs || waitTimeoutMs > 300_000) {
    throw new RangeError('waitTimeoutMs must be an integer from pollMs to 300000')
  }
  return { pollMs, waitTimeoutMs }
}

function revisionFor(data: Buffer): string {
  return `sha256:${data.length}:${createHash('sha256').update(data).digest('hex')}`
}

async function readBoundedFile(target: string, maxBytes: number): Promise<Buffer> {
  const before = await fs.stat(target)
  if (!before.isFile() || before.size > maxBytes) throw new Error('Atomic file exceeds its byte limit')
  const handle = await fs.open(target, 'r')
  try {
    const chunks: Buffer[] = []
    let total = 0
    let position = 0
    for (;;) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes - total + 1))
      const result = await handle.read(chunk, 0, chunk.length, position)
      if (result.bytesRead === 0) break
      total += result.bytesRead
      if (total > maxBytes) throw new Error('Atomic file exceeds its byte limit')
      chunks.push(chunk.subarray(0, result.bytesRead))
      position += result.bytesRead
    }
    const after = await fs.stat(target)
    if (!after.isFile() || after.size !== total || after.size > maxBytes) throw new Error('Atomic file changed while it was being read')
    return Buffer.concat(chunks, total)
  } finally {
    await handle.close()
  }
}

export async function readAtomicFileSnapshot(target: string, maxBytes?: number): Promise<AtomicFileSnapshot> {
  try {
    const data = maxBytes === undefined
      ? await fs.readFile(target)
      : await readBoundedFile(target, maxBytes)
    return { exists: true, data, revision: revisionFor(data) }
  } catch (error) {
    if (codeOf(error) === 'ENOENT') {
      return { exists: false, data: Buffer.alloc(0), revision: 'absent' }
    }
    // EACCES is not absence. Callers preserve the canonical bytes and surface unavailable state.
    throw error
  }
}

export async function assertAtomicFileRevision(target: string, expected: string): Promise<void> {
  const current = await readAtomicFileSnapshot(target)
  if (current.revision !== expected) throw new AtomicFileConflictError()
}

/**
 * Publish under the kernel-held transaction only if the exact bytes read by this operation remain
 * canonical. The SQLite lock orders every supported writer; the revision check additionally
 * refuses an old non-protocol build or manual edit observed before publication.
 */
export async function writeAtomicFileCompared(
  target: string,
  data: string | Buffer,
  expectedRevision: string,
  lease: CrossProcessLease,
  opts: { mode?: number; encoding?: BufferEncoding } = {}
): Promise<void> {
  const tmp = tempNameFor(target)
  try {
    await fs.writeFile(tmp, data, {
      ...(typeof data === 'string' ? { encoding: opts.encoding ?? 'utf8' } : {}),
      ...(opts.mode === undefined ? {} : { mode: opts.mode })
    })
    if (opts.mode !== undefined) await fs.chmod(tmp, opts.mode)
    await lease.fence()
    await assertAtomicFileRevision(target, expectedRevision)
    await renameAtomic(tmp, target)
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Resolve aliases at the existing physical parent while keeping the app-owned final basename. */
async function physicalResource(resource: string): Promise<string> {
  const resolved = path.resolve(resource)
  const parent = path.dirname(resolved)
  await fs.mkdir(parent, { recursive: true })
  let physicalParent: string
  try {
    physicalParent = await fs.realpath(parent)
  } catch (cause) {
    throw new CrossProcessLockEvidenceError('The transaction parent directory could not be resolved.', {
      cause
    })
  }
  let basename = path.basename(resolved).normalize('NFC')
  // Windows path identity is case-insensitive and strips trailing spaces/dots. Canonicalize the
  // lock key the same way so aliases cannot create two independent SQLite sidecars.
  if (process.platform === 'win32') basename = basename.replace(/[ .]+$/u, '').toLocaleLowerCase('en-US')
  if (!basename) throw new CrossProcessLockEvidenceError('The transaction resource name is invalid.')
  const canonical = path.join(physicalParent, basename)
  try {
    const existing = await fs.lstat(resolved)
    // Atomic rename replaces a final symlink/hard-link binding instead of updating its peer. Such
    // aliases therefore cannot safely share a revision or lock key; refuse rather than silently
    // split one credential into two files after the first publish.
    if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1) {
      throw new CrossProcessLockEvidenceError(
        'The transaction resource has an unsupported filesystem binding.'
      )
    }
  } catch (cause) {
    if (codeOf(cause) !== 'ENOENT') {
      if (cause instanceof CrossProcessLockEvidenceError) throw cause
      throw new CrossProcessLockEvidenceError('The transaction resource binding could not be inspected.', {
        cause
      })
    }
  }
  return canonical
}

function sidecarFor(resource: string): string {
  return path.join(path.dirname(resource), `.${path.basename(resource)}.transaction.sqlite3`)
}

function comparablePath(value: string): string {
  const normalized = path.resolve(value).normalize('NFC')
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

async function assertSidecarBinding(sidecar: string, allowAbsent: boolean): Promise<void> {
  try {
    const stat = await fs.lstat(sidecar)
    const physical = await fs.realpath(sidecar)
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      comparablePath(physical) !== comparablePath(sidecar)
    ) {
      throw new CrossProcessLockEvidenceError(
        'The transaction sidecar has an unsupported filesystem binding.'
      )
    }
  } catch (cause) {
    if (allowAbsent && codeOf(cause) === 'ENOENT') return
    if (cause instanceof CrossProcessLockEvidenceError) throw cause
    throw new CrossProcessLockEvidenceError('The transaction sidecar binding could not be inspected.', {
      cause
    })
  }
}

const lockTails = new Map<string, Promise<void>>()

function serializeLock<TResult>(resource: string, operation: () => Promise<TResult>): Promise<TResult> {
  const previous = lockTails.get(resource) ?? Promise.resolve()
  const result = previous.then(operation)
  const recovered = result.then(
    () => undefined,
    () => undefined
  )
  lockTails.set(resource, recovered)
  void recovered.then(() => {
    if (lockTails.get(resource) === recovered) lockTails.delete(resource)
  })
  return result
}

async function beginImmediate(
  database: DatabaseSync,
  options: Required<CrossProcessLockOptions>
): Promise<void> {
  const startedAt = performance.now()
  for (;;) {
    try {
      database.exec('BEGIN IMMEDIATE')
      return
    } catch (error) {
      if (!isSqliteBusy(error)) {
        throw new CrossProcessLockEvidenceError('The transaction sidecar could not be locked.', {
          cause: error
        })
      }
      if (performance.now() - startedAt >= options.waitTimeoutMs) {
        throw new CrossProcessLockTimeoutError()
      }
      await sleep(options.pollMs)
    }
  }
}

/**
 * Run one transaction exclusively across every supported process sharing `resource`.
 *
 * There is deliberately no stale-lock deletion path. SQLite owns crash recovery and kernel lock
 * release; corrupt or unreadable sidecars remain evidence and fail closed.
 */
export async function withCrossProcessLock<TResult>(
  resource: string,
  operation: (lease: CrossProcessLease) => Promise<TResult>,
  options: CrossProcessLockOptions = {}
): Promise<TResult> {
  const canonical = await physicalResource(resource)
  return serializeLock(canonical, async () => {
    const opts = checkedOptions(options)
    const Database = await loadDatabaseConstructor()
    const sidecar = sidecarFor(canonical)
    let database: DatabaseSync | undefined
    try {
      await assertSidecarBinding(sidecar, true)
      database = new Database(sidecar, {
        allowExtension: false,
        enableDoubleQuotedStringLiterals: false
      })
      await assertSidecarBinding(sidecar, false)
      // The sidecar carries no bearer bytes, but owner-only mode prevents another local account
      // from deliberately blocking this user's credential transactions.
      await fs.chmod(sidecar, 0o600)
      database.exec('PRAGMA busy_timeout = 0')
    } catch (cause) {
      try {
        database?.close()
      } catch {
        // The original open/permission evidence is the actionable error.
      }
      throw new CrossProcessLockEvidenceError('The transaction sidecar could not be opened safely.', {
        cause
      })
    }

    // The catch above always throws when construction did not assign a usable connection.
    const openedDatabase = database

    let active = false
    try {
      await beginImmediate(openedDatabase, opts)
      active = true
      const lease: CrossProcessLease = {
        fence: async () => {
          if (!active) throw new CrossProcessLeaseLostError()
          try {
            openedDatabase.prepare('SELECT 1').get()
          } catch (cause) {
            active = false
            throw new CrossProcessLockEvidenceError('The active credential transaction failed.', {
              cause
            })
          }
        }
      }
      const result = await operation(lease)
      openedDatabase.exec('COMMIT')
      active = false
      return result
    } catch (error) {
      if (active) {
        try {
          openedDatabase.exec('ROLLBACK')
        } catch {
          // Preserve the original operation error. Closing the connection below releases the
          // kernel lock even when explicit rollback cannot complete.
        }
        active = false
      }
      throw error
    } finally {
      try {
        openedDatabase.close()
      } catch {
        // A close failure cannot make an already-completed credential operation become undone.
        // Process teardown still releases the OS handle; callers keep the operation's real result.
      }
    }
  })
}
