import fs from 'fs'
import path from 'path'
import { renameAtomic, tempNameFor, writeFileAtomic } from './fs-atomic'
import { loadNodeSqlite } from './node-runtime'

/**
 * Cross-process publication metadata for agent-status.json.
 *
 * The counter is deliberately separate from the mirror document. A process reserves its number
 * before taking a snapshot, then releases the lock while it writes that snapshot's unique temp.
 * A newer process can therefore reserve and publish instead of waiting behind a stalled older
 * temp; the older process is fenced out when it returns for the compare-and-publish step.
 */
interface GenerationFile {
  v: 1
  generation: number
}

export type MirrorPublicationResult = 'published' | 'superseded'

/**
 * A normal critical section is a tiny counter write or one bounded renameAtomic call. Waiting has
 * a finite budget because this mirror is best-effort; importantly, expiry only abandons this
 * attempt. It never steals a lock from a live process. SQLite's OS-backed transaction lock is
 * released by the kernel when an owning process crashes, so recovery needs no unsafe stale lease.
 */
const LOCK_RETRY_DELAYS_MS = [
  25, 35, 50, 75, 100, 125, 150, 175, 200, 225,
  250, 250, 250, 250, 250, 250, 250, 250, 250, 250,
  250, 250, 250, 250, 250, 250, 250, 250
]

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function canonicalLockTarget(file: string): Promise<string> {
  try {
    // Once the mirror exists, resolving the file also collapses a file-level symlink.
    return await fs.promises.realpath(file)
  } catch (error) {
    if (codeOf(error) !== 'ENOENT') throw error
    // The first flush has no target to realpath. Resolve its parent instead so two processes that
    // spell the same data directory through different symlink aliases still contend on one lock.
    const parent = await fs.promises.realpath(path.dirname(file))
    return path.join(parent, path.basename(file))
  }
}

function generationFileFor(file: string): string {
  return `${file}.generation`
}

function publicationDatabaseFor(file: string): string {
  return `${file}.publication.sqlite3`
}

function codeOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''
}

function sqliteErrnoOf(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'errcode' in error
    ? Number((error as { errcode?: unknown }).errcode)
    : undefined
}

function checkedGeneration(value: unknown, source: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Invalid mirror publication generation in ${source}`)
  }
  return value as number
}

async function readJsonFile(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8')) as unknown
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return undefined
    throw error
  }
}

async function readCounterGeneration(file: string): Promise<number> {
  const raw = await readJsonFile(generationFileFor(file))
  if (raw === undefined) return 0
  if (!raw || typeof raw !== 'object' || (raw as Partial<GenerationFile>).v !== 1) {
    throw new Error(`Invalid mirror publication counter for ${file}`)
  }
  return checkedGeneration((raw as Partial<GenerationFile>).generation, generationFileFor(file))
}

/** Read the optional generation on an existing v1 mirror. Old mirrors predate the field and are 0. */
export async function readMirrorGeneration(file: string): Promise<number> {
  const raw = await readJsonFile(file)
  if (raw === undefined) return 0
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    (raw as { v?: unknown }).v !== 1 ||
    !Number.isFinite((raw as { updatedAt?: unknown }).updatedAt) ||
    !(raw as { nodes?: unknown }).nodes ||
    typeof (raw as { nodes?: unknown }).nodes !== 'object' ||
    Array.isArray((raw as { nodes?: unknown }).nodes)
  ) {
    throw new Error(`Invalid mirror document in ${file}`)
  }
  const generation = (raw as { generation?: unknown }).generation
  return generation === undefined ? 0 : checkedGeneration(generation, file)
}

async function withPublicationLock<T>(file: string, action: () => Promise<T>): Promise<T> {
  const lockTarget = await canonicalLockTarget(file)
  const { DatabaseSync } = loadNodeSqlite()
  const database = new DatabaseSync(publicationDatabaseFor(lockTarget))
  let transactionOpen = false
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        database.exec('BEGIN IMMEDIATE')
        transactionOpen = true
        break
      } catch (error) {
        // SQLITE_BUSY (5) is the only expected contention result. Permission, corruption and
        // missing-parent failures retain the established immediate best-effort failure semantics.
        if (sqliteErrnoOf(error) !== 5 || attempt >= LOCK_RETRY_DELAYS_MS.length) throw error
        await sleep(LOCK_RETRY_DELAYS_MS[attempt])
      }
    }
    const result = await action()
    database.exec('COMMIT')
    transactionOpen = false
    return result
  } finally {
    if (transactionOpen) {
      try { database.exec('ROLLBACK') } catch { /* closing still releases the OS lock */ }
    }
    database.close()
  }
}

/**
 * Reserve the next global generation for `file` before snapshotting in-memory state.
 *
 * The counter is written atomically while the cross-process lock is held. Gaps are intentional:
 * a process may crash after reserving and another process then advances past it. Publication only
 * requires a total order, not contiguous numbers.
 */
export async function reserveMirrorGeneration(file: string): Promise<number> {
  return withPublicationLock(file, async () => {
    const [counter, published] = await Promise.all([
      readCounterGeneration(file),
      readMirrorGeneration(file)
    ])
    const current = Math.max(counter, published)
    if (current >= Number.MAX_SAFE_INTEGER) {
      throw new Error(`Mirror publication generation exhausted for ${file}`)
    }
    const generation = current + 1
    const body = `${JSON.stringify({ v: 1, generation } satisfies GenerationFile)}\n`
    await writeFileAtomic(generationFileFor(file), body, { mode: 0o600 })
    return generation
  })
}

/**
 * Publish one already-reserved generation, or discard it if a newer generation is complete.
 *
 * The unique temp is written before taking the publication lock, so slow disk work does not block
 * another process. The final generation read and retrying rename share one lock: two publishers
 * cannot both pass the comparison and then race their renames on Windows.
 */
export async function publishMirrorGeneration(
  file: string,
  generation: number,
  body: string
): Promise<MirrorPublicationResult> {
  checkedGeneration(generation, 'reserved generation')
  const bodyGeneration = checkedGeneration(
    (JSON.parse(body) as { generation?: unknown }).generation,
    'mirror body'
  )
  if (bodyGeneration !== generation) {
    throw new Error(`Mirror body generation ${bodyGeneration} does not match reservation ${generation}`)
  }
  const tmp = tempNameFor(file)
  try {
    await fs.promises.writeFile(tmp, body, { mode: 0o600 })
    return await withPublicationLock(file, async () => {
      const published = await readMirrorGeneration(file)
      if (published >= generation) return 'superseded'
      await renameAtomic(tmp, file)
      return 'published'
    })
  } finally {
    // A successful rename already moved the temp. A superseded or failed generation still owns
    // exactly this UUID path and may remove it without touching another process's work.
    await fs.promises.rm(tmp, { force: true }).catch(() => {})
  }
}
