/** Atomic schema 3 archive writer/reader and destination staging.
 *
 * This seam intentionally stops at local staging. It never calls a provider, starts a process,
 * deploys a service, downloads an asset, or writes local binding state. Those actions belong to the
 * explicit binding wizard in portable-bindings.ts and are only reachable after import completes.
 */

import { promises as fs } from 'node:fs'
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
import { openContainer, packContainer } from './project-archive-container'
import { renameAtomic } from './fs-atomic'

const READ_LIMITS = {
  maxArchiveBytes: PORTABLE_PROJECT_LIMITS.maxCompressedBytes,
  maxTotalBytes: PORTABLE_PROJECT_LIMITS.maxRawBytes,
  maxEntryBytes: PORTABLE_PROJECT_LIMITS.maxEntryBytes,
  maxEntries: PORTABLE_PROJECT_LIMITS.maxEntryCount
}

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
  omissions?: readonly PortableProjectOmission[]
  appearance?: Record<string, unknown>
}

export interface PortableProjectV3ImportOptions {
  /** A project root to create. It must not already exist, preventing destination collisions. */
  destination?: string
  signal?: AbortSignal
  onProgress?: (event: PortableImportProgress) => void
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
  const projection = projectToPortableCanvasV3(project, options.appearance ? { appearance: options.appearance } : {})
  const projectBytes = Buffer.from(serializePortableCanvasProjectionV3(projection))
  const entries: PortableProjectV3Entry[] = [
    { path: 'project.json', data: projectBytes, required: true },
    { path: 'history.bundle', data: options.historyBundle, required: true }
  ]
  const manifest = await createPortableProjectV3Manifest(
    { name: projection.project.name, color: projection.project.color },
    entries,
    options.omissions ?? []
  )
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  if (manifestBytes.length > PORTABLE_PROJECT_LIMITS.maxManifestBytes) throw new PortableProjectV3Error('manifest', 'Portable project manifest exceeds its byte limit.')
  const bytes = packContainer([
    { path: 'manifest.json', data: manifestBytes },
    { path: 'project.json', data: projectBytes },
    { path: 'history.bundle', data: options.historyBundle }
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

async function stageProjection(destination: string, project: Project, projectBytes: Buffer, manifestBytes: Buffer, options: PortableProjectV3ImportOptions): Promise<string> {
  const finalPath = path.resolve(destination)
  const parent = path.dirname(finalPath)
  const parentStat = await fs.stat(parent).catch(() => null)
  if (!parentStat?.isDirectory()) throw new PortableProjectV3Error('destination-collision', `Destination parent is unavailable: ${parent}`)
  try {
    await fs.lstat(finalPath)
    throw new PortableProjectV3Error('destination-collision', `Destination collision: ${finalPath} already exists.`)
  } catch (error) {
    if (error instanceof PortableProjectV3Error) throw error
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
  }
  const stage = path.join(parent, `.nodeterm-import-${randomUUID()}.tmp`)
  try {
    await fs.mkdir(path.join(stage, '.nodeterm'), { recursive: true })
    // Keep the portable source beside the classic runtime file. WorkspaceStore can then reopen
    // the imported folder on the next launch without treating the schema 3 projection as corrupt,
    // while the original schema 3 bytes remain available for a later universe-aware reader.
    const runtimeFile = serializeProjectFile(projectToFile(project, 0, new Date().toISOString()))
    await fs.writeFile(path.join(stage, '.nodeterm', 'project.json'), runtimeFile, { flag: 'wx' })
    await fs.writeFile(path.join(stage, '.nodeterm', 'portable-project.json'), projectBytes, { flag: 'wx' })
    await fs.writeFile(path.join(stage, '.nodeterm', 'portable-manifest.json'), manifestBytes, { flag: 'wx' })
    ensureNotCancelled(options)
    emit(options, 'publishing', 0.95, 'Publishing the staged project atomically.')
    await renameAtomic(stage, finalPath)
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
  const entries = openContainer(bytes, READ_LIMITS)
  validatePortableArchiveInventory([...entries.keys()])
  emit(options, 'validating', 0.2, 'Validating archive paths, entry sizes, and hashes before writing anything.')
  const manifestBytes = entries.get('manifest.json')
  if (!manifestBytes) throw new PortableProjectV3Error('required-entry', 'Portable project manifest is missing.')
  const manifest = parsePortableProjectV3Manifest(manifestBytes)
  const payloadEntries: PortableProjectV3Entry[] = [...entries.entries()]
    .filter(([entryPath]) => entryPath !== 'manifest.json')
    .map(([entryPath, data]) => ({ path: entryPath, data, compressedBytes: data.byteLength }))
  await validatePortableProjectV3Entries(manifest, payloadEntries)
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
  const project = portableCanvasProjectionToProject(projection, { id })
  let stagedPath: string | undefined
  if (options.destination) {
    emit(options, 'staging', 0.7, 'Preparing a collision-free local destination; no bindings or external services are touched.')
    stagedPath = await stageProjection(options.destination, project, Buffer.from(serializePortableCanvasProjectionV3(projection)), manifestBytes, options)
  }
  emit(options, 'completed', 1, 'Project import completed with local bindings left unconfigured.')
  return { project: stagedPath ? { ...project, cwd: stagedPath } : project, manifest, projection, archiveVersion: 3, bindings: [], omissions: manifest.omissions }
}

/** Marker used by archive callers without exposing container internals. */
export function looksLikePortableProjectV3(bytes: Buffer): boolean {
  if (bytes.length < 4) return false
  try { return openContainer(bytes, READ_LIMITS).has('manifest.json') } catch { return false }
}
