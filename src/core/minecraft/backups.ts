/**
 * World backups for a managed Minecraft server instance — see docs/minecraft-server-manager.md.
 *
 * A "backup" is a real filesystem copy of the world folder (`level-name` from server.properties,
 * defaulting to vanilla's own "world"), taken as a plain recursive directory copy rather than an
 * archive — nothing in this repo's dependency graph currently writes a zip, and a directory copy
 * needs none: `fs.cp` is a stable Node builtin, and it is exactly what the user could do by hand
 * from a file manager. Vanilla itself nests the Nether (`DIM-1`) and the End (`DIM1`) inside the
 * overworld's own folder, so copying that one directory already carries all three dimensions.
 *
 * SAFETY: a backup or a restore both refuse outright while the server process is running — this
 * module does not know about the process at all, so `server-manager.ts` (the only caller) is
 * responsible for that check before it calls in here. A backup taken mid-write could capture a
 * half-flushed region file, and a restore would be replacing files the live server still has open;
 * neither failure mode is worth a "best effort while running" compromise.
 *
 * `restoreBackup` never deletes the world it is about to overwrite outright: it first copies that
 * world into its own automatic backup (marked `auto: true` so the list can say so honestly), then
 * replaces it. Choosing the wrong backup to restore is therefore always itself recoverable.
 */

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import { renameAtomic } from '../fs-atomic'
import type { MinecraftBackupSummary } from '../../shared/minecraft'

const BACKUPS_DIRNAME = 'backups'

/** Same discipline as server-manager.ts's SAFE_ID: this value becomes a directory name under the
 *  instance's own folder, so it is validated rather than trusted — never derived from anything a
 *  peer, a shared project file, or a hand-edited request body could set. */
export const SAFE_BACKUP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/

function backupsRoot(dir: string): string {
  return path.join(dir, BACKUPS_DIRNAME)
}

function backupDir(dir: string, id: string): string {
  return path.join(backupsRoot(dir), id)
}

/** Deterministic, sortable, filesystem-safe. Built from the wall clock plus a disambiguating
 *  counter — rather than only milliseconds — so two backups requested inside the same second
 *  (a manual one right after an automatic restore safety-net) never collide. */
export function makeBackupId(now: number, disambiguator: number): string {
  const d = new Date(now)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return disambiguator > 0 ? `${stamp}-${disambiguator}` : stamp
}

interface BackupMeta {
  id: string
  levelName: string
  createdAt: number
  sizeBytes: number
  /** Set only on the safety-net copy `restoreBackup` makes of the world it is about to overwrite —
   *  never by the explicit create-backup call — so the list can label it honestly. */
  auto?: boolean
}

function isBackupMeta(v: unknown): v is BackupMeta {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    typeof r.levelName === 'string' &&
    typeof r.createdAt === 'number' &&
    typeof r.sizeBytes === 'number'
  )
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function directorySize(dir: string): Promise<number> {
  let total = 0
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await directorySize(full)
    } else {
      try {
        total += (await stat(full)).size
      } catch {
        // Vanished between readdir and stat — not worth failing the whole backup over.
      }
    }
  }
  return total
}

/** Every backup this instance has, newest first. A backup folder with no readable `meta.json` was
 *  not made by this module (or was interrupted mid-write before the temp-then-rename completed) —
 *  it is skipped rather than guessed at, never reported as a corrupt or broken entry. */
export async function listBackups(dir: string): Promise<MinecraftBackupSummary[]> {
  const root = backupsRoot(dir)
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const out: MinecraftBackupSummary[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !SAFE_BACKUP_ID.test(entry.name)) continue
    try {
      const raw = await readFile(path.join(root, entry.name, 'meta.json'), 'utf-8')
      const meta: unknown = JSON.parse(raw)
      if (isBackupMeta(meta) && meta.id === entry.name) {
        out.push({
          id: meta.id,
          levelName: meta.levelName,
          createdAt: meta.createdAt,
          sizeBytes: meta.sizeBytes,
          auto: meta.auto === true
        })
      }
    } catch {
      // See doc comment above.
    }
  }
  out.sort((a, b) => b.createdAt - a.createdAt)
  return out
}

