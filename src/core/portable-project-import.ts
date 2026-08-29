/** Atomic schema 3 archive writer/reader and destination staging.
 *
 * This seam intentionally stops at local staging. It never calls a provider, starts a process,
 * deploys a service, downloads an asset, or writes local binding state. Those actions belong to the
 * explicit binding wizard in portable-bindings.ts and are only reachable after import completes.
 */

import { promises as fs } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Project } from '../shared/types'
import { freshProjectId } from '../shared/project-id'
import { fileToProject, projectToFile, serializeProjectFile, type ProjectFileV1 } from './workspace-files'
import {
  createPortableProjectV3Manifest,
  migratePortableProject,
  parsePortableProjectV3Manifest,
  PORTABLE_PROJECT_LIMITS,
  PortableProjectV3Error,
  validatePortableArchiveInventory,
  validatePortableArchivePath,
  validatePortableProjectV3Entries,
  type PortableProjectV3Entry,
  type PortableProjectV3Manifest,
  type PortableProjectOmission
} from './portable-project-v3'
import {
  parsePortableCanvasProjectionV3,
  portableCanvasProjectionToProject,
  projectToPortableCanvasV3,
  serializePortableCanvasProjectionV3,
  type PortableCanvasProjectionV3
} from './portable-canvas-projection'
import {
  createPortableMediaManifest,
  inspectPortableMedia,
  sha256Media,
  type PortableMediaCollected,
  type PortableMediaOmission
} from './portable-media-assets'
import { openContainer, packContainer } from './project-archive-container'
import { renameAtomic } from './fs-atomic'
import { LocalHistoryStore } from './local-history'
import { parsePortableBoardLog } from './board-log'

const READ_LIMITS = {
  maxArchiveBytes: PORTABLE_PROJECT_LIMITS.maxCompressedBytes,
  maxTotalBytes: PORTABLE_PROJECT_LIMITS.maxRawBytes,
  maxEntryBytes: PORTABLE_PROJECT_LIMITS.maxEntryBytes,
  maxEntries: PORTABLE_PROJECT_LIMITS.maxEntryCount
}
export const PORTABLE_IMPORT_STAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const PORTABLE_HISTORY_BUNDLE_MAX_BYTES = 128 * 1024 * 1024

export interface PortableImportProgress {
  phase: 'reading' | 'validating' | 'migrating' | 'staging' | 'publishing' | 'completed' | 'cancelled'
  progress: number
  message: string
}

export interface PortableImportResult {
  project: Project
  manifest: PortableProjectV3Manifest
  projection: PortableCanvasProjectionV3
  archiveVersion: 3
  stagedPath?: string
  /** Bindings are always empty on import. This is a visible fact, not an omitted state. */
  bindings: []
  omissions: PortableProjectOmission[]
}

export interface PortableProjectV3ExportOptions {
  historyBundle: Buffer
  projection?: PortableCanvasProjectionV3
  omissions?: readonly PortableProjectOmission[]
  appearance?: Record<string, unknown>
  media?: {
    assets: readonly PortableMediaCollected[]
    omissions?: readonly PortableMediaOmission[]
  }
  sidecars?: readonly { path: string; data: Buffer }[]
  attachments?: readonly { path: string; data: Buffer }[]
}

export interface PortableProjectV3ImportOptions {
  /** A project root to create. It must not already exist, preventing destination collisions. */
  destination?: string
  signal?: AbortSignal
  onProgress?: (event: PortableImportProgress) => void
  /** Optional app-owned history store. Import never hydrates process, provider, or binding state. */
  history?: LocalHistoryStore
}

/** Remove only our own old staging siblings. A journal makes the ownership and resume policy
 * explicit, and the age grace avoids touching a live import after a transient restart. */
export async function sweepPortableImportStages(parent: string, now = Date.now()): Promise<number> {
  let removed = 0
  for (const entry of await fs.readdir(parent, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[])) {
    if (!entry.isDirectory() || !entry.name.startsWith('.nodeterm-import-') || !entry.name.endsWith('.tmp')) continue
    const stage = path.join(parent, entry.name)
    try {
      const journal = JSON.parse((await fs.readFile(path.join(stage, 'import.journal.json'), 'utf8')))
      if (journal?.format !== 'nodeterm-import-journal-v1' || typeof journal.createdAt !== 'number' ||
          now - journal.createdAt < PORTABLE_IMPORT_STAGE_MAX_AGE_MS) continue
      await fs.rm(stage, { recursive: true, force: true })
      removed++
    } catch {
      // Unknown or unreadable staging is retained. A failed read never proves stale ownership.
    }
  }
  return removed
}

