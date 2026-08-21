import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBackup, deleteBackup, listBackups, makeBackupId, restoreBackup } from './backups'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'nt-mc-backup-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function seedWorld(text: string): void {
  const world = path.join(dir, 'world')
  mkdirSync(path.join(world, 'region'), { recursive: true })
  writeFileSync(path.join(world, 'level.dat'), text)
}

describe('makeBackupId', () => {
  it('is a fixed-shape, sortable, filesystem-safe stamp', () => {
    const id = makeBackupId(new Date('2026-03-04T05:06:07Z').getTime(), 0)
    expect(id).toMatch(/^\d{8}-\d{6}$/)
  })

  it('appends the disambiguator only when it is nonzero, so the common case stays a bare stamp', () => {
    const now = new Date('2026-03-04T05:06:07Z').getTime()
    expect(makeBackupId(now, 0)).toMatch(/^\d{8}-\d{6}$/)
    expect(makeBackupId(now, 1).endsWith('-1')).toBe(true)
  })
})

describe('listBackups', () => {
  it('reports no backups yet rather than an error when the folder does not exist', async () => {
    expect(await listBackups(dir)).toEqual([])
  })

  it('skips a backup folder with no readable meta.json instead of guessing at it', async () => {
    mkdirSync(path.join(dir, 'backups', '20260101-000000'), { recursive: true })
    expect(await listBackups(dir)).toEqual([])
  })
})

describe('createBackup / listBackups', () => {
  it('refuses when the world folder does not exist yet', async () => {
    await expect(createBackup({ dir, levelName: 'world', now: 1 })).rejects.toThrow(/does not exist yet/)
  })

  it('copies the real world folder, records its size, and lists it back', async () => {
    seedWorld('hello world')
    const summary = await createBackup({ dir, levelName: 'world', now: 1_700_000_000_000 })
    expect(summary.levelName).toBe('world')
    expect(summary.auto).toBe(false)
    expect(summary.sizeBytes).toBeGreaterThan(0)

    const copied = readFileSync(path.join(dir, 'backups', summary.id, 'level.dat'), 'utf-8')
    expect(copied).toBe('hello world')

    const listed = await listBackups(dir)
    expect(listed).toEqual([summary])
  })

  it('never leaves a partially-copied backup visible to a concurrent list — the temp dir is not itself a valid id', async () => {
    seedWorld('x')
    const summary = await createBackup({ dir, levelName: 'world', now: 5 })
    const entries = await listBackups(dir)
    expect(entries.map((e) => e.id)).toEqual([summary.id])
  })

  it('disambiguates two backups requested at the exact same instant instead of colliding', async () => {
    seedWorld('x')
    const a = await createBackup({ dir, levelName: 'world', now: 42 })
    const b = await createBackup({ dir, levelName: 'world', now: 42 })
    expect(a.id).not.toBe(b.id)
    expect(await listBackups(dir)).toHaveLength(2)
  })

  it('sorts newest first', async () => {
    seedWorld('x')
    const older = await createBackup({ dir, levelName: 'world', now: 100 })
    const newer = await createBackup({ dir, levelName: 'world', now: 200 })
    expect((await listBackups(dir)).map((b) => b.id)).toEqual([newer.id, older.id])
  })
})

describe('restoreBackup', () => {
  it('refuses an unknown backup id', async () => {
    seedWorld('x')
    await expect(restoreBackup(dir, 'world', 'no-such-backup', 1)).rejects.toThrow(/no longer exists/)
  })

  it('refuses a backup id shaped like a path escape', async () => {
    await expect(restoreBackup(dir, 'world', '../../etc', 1)).rejects.toThrow(/not a valid backup id/)
  })

  it('replaces the current world with the chosen backup, and preserves the old one as an automatic backup first', async () => {
    seedWorld('version-1')
    const first = await createBackup({ dir, levelName: 'world', now: 1 })
    seedWorld('version-2') // the "live" world has since changed

    await restoreBackup(dir, 'world', first.id, 2)

    // The world folder now holds what the backup contained.
    expect(readFileSync(path.join(dir, 'world', 'level.dat'), 'utf-8')).toBe('version-1')
    // No stray meta.json leaked into the live world folder.
    expect(() => readFileSync(path.join(dir, 'world', 'meta.json'), 'utf-8')).toThrow()

    // The overwritten "version-2" world was preserved automatically, not deleted outright.
    const all = await listBackups(dir)
    const auto = all.find((b) => b.auto)
    expect(auto).toBeTruthy()
    expect(readFileSync(path.join(dir, 'backups', auto!.id, 'level.dat'), 'utf-8')).toBe('version-2')
  })

  it('restores cleanly even when there is no current world to preserve', async () => {
    seedWorld('only-version')
    const only = await createBackup({ dir, levelName: 'world', now: 1 })
    rmSync(path.join(dir, 'world'), { recursive: true, force: true })

    await restoreBackup(dir, 'world', only.id, 2)
    expect(readFileSync(path.join(dir, 'world', 'level.dat'), 'utf-8')).toBe('only-version')
  })
})

describe('deleteBackup', () => {
  it('refuses a malformed id without touching the filesystem', async () => {
    await expect(deleteBackup(dir, '../world')).rejects.toThrow(/not a valid backup id/)
  })

  it('permanently removes exactly the named backup and nothing else', async () => {
    seedWorld('x')
    const a = await createBackup({ dir, levelName: 'world', now: 1 })
    const b = await createBackup({ dir, levelName: 'world', now: 2 })

    await deleteBackup(dir, a.id)

    const remaining = await listBackups(dir)
    expect(remaining.map((e) => e.id)).toEqual([b.id])
  })
})
