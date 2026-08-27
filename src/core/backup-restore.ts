/**
 * Hosted-resource backup and restore runtime.
 *
 * The shared contract in `src/shared/backup-restore.ts` owns validation and review decisions.
 * This Node-side seam owns ZIP framing and atomic publication only. It does not know how to
 * deploy, start, stop, mutate, or authenticate a provider. Hosting nodes provide those actions
 * after a restore review has been accepted.
 */

import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { openContainer, packContainer } from './project-archive-container'
import { renameAtomic, tempNameFor } from './fs-atomic'
import {
  BACKUP_RESTORE_ARCHIVE_FORMAT,
  BACKUP_RESTORE_LIMITS,
  BackupRestoreError,
  createBackupRestoreManifest,
  parseBackupRestoreManifest,
  reviewBackupRestore,
  runBackupRestoreTransaction,
  serializeBackupRestoreManifest,
  validateBackupArchivePath,
  validateBackupRestoreEntries,
  validateBackupResourceDescriptor,
  type BackupRestoreCompatibility,
  type BackupRestoreEntry,
  type BackupRestoreManifest,
  type BackupRestoreOmission,
  type BackupRestoreProgress,
  type BackupRestoreResourceDescriptor,
  type BackupRestoreExecutionContext
} from '../shared/backup-restore'

export * from '../shared/backup-restore'

const ARCHIVE_READ_LIMITS = {
  maxArchiveBytes: BACKUP_RESTORE_LIMITS.maxArchiveBytes,
  maxTotalBytes: BACKUP_RESTORE_LIMITS.maxRawBytes,
  maxEntryBytes: BACKUP_RESTORE_LIMITS.maxEntryBytes,
  maxEntries: BACKUP_RESTORE_LIMITS.maxEntries
}

export interface HostedBackupArchive {
  bytes: Buffer
  manifest: BackupRestoreManifest
}

export async function createHostedBackupArchive(
  resource: BackupRestoreResourceDescriptor,
  entries: readonly BackupRestoreEntry[],
  omissions: readonly BackupRestoreOmission[] = [],
  options: Parameters<typeof createBackupRestoreManifest>[3] = {}
): Promise<HostedBackupArchive> {
  validateBackupResourceDescriptor(resource)
  const manifest = await createBackupRestoreManifest(resource, entries, omissions, options)
  if (!manifest.entries.some((entry) => entry.required)) throw new BackupRestoreError('required-entry', 'A hosted backup must contain at least one required payload entry.')
  const manifestBytes = Buffer.from(serializeBackupRestoreManifest(manifest))
  const payload = entries.map((entry) => ({ path: validateBackupArchivePath(entry.path), data: Buffer.from(entry.data) }))
  const bytes = packContainer([{ path: 'manifest.json', data: manifestBytes }, ...payload])
  if (bytes.byteLength > BACKUP_RESTORE_LIMITS.maxArchiveBytes) throw new BackupRestoreError('compressed-limit', 'Hosted backup archive exceeds its byte limit.')
  return { bytes, manifest }
}

export async function validateHostedBackupArchive(bytes: Buffer): Promise<{ manifest: BackupRestoreManifest; entries: BackupRestoreEntry[] }> {
  const container = openContainer(bytes, ARCHIVE_READ_LIMITS)
  const manifestBytes = container.get('manifest.json')
  if (!manifestBytes) throw new BackupRestoreError('required-entry', 'Hosted backup manifest is missing.')
  const manifest = parseBackupRestoreManifest(manifestBytes)
  const entries = [...container.entries()]
    .filter(([entryPath]) => entryPath !== 'manifest.json')
    .map(([entryPath, data]) => ({ path: entryPath, data, compressedBytes: data.byteLength }))
  await validateBackupRestoreEntries(manifest, entries)
  return { manifest, entries }
}