export interface CreateBackupOptions {
  dir: string
  levelName: string
  now: number
  /** Only `restoreBackup` (below) ever passes `true`. */
  auto?: boolean
}

/**
 * Copies `<dir>/<levelName>` into a fresh, uniquely-named folder under `<dir>/backups/`. The
 * source is verified present first, so a server that has never been started once (no world folder
 * yet) gets an honest refusal instead of a "successful" empty backup. Copies to a temp name and
 * renames into place at the end, so a concurrent `listBackups` can never observe a partial one.
 */
export async function createBackup(opts: CreateBackupOptions): Promise<MinecraftBackupSummary> {
  const src = path.join(opts.dir, opts.levelName)
  if (!(await pathExists(src))) {
    throw new Error(
      `The world folder "${opts.levelName}" does not exist yet — start the server at least once first.`
    )
  }
  const root = backupsRoot(opts.dir)
  await mkdir(root, { recursive: true })
  let id = makeBackupId(opts.now, 0)
  let n = 1
  while (await pathExists(backupDir(opts.dir, id))) {
    id = makeBackupId(opts.now, n++)
  }
  const finalDir = backupDir(opts.dir, id)
  const tmp = `${finalDir}.copying-${process.pid}`
  await rm(tmp, { recursive: true, force: true })
  try {
    await cp(src, tmp, { recursive: true })
    const sizeBytes = await directorySize(tmp)
    const meta: BackupMeta = { id, levelName: opts.levelName, createdAt: opts.now, sizeBytes, auto: opts.auto === true }
    await writeFile(path.join(tmp, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')
    await renameAtomic(tmp, finalDir)
    return { id, levelName: opts.levelName, createdAt: opts.now, sizeBytes, auto: opts.auto === true }
  } catch (e) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
    throw e
  }
}

/**
 * Replaces `<dir>/<levelName>` with the contents of a chosen backup. The world being overwritten
 * is preserved first as an automatic backup (see the module doc comment) rather than deleted
 * outright, so restoring the wrong one is never a one-way trip.
 */
export async function restoreBackup(
  dir: string,
  levelName: string,
  backupId: string,
  now: number
): Promise<void> {
  if (!SAFE_BACKUP_ID.test(backupId)) throw new Error('That is not a valid backup id.')
  const src = backupDir(dir, backupId)
  if (!(await pathExists(path.join(src, 'meta.json')))) {
    throw new Error('That backup no longer exists.')
  }
  const worldDir = path.join(dir, levelName)
  if (await pathExists(worldDir)) {
    await createBackup({ dir, levelName, now, auto: true })
    await rm(worldDir, { recursive: true, force: true })
  }
  const tmp = `${worldDir}.restoring-${process.pid}`
  await rm(tmp, { recursive: true, force: true })
  try {
    await cp(src, tmp, { recursive: true })
    // The backup folder's own meta.json is bookkeeping for the backups list, not part of the
    // world — never let it land inside the live world folder.
    await rm(path.join(tmp, 'meta.json'), { force: true })
    await renameAtomic(tmp, worldDir)
  } catch (e) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
    throw e
  }
}

/** Permanently deletes one backup. Real, irreversible deletion — the caller is responsible for
 *  gating this behind the destructive-action confirmation, exactly like `MinecraftApi.remove`. */
export async function deleteBackup(dir: string, backupId: string): Promise<void> {
  if (!SAFE_BACKUP_ID.test(backupId)) throw new Error('That is not a valid backup id.')
  const root = backupsRoot(dir)
  const target = backupDir(dir, backupId)
  // SAFE_BACKUP_ID already forbids traversal characters, but re-check the resolved path never
  // leaves backupsRoot before an `rm -rf` touches it — the same belt-and-braces the rest of this
  // codebase applies to every path built from a validated but externally-suppliable id.
  if (path.resolve(target) !== path.join(path.resolve(root), backupId)) {
    throw new Error('Refusing to delete outside the backups folder.')
  }
  await rm(target, { recursive: true, force: true })
}