async function assertNoSymlinkAncestors(target: string): Promise<void> {
  const resolved = path.resolve(target)
  const parsed = path.parse(resolved)
  let current = parsed.root
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    try {
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink()) throw new PortableProjectV3Error('destination-collision', `Destination path contains a symlink or reparse point: ${current}`)
    } catch (error) {
      if (error instanceof PortableProjectV3Error) throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
  }
}

function emit(options: PortableProjectV3ImportOptions, phase: PortableImportProgress['phase'], progress: number, message: string): void {
  options.onProgress?.({ phase, progress, message })
}

function cancelled(options: PortableProjectV3ImportOptions): boolean {
  return options.signal?.aborted === true
}

function ensureNotCancelled(options: PortableProjectV3ImportOptions): void {
  if (cancelled(options)) {
    emit(options, 'cancelled', 0, 'Project import was cancelled before publication; the existing destination is unchanged.')
    throw new PortableProjectV3Error('cancelled', 'Project import was cancelled before publication.')
  }
}

/** Build a schema 3 container. The manifest hashes every payload entry, including history. */
export async function exportPortableProjectV3(project: Project, options: PortableProjectV3ExportOptions): Promise<{ bytes: Buffer; manifest: PortableProjectV3Manifest; projection: PortableCanvasProjectionV3 }> {
  if (options.historyBundle.byteLength === 0 || options.historyBundle.byteLength > PORTABLE_HISTORY_BUNDLE_MAX_BYTES) {
    throw new PortableProjectV3Error('raw-limit', 'Portable history bundle is empty or exceeds 128 MB.')
  }
  const mediaManifest = options.media
    ? createPortableMediaManifest(options.media.assets.map((item) => item.asset), options.media.omissions)
    : undefined
  const mediaOmissions: PortableProjectOmission[] = (options.media?.omissions ?? []).map((omission) => ({
    path: `assets/media/${omission.assetId}`,
    reason: omission.decision === 'locate-later' ? 'machine-local' : 'unsupported',
    detail: omission.detail
  }))
  const projection = options.projection ?? projectToPortableCanvasV3(project, { ...(options.appearance ? { appearance: options.appearance } : {}), ...(mediaManifest ? { media: mediaManifest } : {}) })
  const projectBytes = Buffer.from(serializePortableCanvasProjectionV3(projection))
  const entries: PortableProjectV3Entry[] = [
    { path: 'project.json', data: projectBytes, required: true },
    { path: 'history.bundle', data: options.historyBundle, required: true }
  ]
  if (options.media) {
    for (const item of options.media.assets) {
      let data = item.data
      if (!data && item.source) {
        const chunks: Buffer[] = []
        let total = 0
        for await (const chunk of item.source.open()) {
          const part = Buffer.from(chunk as Uint8Array)
          total += part.length
          if (total > item.asset.bytes || total > 512 * 1024 * 1024) throw new PortableProjectV3Error('raw-limit', `Included media exceeded its declared byte bound: ${item.sourceName}`)
          chunks.push(part)
        }
        data = Buffer.concat(chunks)
      }
      if (!data) throw new PortableProjectV3Error('manifest', `Included media has no bytes: ${item.asset.id}`)
      const inspected = inspectPortableMedia(data, item.sourceName)
      if (sha256Media(data) !== item.asset.sha256 || data.byteLength !== item.asset.bytes ||
          inspected.kind !== item.asset.kind || inspected.mime !== item.asset.mime || inspected.extension !== item.asset.extension) {
        throw new PortableProjectV3Error('hash', `Included media failed its final byte and metadata check: ${item.sourceName}`)
      }
      entries.push({ path: `assets/media/${item.asset.sha256}.${item.asset.extension}`, data: Buffer.from(data), required: false })
    }
  }
  for (const sidecar of options.sidecars ?? []) {
    if (!sidecar.path.startsWith('sidecars/') || sidecar.path.endsWith('/')) {
      throw new PortableProjectV3Error('unsafe-path', `Unsupported portable sidecar path: ${sidecar.path}`)
    }
    validatePortableArchivePath(sidecar.path)
    if (sidecar.data.byteLength > 32 * 1024 * 1024) throw new PortableProjectV3Error('raw-limit', `Portable sidecar exceeds 32 MB: ${sidecar.path}`)
    if (sidecar.path === 'sidecars/.nodeterm/board-log.jsonl') parsePortableBoardLog(sidecar.data.toString('utf8'))
    entries.push({ path: sidecar.path, data: Buffer.from(sidecar.data), required: false })
  }
  for (const attachment of options.attachments ?? []) {
    if (!attachment.path.startsWith('attachments/') || attachment.path.endsWith('/')) throw new PortableProjectV3Error('unsafe-path', 'Unsupported portable attachment path.')
    validatePortableArchivePath(attachment.path)
    if (attachment.data.byteLength > 4 * 1024 * 1024) throw new PortableProjectV3Error('raw-limit', 'Portable attachment exceeds 4 MB.')
    entries.push({ path: attachment.path, data: Buffer.from(attachment.data), required: false })
  }
  // Compressed size is central-directory truth, not a guess based on raw bytes. Mirror the
  // container writer's STORE-vs-DEFLATE choice before serializing the manifest.
  const metadataEntries = entries.map((entry) => ({
    ...entry,
    compressedBytes: Math.min(entry.data.byteLength, deflateRawSync(entry.data).byteLength)
  }))
  const manifest = await createPortableProjectV3Manifest(
    { name: projection.project.name, color: projection.project.color },
    metadataEntries,
    [...(options.omissions ?? []), ...mediaOmissions]
  )
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  if (manifestBytes.length > PORTABLE_PROJECT_LIMITS.maxManifestBytes) throw new PortableProjectV3Error('manifest', 'Portable project manifest exceeds its byte limit.')
  const bytes = packContainer([
    { path: 'manifest.json', data: manifestBytes },
    { path: 'project.json', data: projectBytes },
    { path: 'history.bundle', data: options.historyBundle },
    ...entries.slice(2).map((entry) => ({ path: entry.path, data: Buffer.from(entry.data) }))
  ])
  if (bytes.length > PORTABLE_PROJECT_LIMITS.maxCompressedBytes) throw new PortableProjectV3Error('compressed-limit', 'Portable project archive exceeds its compressed-byte limit.')
  return { bytes, manifest, projection }
}