export function inspectHostedBackupArchive(bytes: Buffer): BackupRestoreManifest {
  if (bytes.byteLength > BACKUP_RESTORE_LIMITS.maxArchiveBytes) throw new BackupRestoreError('compressed-limit', 'Hosted backup archive exceeds its byte limit.')
  const container = openContainer(bytes, ARCHIVE_READ_LIMITS, (name) => name === 'manifest.json')
  const manifest = container.get('manifest.json')
  if (!manifest) throw new BackupRestoreError('required-entry', 'Hosted backup manifest is missing.')
  return parseBackupRestoreManifest(manifest)
}

function safeFilenamePart(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)) throw new BackupRestoreError('manifest', 'Backup publication identity is invalid.')
  return value
}

/** Atomic, collision-safe local publication for a validated hosted backup. */
export class HostedBackupArchiveStore {
  constructor(private readonly root: string) {}

  private filePath(resourceId: string, backupId: string): string {
    return path.join(this.root, `${safeFilenamePart(resourceId)}-${safeFilenamePart(backupId)}.${BACKUP_RESTORE_ARCHIVE_FORMAT}`)
  }

  async publish(resourceId: string, backupId: string, bytes: Buffer): Promise<string> {
    if (bytes.byteLength > BACKUP_RESTORE_LIMITS.maxArchiveBytes) throw new BackupRestoreError('compressed-limit', 'Hosted backup archive exceeds its byte limit.')
    await validateHostedBackupArchive(bytes)
    await fs.mkdir(this.root, { recursive: true })
    const destination = this.filePath(resourceId, backupId)
    try {
      await fs.lstat(destination)
      throw new BackupRestoreError('destination-collision', `A hosted backup already exists for ${backupId}.`)
    } catch (error) {
      if (error instanceof BackupRestoreError) throw error
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
    }
    const temporary = tempNameFor(destination)
    try {
      await fs.writeFile(temporary, bytes, { flag: 'wx' })
      await renameAtomic(temporary, destination)
      return destination
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async read(resourceId: string, backupId: string): Promise<Buffer> {
    const bytes = await fs.readFile(this.filePath(resourceId, backupId))
    await validateHostedBackupArchive(bytes)
    return bytes
  }

  async list(resourceId: string): Promise<BackupRestoreManifest[]> {
    const prefix = `${safeFilenamePart(resourceId)}-`
    const names = await fs.readdir(this.root).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return []
      throw error
    })
    const manifests: BackupRestoreManifest[] = []
    for (const name of names.filter((candidate) => candidate.startsWith(prefix) && candidate.endsWith(`.${BACKUP_RESTORE_ARCHIVE_FORMAT}`)).sort()) {
      // A corrupt archive is an invalid row, not an absent row. Fail closed so callers can show
      // the exact recovery action instead of silently hiding the only copy of a backup.
      manifests.push(inspectHostedBackupArchive(await fs.readFile(path.join(this.root, name))))
    }
    return manifests
  }
}

export interface HostedBackupAdapter<TStage = unknown> {
  describe(): Promise<BackupRestoreResourceDescriptor>
  capture(signal: AbortSignal, emit: (progress: Pick<BackupRestoreProgress, 'phase' | 'progress' | 'completedBytes' | 'totalBytes' | 'message'>) => void): Promise<{ entries: BackupRestoreEntry[]; omissions: BackupRestoreOmission[] }>
  prepareRestore(manifest: BackupRestoreManifest, entries: BackupRestoreEntry[], signal: AbortSignal, emit: (progress: Pick<BackupRestoreProgress, 'phase' | 'progress' | 'completedBytes' | 'totalBytes' | 'message'>) => void): Promise<TStage>
  validateRestore(stage: TStage, signal: AbortSignal): Promise<void>
  publishRestore(stage: TStage, signal: AbortSignal): Promise<void>
  rollbackRestore?(stage: TStage, signal: AbortSignal): Promise<void>
  disposeRestore?(stage: TStage): Promise<void>
}

