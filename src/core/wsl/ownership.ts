// Ownership ledger: which WSL distributions this app created, and therefore which ones it is ever
// allowed to sleep, wake, or delete.
//
// This machine (and any real user's machine) can carry WSL distributions nodeterm had nothing to
// do with, `docker-desktop` ships with Docker Desktop, and a developer routinely has their own
// `Ubuntu`/`Debian`/whatever from years before this feature existed. Enumeration may list those
// (a user benefits from seeing what already exists, and from a name-collision check that accounts
// for them), but every WRITE path, terminate, start, unregister, rename, anything that changes
// state, must refuse unless this ledger proves nodeterm created the target.
//
// This mirrors the `createdByApp` discipline the worktree feature already uses in this codebase
// (see the root CLAUDE.md "Worktrees" section): ownership is recorded durably at creation time,
// never inferred from a name, an age, or a naming convention. A distribution literally named with
// whatever prefix this app might pick is still not proof, a user can name their own distribution
// anything, including that. Unknown or unreadable ownership state refuses; it is never treated as
// permission.

import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'

/** One durable record of a distribution nodeterm itself created. */
export interface WslOwnershipRecord {
  /** WSL distribution name at creation time, exactly as passed to `wsl --install -d`. */
  name: string
  /** ISO-8601 creation timestamp, for diagnostics only, never used to decide ownership. */
  createdAt: string
}

/**
 * The ledger's read/write surface. `isOwned` and `list` fail closed: a read that could not prove
 * ownership must never be treated as ownership. `record`/`forget` are the only writers, and both
 * are used only by the create/delete flows in this package, nothing here is renderer-facing.
 */
export interface WslOwnershipStore {
  /** True only when a valid, readable ledger entry exists for this exact name (case-insensitive). */
  isOwned(name: string): Promise<boolean>
  /** Every name this store believes nodeterm created. Empty (never throws) when the ledger is
   *  absent or unreadable, callers must treat an empty list as "ownership unproven for everything",
   *  not as "nothing is owned yet" when deciding whether to allow a mutation. */
  list(): Promise<string[]>
  /** Records that nodeterm created `name`. Throws on a write failure, callers must not report a
   *  create as complete when the ownership record for it failed to persist. */
  record(name: string): Promise<void>
  /** Removes the ledger entry for `name`. Used only after a confirmed, successful unregister. */
  forget(name: string): Promise<void>
}

interface LedgerFileShapeV1 {
  version: 1
  distributions: WslOwnershipRecord[]
}

function foldName(name: string): string {
  return name.toLocaleLowerCase('en-US')
}

/**
 * Parses the ledger file's bytes. Returns `null` (never throws) for anything that is not a valid
 * v1 ledger, malformed JSON, wrong shape, or a record missing its name. A store built on top of
 * this treats `null` exactly like "file does not exist": ownership is unproven for every name, so
 * every mutation refuses. This is deliberately NOT "best-effort recovery of the valid parts" ,
 * recovering half a corrupt ledger could quietly un-own a real record.
 */
function parseLedger(raw: string): LedgerFileShapeV1 | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1 ||
    !Array.isArray((parsed as { distributions?: unknown }).distributions)
  ) {
    return null
  }
  const distributions: WslOwnershipRecord[] = []
  for (const entry of (parsed as { distributions: unknown[] }).distributions) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as { name?: unknown }).name !== 'string' ||
      (entry as { name: string }).name.length === 0 ||
      typeof (entry as { createdAt?: unknown }).createdAt !== 'string'
    ) {
      return null
    }
    distributions.push({
      name: (entry as { name: string }).name,
      createdAt: (entry as { createdAt: string }).createdAt
    })
  }
  return { version: 1, distributions }
}

async function writeAtomic(filePath: string, contents: string): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`)
  await fs.writeFile(tempPath, contents, 'utf8')
  await fs.rename(tempPath, filePath)
}

/**
 * File-backed ledger. `filePath` is caller-supplied on purpose: this package has no opinion about
 * where application data lives (that is a shell/Electron concern), so a production caller passes
 * something like `<userData>/wsl-owned-distributions.json` and a test passes a throwaway temp path.
 *
 * Every read/write is serialized behind one in-process queue so two concurrent calls (e.g. a
 * `create` racing a `delete`) cannot interleave a read-modify-write and drop one of them. This is
 * process-local only, it does not protect against two separate processes sharing the same file,
 * which is out of scope for this package (the shell that boots it owns that guarantee, exactly as
 * `core/fs-transaction-lock.ts` does for other cross-process stores elsewhere in this app).
 */
export function fileWslOwnershipStore(filePath: string): WslOwnershipStore {
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task, task)
    queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  const readLedger = async (): Promise<LedgerFileShapeV1 | null> => {
    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf8')
    } catch (error) {
      // ENOENT means "no distribution has ever been created", a real empty ledger. Anything else
      // (EACCES, EIO, a directory in its place) is an unreadable ledger and must not be conflated
      // with an empty one: the caller cannot tell "nothing is owned" from "we cannot tell", and the
      // whole point of this store is that the second case refuses exactly like the first.
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return { version: 1, distributions: [] }
      }
      return null
    }
    return parseLedger(raw)
  }

  return {
    isOwned: (name) =>
      enqueue(async () => {
        const ledger = await readLedger()
        if (!ledger) return false
        const folded = foldName(name)
        return ledger.distributions.some((record) => foldName(record.name) === folded)
      }),

    list: () =>
      enqueue(async () => {
        const ledger = await readLedger()
        return ledger ? ledger.distributions.map((record) => record.name) : []
      }),

    record: (name) =>
      enqueue(async () => {
        const ledger = (await readLedger()) ?? { version: 1, distributions: [] }
        const folded = foldName(name)
        const distributions = ledger.distributions.filter((record) => foldName(record.name) !== folded)
        distributions.push({ name, createdAt: new Date().toISOString() })
        await writeAtomic(filePath, JSON.stringify({ version: 1, distributions }, null, 2))
      }),

    forget: (name) =>
      enqueue(async () => {
        const ledger = await readLedger()
        if (!ledger) {
          // The ledger is missing or corrupt. There is nothing safe to rewrite it to, writing an
          // empty ledger over a corrupt-but-possibly-recoverable file would permanently un-own
          // every real record it held. Forgetting one name is not urgent enough to risk that; the
          // corrupt file is left exactly as it is for a human to look at.
          return
        }
        const folded = foldName(name)
        const distributions = ledger.distributions.filter((record) => foldName(record.name) !== folded)
        await writeAtomic(filePath, JSON.stringify({ version: 1, distributions }, null, 2))
      })
  }
}

/** An in-memory store for tests that don't need to exercise the file-backed implementation. */
export function inMemoryWslOwnershipStore(initiallyOwned: readonly string[] = []): WslOwnershipStore {
  const owned = new Set(initiallyOwned.map(foldName))
  const originalCasing = new Map(initiallyOwned.map((name) => [foldName(name), name]))
  return {
    isOwned: async (name) => owned.has(foldName(name)),
    list: async () => [...owned].map((folded) => originalCasing.get(folded) ?? folded),
    record: async (name) => {
      owned.add(foldName(name))
      originalCasing.set(foldName(name), name)
    },
    forget: async (name) => {
      owned.delete(foldName(name))
      originalCasing.delete(foldName(name))
    }
  }
}