function parseLegacyProject(value: unknown, version: 1 | 2): PortableCanvasProjectionV3 {
  const migrated = migratePortableProject(version, value)
  if (typeof migrated.name !== 'string' || !Array.isArray(migrated.nodes)) throw new PortableProjectV3Error('manifest', 'Legacy project data cannot be migrated.')
  const project = fileToProject(migrated as unknown as ProjectFileV1, { id: freshProjectId() })
  return projectToPortableCanvasV3(project)
}

async function stageProjection(destination: string, project: Project, projectBytes: Buffer, manifestBytes: Buffer, portableEntries: readonly [string, Buffer][], options: PortableProjectV3ImportOptions): Promise<string> {
  const finalPath = path.resolve(destination)
  await assertNoSymlinkAncestors(finalPath)
  const parent = path.dirname(finalPath)
  const parentStat = await fs.lstat(parent).catch(() => null)
  if (!parentStat?.isDirectory()) throw new PortableProjectV3Error('destination-collision', `Destination parent is unavailable: ${parent}`)
  await sweepPortableImportStages(parent)
  try {
    await fs.lstat(finalPath)
    throw new PortableProjectV3Error('destination-collision', `Destination collision: ${finalPath} already exists.`)
  } catch (error) {
    if (error instanceof PortableProjectV3Error) throw error
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
  }
  const stage = path.join(parent, `.nodeterm-import-${randomUUID()}.tmp`)
  try {
    await fs.mkdir(stage, { recursive: false })
    await fs.writeFile(path.join(stage, 'import.journal.json'), JSON.stringify({
      format: 'nodeterm-import-journal-v1',
      createdAt: Date.now(),
      destination: path.basename(finalPath),
      state: 'staging'
    }) + '\n', { flag: 'wx' })
    await fs.mkdir(path.join(stage, '.nodeterm'), { recursive: true })
    // Keep the portable source beside the classic runtime file. WorkspaceStore can then reopen
    // the imported folder on the next launch without treating the schema 3 projection as corrupt,
    // while the original schema 3 bytes remain available for a later universe-aware reader.
    const runtimeProjection = projectToFile(project, 0, new Date().toISOString())
    runtimeProjection.viewport = project.viewport
    const runtimeFile = serializeProjectFile(runtimeProjection)
    await fs.writeFile(path.join(stage, '.nodeterm', 'project.json'), runtimeFile, { flag: 'wx' })
    await fs.writeFile(path.join(stage, '.nodeterm', 'portable-project.json'), projectBytes, { flag: 'wx' })
    await fs.writeFile(path.join(stage, '.nodeterm', 'portable-manifest.json'), manifestBytes, { flag: 'wx' })
    if (portableEntries.length > 0) {
      for (const [entryPath, data] of portableEntries) {
        const relative = entryPath.startsWith('assets/media/')
          ? path.join('assets', 'media', entryPath.slice('assets/media/'.length))
          : entryPath === 'sidecars/.nodeterm/board-log.jsonl'
            ? 'board-log.jsonl'
            : entryPath.startsWith('attachments/')
              ? path.join('board-attachments', entryPath.slice('attachments/'.length))
              : path.join('portable', entryPath.replace(/^sidecars\//, ''))
        const target = path.join(stage, '.nodeterm', relative)
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, data, { flag: 'wx' })
      }
      await fs.writeFile(path.join(stage, '.nodeterm', 'portable-media-cache.json'), JSON.stringify(
        portableEntries.filter(([entryPath]) => entryPath.startsWith('assets/media/')).map(([entryPath, data]) => ({ path: entryPath.slice('assets/media/'.length), bytes: data.byteLength, sha256: sha256Media(data) })).sort((a, b) => a.path.localeCompare(b.path)),
        null,
        2
      ) + '\n', { flag: 'wx' })
    }
    ensureNotCancelled(options)
    await fs.writeFile(path.join(stage, 'import.journal.json'), JSON.stringify({
      format: 'nodeterm-import-journal-v1',
      createdAt: Date.now(),
      destination: path.basename(finalPath),
      state: 'ready-to-publish'
    }) + '\n')
    emit(options, 'publishing', 0.95, 'Publishing the staged project atomically.')
    await renameAtomic(stage, finalPath)
    // The journal crosses the atomic publication boundary. A restart can identify a published
    // import and remove only this completed journal; failure to remove it never rolls back a
    // destination that is already atomically visible.
    await fs.rm(path.join(finalPath, 'import.journal.json'), { force: true }).catch(() => {})
    return finalPath
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

/** Read, hash-check, migrate, validate and optionally stage a schema 3 project atomically. */
export async function importPortableProjectV3(bytes: Buffer, options: PortableProjectV3ImportOptions = {}): Promise<PortableImportResult> {
  emit(options, 'reading', 0.05, 'Reading the complete project archive.')
  ensureNotCancelled(options)
  const metadata = new Map<string, { compressedBytes: number; rawBytes: number; method: number }>()
  const entries = openContainer(bytes, READ_LIMITS, undefined, metadata)
  validatePortableArchiveInventory([...entries.keys()])
  emit(options, 'validating', 0.2, 'Validating archive paths, entry sizes, and hashes before writing anything.')
  const manifestBytes = entries.get('manifest.json')
  if (!manifestBytes) throw new PortableProjectV3Error('required-entry', 'Portable project manifest is missing.')
  const manifest = parsePortableProjectV3Manifest(manifestBytes)
  const payloadEntries: PortableProjectV3Entry[] = [...entries.entries()]
    .filter(([entryPath]) => entryPath !== 'manifest.json')
    .map(([entryPath, data]) => ({ path: entryPath, data, compressedBytes: metadata.get(entryPath)?.compressedBytes ?? data.byteLength }))
  await validatePortableProjectV3Entries(manifest, payloadEntries)
  const boardLog = entries.get('sidecars/.nodeterm/board-log.jsonl')
  const boardEntries = boardLog ? parsePortableBoardLog(boardLog.toString('utf8')) : []
  const attachmentIds = new Set(boardEntries.flatMap((entry) => entry.attachments ?? []).map((attachment) => attachment.id))
  for (const id of attachmentIds) {
    const metadata = boardEntries.flatMap((entry) => entry.attachments ?? []).find((attachment) => attachment.id === id)!
    const body = entries.get('attachments/' + id + '.bin')
    if (!body || body.byteLength !== metadata.bytes || sha256Media(body) !== metadata.sha256) {
      throw new PortableProjectV3Error('hash', 'Portable board-log attachment body is missing or has invalid length/hash.')
    }
  }
  for (const name of entries.keys()) {
    if (name.startsWith('attachments/') && !attachmentIds.has(name.slice('attachments/'.length).replace(/\.bin$/, ''))) {
      throw new PortableProjectV3Error('unknown-optional', 'Portable archive contains an orphan attachment body.')
    }
  }
  ensureNotCancelled(options)


  const projectBytes = entries.get('project.json')
  if (!projectBytes) throw new PortableProjectV3Error('required-entry', 'Portable project snapshot is missing.')
  let projection: PortableCanvasProjectionV3
  try {
    projection = parsePortableCanvasProjectionV3(projectBytes)
  } catch (error) {
    emit(options, 'migrating', 0.4, 'Migrating the legacy project snapshot in memory.')
    let parsed: unknown
    try { parsed = JSON.parse(projectBytes.toString('utf8')) } catch { throw error }
    const version = typeof parsed === 'object' && parsed !== null && 'version' in parsed && (parsed as { version?: unknown }).version === 1 ? 1 : 2
    projection = parseLegacyProject(parsed, version)
  }
  ensureNotCancelled(options)
  const id = freshProjectId()
  const portableEntries = [...entries.entries()].filter(([entryPath]) => entryPath.startsWith('assets/media/') || entryPath.startsWith('sidecars/') || entryPath.startsWith('attachments/'))
  const mediaEntries = portableEntries.filter(([entryPath]) => entryPath.startsWith('assets/media/'))
  if (mediaEntries.length > 0 && !projection.media) {
    throw new PortableProjectV3Error('unknown-optional', 'Portable archive contains media entries without a media manifest.')
  }
  if (projection.media) {
    const mediaPaths = new Set<string>()
    for (const asset of projection.media.assets) {
      const mediaPath = `assets/media/${asset.sha256}.${asset.extension}`
      const media = entries.get(mediaPath)
      if (!media || media.byteLength !== asset.bytes || sha256Media(media) !== asset.sha256) {
        throw new PortableProjectV3Error('hash', `Portable media bytes do not match the media manifest: ${asset.label ?? asset.sha256}`)
      }
      const inspected = inspectPortableMedia(media, asset.label ?? 'media')
      if (inspected.kind !== asset.kind || inspected.mime !== asset.mime || inspected.extension !== asset.extension) {
        throw new PortableProjectV3Error('manifest', `Portable media metadata does not match its bytes: ${asset.label ?? asset.sha256}`)
      }
      mediaPaths.add(mediaPath)
    }
    for (const name of entries.keys()) {
      if (name.startsWith('assets/media/') && !mediaPaths.has(name)) {
        throw new PortableProjectV3Error('unknown-optional', `Portable media entry is not listed in the media manifest: ${name}`)
      }
    }
    const byId = new Map(projection.media.assets.map((asset) => [asset.id, asset]))
    projection = {
      ...projection,
      nodes: projection.nodes.map((node) => ({
        ...node,
        ...(node.media ? {
          media: node.media.map((reference) => {
            const asset = byId.get(reference.assetId)
            return asset ? { ...reference, sha256: asset.sha256, bytes: asset.bytes, extension: asset.extension, source: 'archive' as const, resolution: 'available' as const } : reference
          })
        } : {})
      }))
    }
  }
  const project = portableCanvasProjectionToProject(projection, { id })
  let stagedPath: string | undefined
  const historyDomain = options.history ? `project_${id}` : undefined
  try {
    if (options.history) {
      await options.history.importBundle(historyDomain!, entries.get('history.bundle')!)
      const head = await options.history.readHeadFile(historyDomain!, 'project.json')
      if (!head || head.trimEnd() !== Buffer.from(serializePortableCanvasProjectionV3(projection)).toString('utf8').trimEnd()) {
        throw new PortableProjectV3Error('hash', 'The project snapshot does not match the imported history tip.')
      }
    }
    if (options.destination) {
    emit(options, 'staging', 0.7, 'Preparing a collision-free local destination; no bindings or external services are touched.')
      stagedPath = await stageProjection(options.destination, project, Buffer.from(serializePortableCanvasProjectionV3(projection)), manifestBytes, portableEntries, options)
    }
    emit(options, 'completed', 1, 'Project import completed with local bindings left unconfigured.')
    return { project: stagedPath ? { ...project, cwd: stagedPath } : project, manifest, projection, archiveVersion: 3, bindings: [], omissions: manifest.omissions, ...(stagedPath ? { stagedPath } : {}) }
  } catch (error) {
    if (options.history && historyDomain) await fs.rm(options.history.domainPath(historyDomain), { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

/** Marker used by archive callers without exposing container internals. */
export function looksLikePortableProjectV3(bytes: Buffer): boolean {
  if (bytes.length < 4) return false
  try { return openContainer(bytes, READ_LIMITS).has('manifest.json') } catch { return false }
}