export async function backupHostedResource(
  adapter: HostedBackupAdapter,
  store: HostedBackupArchiveStore,
  context: BackupRestoreExecutionContext = {}
): Promise<{ path: string; manifest: BackupRestoreManifest }> {
  let resource: BackupRestoreResourceDescriptor | undefined
  return runBackupRestoreTransaction<{ archive: HostedBackupArchive; resource: BackupRestoreResourceDescriptor }, { path: string; manifest: BackupRestoreManifest }>({
    operation: 'backup',
    operationId: randomUUID(),
    preflight: async () => { resource = validateBackupResourceDescriptor(await adapter.describe()) },
    stage: async (signal, emit) => {
      if (!resource) throw new BackupRestoreError('resource-mismatch', 'The backup resource was not verified before capture.')
      const captured = await adapter.capture(signal, (progress) => emit(progress.phase, progress.progress, progress.message, progress.completedBytes, progress.totalBytes))
      emit('staging', 0.55, 'Building the validated backup archive before publication.', 0, captured.entries.reduce((sum, entry) => sum + entry.data.byteLength, 0))
      return { archive: await createHostedBackupArchive(resource, captured.entries, captured.omissions), resource }
    },
    validate: async ({ archive }) => { await validateHostedBackupArchive(archive.bytes) },
    publish: async ({ archive, resource }) => ({ path: await store.publish(resource.resourceId, archive.manifest.backupId, archive.bytes), manifest: archive.manifest })
  }, context)
}

export interface HostedRestoreOptions {
  target: BackupRestoreResourceDescriptor
  allowEditionUpgrade?: boolean
  allowVersionDowngrade?: boolean
  adoptExternal?: boolean
}

export interface HostedRestoreReview {
  manifest: BackupRestoreManifest
  target: BackupRestoreResourceDescriptor
  compatibility: BackupRestoreCompatibility
  accepted: boolean
}

export function acceptHostedRestoreReview(review: HostedRestoreReview): HostedRestoreReview {
  if (!review.compatibility.allowed) throw new BackupRestoreError('resource-mismatch', 'A restore with unresolved compatibility facts cannot be accepted.')
  return { ...review, accepted: true }
}

/** Review is a pure pre-publication step; callers must present this result before restore. */
export async function reviewHostedRestore(bytes: Buffer, options: HostedRestoreOptions): Promise<HostedRestoreReview> {
  const { manifest } = await validateHostedBackupArchive(bytes)
  const target = validateBackupResourceDescriptor(options.target)
  const compatibility = reviewBackupRestore(manifest, target, options)
  return { manifest, target, compatibility, accepted: false }
}

export async function restoreHostedBackup<TStage>(
  bytes: Buffer,
  adapter: HostedBackupAdapter<TStage>,
  review: HostedRestoreReview,
  context: BackupRestoreExecutionContext = {}
): Promise<void> {
  const parsed = await validateHostedBackupArchive(bytes)
  if (parsed.manifest.backupId !== review.manifest.backupId) throw new BackupRestoreError('manifest', 'Restore review does not match the selected archive.')
  if (!review.compatibility.allowed || !review.accepted) throw new BackupRestoreError('resource-mismatch', 'Restore review has not been accepted or contains unresolved compatibility facts.')
  await runBackupRestoreTransaction<TStage, void>({
    operation: 'restore',
    operationId: randomUUID(),
    preflight: async () => {
      const current = validateBackupResourceDescriptor(await adapter.describe())
      const target = review.target
      if (current.resourceId !== target.resourceId || current.kind !== target.kind || current.edition !== target.edition ||
          current.version.version !== target.version.version || current.ownerId !== target.ownerId ||
          review.compatibility.ownership === 'external' || review.compatibility.ownership === 'unknown') {
        throw new BackupRestoreError('resource-mismatch', 'The destination resource changed or its ownership is no longer verified since restore review.')
      }
    },
    stage: (signal, emit) => adapter.prepareRestore(parsed.manifest, parsed.entries, signal, (progress) => emit(progress.phase, progress.progress, progress.message, progress.completedBytes, progress.totalBytes)).then((stage) => {
      emit('staging', 0.45, 'Preparing the reviewed restore without publishing it.', 0, parsed.manifest.totals.rawBytes)
      return stage
    }),
    validate: (stage, signal) => adapter.validateRestore(stage, signal),
    publish: (stage, signal) => adapter.publishRestore(stage, signal),
    rollback: adapter.rollbackRestore,
    dispose: adapter.disposeRestore
  }, context)
}
