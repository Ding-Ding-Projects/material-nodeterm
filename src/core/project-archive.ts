// One-file project save/restore (`.nodeterm-project`) — the whole project the way a .docx is the
// whole document.
//
// V2 (this module's writer) is a genuine ZIP container (`project-archive-container.ts`):
//   mimetype                 application/x-nodeterm-project (identification aid, tolerated absent)
//   archive.json             manifest: schemaVersion 2, exportedAt, projectName, contents report
//   project.json             the portable canvas snapshot — IDENTICAL text to the history head, so
//                            the V1 tamper proof (snapshot must match the bundled history tip)
//                            survives unchanged
//   history.bundle           the app-owned local-history git bundle (raw bytes; V1 carried base64)
//   vault.json               the password-manager vault of a FOLDER-LESS project (a folder
//                            project's vault is already one of its own working files below).
//                            Every secret in it is an AEAD envelope under the vault's own
//                            password, so this carries no plaintext - but it does make the save
//                            file as sensitive as that password, which the export UI states.
//   repo/repository.bundle   `git bundle create --all` of the project's OWN repository
//   files/<relative path>    working files: tracked files at their CURRENT on-disk content plus
//                            untracked-but-not-ignored files, and the explicit comment namespace
//                            `.nodeterm/board-log.jsonl` plus referenced attachment blobs even
//                            when the project ignores `.nodeterm`.
//
// The inclusion rule, stated rather than implied: what git tracks travels, at working-tree
// content, plus everything untracked that .gitignore does not exclude, plus the complete history
// as a bundle. Ignored files DO NOT travel — they are build output, caches and dependencies by
// definition of being ignored — but NOTHING is dropped silently: every exclusion is recorded in
// the manifest (grouped per ignored root, with file counts and bytes) and surfaced in the UI.
//
// V1 (JSON text: canvas + history bundle only) still IMPORTS — users have V1 files — and the
// result says plainly that a V1 archive carries no repository. Export always writes V2.
//
// Import with working files requires an EMPTY destination folder: import can therefore never
// overwrite anything, which is why it needs no destructive-action gate. The repository comes back
// via `git init` + `bundle verify` + `fetch +refs/*:refs/*` + HEAD restore + `reset --mixed`, so
// `git log` AND the uncommitted working state both survive the round trip (the staged/unstaged
// split does not — reset --mixed sets the index to HEAD — a stated limitation).

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { Project, ProjectArchiveContents, ProjectArchiveExclusion } from '../shared/types'
import { freshProjectId } from '../shared/project-id'
import { fileToProject, projectToFile, serializeProjectFile, type ProjectFileV1 } from './workspace-files'
import { LocalHistoryStore } from './local-history'
import { looksLikeContainer, openContainer, packContainer, type ContainerEntry } from './project-archive-container'
import { parseLines } from './board-log'
import { validBoardLogAttachment, BOARD_LOG_ATTACHMENT_LIMITS } from '../shared/board-log-attachments'
import { renameAtomic, tempNameFor } from './fs-atomic'
import {
  exportPortableProjectV3,
  importPortableProjectV3,
  looksLikePortableProjectV3,
  type PortableImportResult
} from './portable-project-import'
import type { PortableProjectOmission } from './portable-project-v3'
import { resolvePortableMediaPreparation } from './portable-media-assets'
import type { PortableMediaExportPlan } from '../shared/portable-media'

// Schema 3 is exposed from the established archive seam while its validation remains platform-free.
export * from './portable-project-v3'
export * from './portable-canvas-projection'
export * from './aws-universe'

/** V1 JSON-text archives keep their historical cap. */
const MAX_ARCHIVE_BYTES_V1 = 180 * 1024 * 1024
/** The V2 container file itself. Raised from V1's 180 MB because a save file that carries the
 *  repository is legitimately bigger than one that carried the canvas alone. */
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
/** Raw (uncompressed) payload budget — also the import-side decompression budget, so this module
 *  can never WRITE a file it would later refuse to READ. */
export const MAX_RAW_PAYLOAD_BYTES = 2 * 1024 * 1024 * 1024
/** ZIP without zip64 caps the entry count at 65,535; refuse before that with the real number. */
export const MAX_FILE_ENTRIES = 60_000
/** Bounded per-ignored-root size scan — past this the reported numbers are honest lower bounds. */
const IGNORED_SCAN_CAP = 200_000
/** Named exclusions kept in the manifest before the remainder is aggregated into one honest row. */
const MAX_LISTED_EXCLUSIONS = 2_000
const GIT_TIMEOUT_MS = 120_000
const GIT_OUTPUT_CAP = 64 * 1024 * 1024
const MIMETYPE = 'application/x-nodeterm-project'
const LOG_DIR = '.nodeterm'
const LOG_FILE = 'board-log.jsonl'

const READ_LIMITS = {
  maxArchiveBytes: MAX_ARCHIVE_BYTES,
  maxTotalBytes: MAX_RAW_PAYLOAD_BYTES,
  maxEntryBytes: MAX_RAW_PAYLOAD_BYTES,
  maxEntries: 65_500
}

function ancestors(root: string, target: string): string[] {
  const out: string[] = []
  let current = path.resolve(target)
  const base = path.resolve(root)
  while (current !== base && current.startsWith(base + path.sep)) {
    out.push(current)
    current = path.dirname(current)
  }
  return out.reverse()
}

/** Check every existing path component, including ancestors above the destination. A final
 * lstat immediately before publication narrows, but cannot eliminate, the replacement race. */
async function assertNoSymlinkAncestors(target: string): Promise<void> {
  const resolved = path.resolve(target)
  const parsed = path.parse(resolved)
  let current = parsed.root
  const rest = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)
  for (const segment of rest) {
    current = path.join(current, segment)
    const stat = await fs.lstat(current).catch(() => null)
    // The final destination may be the new child the user deliberately selected. Every parent
    // must already exist so a missing component cannot redirect recursive mkdir through an
    // unreviewed path.
    if (!stat) {
      if (current === resolved) return
      throw new Error(`Destination component is missing: ${current}`)
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Destination component is an unsafe link: ${current}`)
  }
}

interface ProjectArchiveV1 {
  schemaVersion: 1
  exportedAt: string
  project: ProjectFileV1
  history: { format: 'git-bundle-base64'; bytes: string }
}

interface ArchiveManifestV2 {
  schemaVersion: 2
  exportedAt: string
  generator: string
  projectName: string
  contents: ProjectArchiveContents
}

export interface ProjectArchiveExportResult {
  bytes: Buffer
  contents: ProjectArchiveContents
}

export interface ProjectArchiveInspection {
  archiveVersion: 1 | 2
  /** True when the archive carries working files / a repository and import therefore needs an
   *  empty destination folder before it can proceed. */
  needsDestination: boolean
  projectName?: string
}

export interface ProjectArchiveImportResult {
  project: Project
  archiveVersion: 1 | 2
  contents: ProjectArchiveContents
  restoredTo?: string
  /** The password-manager vault the archive carried for a FOLDER-LESS project, verbatim. The
   *  caller writes it to the new project's working-copy root - see the export note below. */
  vault?: Buffer
  plannerDefinitions?: unknown
  repairs?: unknown[]
}

export interface ProjectArchiveExportOptions {
  /** Legacy input retained for callers; schema 3 records an explicit credential omission instead
   * of carrying vault bytes. */
  vault?: Buffer
  /** One-shot, already prepared media choices. Bytes are included only after the privileged
   * preparation has validated them; unresolved and omitted media remain explicit manifest data. */
  portableMedia?: {
    preparation: import('./portable-media-assets').PortableMediaPreparation
    decisions: PortableMediaExportPlan['decisions']
  }
}

const PORTABLE_ARCHIVE_OMISSIONS: readonly PortableProjectOmission[] = [
  { path: 'credentials', reason: 'credential', detail: 'Credentials and authenticator material remain on the source machine.' },
  { path: 'machine-local-settings', reason: 'machine-local', detail: 'Machine-local settings are not portable between installations.' },
  { path: 'process-state', reason: 'machine-local', detail: 'Live process and session state is never carried in a project file.' },
  { path: 'working-directory', reason: 'machine-local', detail: 'The source working directory is not reused as an import destination.' }
]

function portableContents(result: Pick<PortableImportResult, 'manifest'>): ProjectArchiveContents {
  const excluded = result.manifest.omissions.map((omission) => ({
    path: omission.path,
    reason: omission.reason === 'unknown-optional' ? 'unsupported' : omission.reason,
    detail: omission.detail
  }))
  return {
    repository: 'portable-projection',
    repositoryNote: 'Schema 3 portable project intent was carried; credentials, machine-local bindings, and process state were omitted.',
    workingFiles: result.manifest.entries.filter((entry) => entry.path.startsWith('files/')).length,
    workingBytes: result.manifest.entries
      .filter((entry) => entry.path.startsWith('files/'))
      .reduce((sum, entry) => sum + entry.rawBytes, 0),
    excluded,
    excludedFiles: excluded.length,
    excludedBytes: 0
  }
}

function isProjectFile(value: unknown): value is ProjectFileV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const file = value as Partial<ProjectFileV1>
  return file.version === 1 && typeof file.name === 'string' && Array.isArray(file.nodes)
}

// The env vars that could reroute a git call away from the repository named by cwd. Same list and
// reasoning as local-history.ts (an app launched from a git hook inherits GIT_DIR etc.); kept as a
// second copy ONLY because this module deliberately does not share `runLocalHistoryGit` — see
// `runProjectGit` below for why the runners differ.
const GIT_REPOSITORY_REDIRECTS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_QUARANTINE_PATH',
  'GIT_PREFIX',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_INDEX_FILE'
] as const

export type ProjectGitRunner = (
  cwd: string,
  args: string[]
) => Promise<{ ok: true; stdout: string } | { ok: false; stdout: string; stderr: string }>

/**
 * Bounded git runner for the PROJECT'S OWN repository. Deliberately not `runLocalHistoryGit`:
 * that runner's 10 s deadline and 32 MB output cap are sized for the app-owned history repos it
 * serves, and bundling a user repository can legitimately need both more time and more `ls-files`
 * output. Hooks stay disabled and repository-routing env stays stripped, exactly as there.
 * A non-zero exit RESOLVES with `ok:false` (callers decide whether a miss is an answer); only a
 * spawn failure/timeout/overflow rejects.
 */
export const runProjectGit: ProjectGitRunner = (cwd, args) => {
  const disabledHooks = path.join(cwd, '.git', 'nodeterm-hooks-disabled')
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of GIT_REPOSITORY_REDIRECTS) delete env[key]
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', `core.hooksPath=${disabledHooks}`, ...args], {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let tooLarge = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, GIT_TIMEOUT_MS)
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve({ ok: true, stdout })
    }
    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString('utf-8')
      if (next.length > GIT_OUTPUT_CAP) {
        tooLarge = true
        child.kill('SIGKILL')
      }
      return next
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk)
    })
    child.once('error', (error) => finish(error))
    child.once('close', (code) => {
      if (timedOut) return finish(new Error(`git ${args[0]} exceeded the ${GIT_TIMEOUT_MS / 1000}s deadline.`))
      if (tooLarge) return finish(new Error(`git ${args[0]} produced more output than the export can hold.`))
      if (code === 0) return finish()
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, stdout, stderr })
    })
  })
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

function emptyContents(repository: ProjectArchiveContents['repository'], note?: string): ProjectArchiveContents {
  return {
    repository,
    ...(note ? { repositoryNote: note } : {}),
    workingFiles: 0,
    workingBytes: 0,
    excluded: [],
    excludedFiles: 0,
    excludedBytes: 0
  }
}

/** Sum + cap the named exclusion list: the first MAX_LISTED_EXCLUSIONS keep their names, the
 *  remainder collapses into one aggregate row so the manifest cannot balloon — the TOTALS stay
 *  exact either way, which is the promise that matters. */
function finalizeExclusions(excluded: ProjectArchiveExclusion[]): {
  excluded: ProjectArchiveExclusion[]
  excludedFiles: number
  excludedBytes: number
} {
  let files = 0
  let bytes = 0
  for (const e of excluded) {
    files += e.files ?? 1
    bytes += e.bytes ?? 0
  }
  if (excluded.length <= MAX_LISTED_EXCLUSIONS) return { excluded, excludedFiles: files, excludedBytes: bytes }
  const kept = excluded.slice(0, MAX_LISTED_EXCLUSIONS)
  const rest = excluded.slice(MAX_LISTED_EXCLUSIONS)
  let restFiles = 0
  let restBytes = 0
  for (const e of rest) {
    restFiles += e.files ?? 1
    restBytes += e.bytes ?? 0
  }
  kept.push({ path: `(${rest.length.toLocaleString()} more excluded paths)`, reason: 'gitignored', files: restFiles, bytes: restBytes })
  return { excluded: kept, excludedFiles: files, excludedBytes: bytes }
}

async function walkDirSizes(root: string, cap: number): Promise<{ files: number; bytes: number; atLeast: boolean }> {
  let files = 0
  let bytes = 0
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let names: import('node:fs').Dirent[]
    try {
      names = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const d of names) {
      if (files >= cap) return { files, bytes, atLeast: true }
      const full = path.join(dir, d.name)
      if (d.isSymbolicLink()) {
        files++
        continue
      }
      if (d.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!d.isFile()) continue
      files++
      try {
        bytes += (await fs.lstat(full)).size
      } catch {
        // Unreadable while scanning: counted as a file of unknown size.
      }
    }
  }
  return { files, bytes, atLeast: false }
}

interface RepositoryCapture {
  bundle: Buffer | null
  files: { path: string; data: Buffer }[]
  contents: ProjectArchiveContents
}

export class ProjectArchiveService {
  constructor(
    private readonly history: LocalHistoryStore,
    private readonly git: ProjectGitRunner = runProjectGit,
    _plannerDefinitions?: () => unknown
  ) {}

  async export(
    project: Project,
    opts: ProjectArchiveExportOptions = {}
  ): Promise<ProjectArchiveExportResult> {
    // Schema 3 is the portable write path. The V1/V2 writer below remains for legacy reads and
    // historical fixtures, but new archives must not carry machine paths, credentials, or process
    // hydration data.
    const mediaAssets = opts.media ? dedupePortableMediaCollected(opts.media.assets) : []
    const mediaManifest = opts.media ? createPortableMediaManifest(mediaAssets.map((item) => item.asset), opts.media.omissions) : undefined
    const projection = projectToPortableCanvasV3(project, {
      ...(opts.appearance ? { appearance: opts.appearance } : {}),
      ...(mediaManifest ? { media: mediaManifest } : {})
    })
    const projectBytes = Buffer.from(serializePortableCanvasProjectionV3(projection))
    await this.history.record({
      domain: `project_${project.id}`,
      filename: 'project.json',
      content: new TextDecoder().decode(projectBytes),
      label: `Exported portable project ${project.name}`,
      action: 'updated'
    })
    const historyBundle = await this.history.exportBundle(`project_${project.id}`)
    if (!historyBundle) throw new Error('The project history repository could not be bundled.')
    const portable = await exportPortableProjectV3(project, {
      historyBundle,
      projection,
      ...(opts.vault ? { omissions: [{ path: 'vault', reason: 'credential' as const, detail: 'Vault material remains on the source machine and is not portable.' }] } : {}),
      ...(opts.media ? { media: { ...opts.media, assets: mediaAssets } } : {}),
      ...(opts.appearance ? { appearance: opts.appearance } : {}),
      ...(opts.sidecars ? { sidecars: opts.sidecars } : {}),
      ...(opts.attachments ? { attachments: opts.attachments } : {})
    })
    return {
      bytes: portable.bytes,
      archiveVersion: 3,
      contents: {
        repository: 'portable-projection',
        repositoryNote: 'Schema 3 carries safe canvas intent and local history only. Paths, credentials, provider state, processes, and machine-local bindings remain local.',
        workingFiles: 0,
        workingBytes: 0,
        excluded: portable.manifest.omissions.map((item) => ({ path: item.path, reason: item.reason, detail: item.detail })),
        excludedFiles: portable.manifest.omissions.length,
        excludedBytes: 0
      }
    }
    /*
    const exportedAt = new Date().toISOString()
    const snapshot = projectToFile(project, 0, exportedAt)
    const snapshotText = serializeProjectFile(snapshot)
    await this.history.record({
      domain: `project_${project.id}`,
      filename: 'project.json',
      content: snapshotText,
      label: `Exported project ${project.name}`,
      action: 'updated'
    })
    const historyBundle = await this.history.exportBundle(`project_${project.id}`)
    if (!historyBundle) throw new Error('The project history repository could not be bundled.')
    const media = opts.portableMedia
      ? await resolvePortableMediaPreparation(opts.portableMedia.preparation, opts.portableMedia.decisions)
      : undefined
    const omissions: PortableProjectOmission[] = [
      ...PORTABLE_ARCHIVE_OMISSIONS,
      ...(opts.vault
        ? [{ path: 'vault', reason: 'credential' as const, detail: 'The supplied password-manager vault remains machine-local and is deliberately excluded.' }]
        : [])
    ]
    const exported = await exportPortableProjectV3(project, {
      historyBundle,
      omissions,
      ...(media ? { media } : {})
    })
    return { bytes: exported.bytes, contents: portableContents(exported) }
    */
  }

  /** Cheap peek: which schema, and does import need a destination folder first? */
  inspect(bytes: Buffer): ProjectArchiveInspection {
    if (!looksLikeContainer(bytes)) return { archiveVersion: 1, needsDestination: false }
    if (looksLikePortableProjectV3(bytes)) {
      const entries = openContainer(bytes, READ_LIMITS, (name) => name === 'manifest.json')
      const manifestBytes = entries.get('manifest.json')
      if (!manifestBytes) throw new Error('This is not a supported nodeterm project archive (no manifest).')
      const manifest = JSON.parse(manifestBytes.toString('utf-8')) as { schemaVersion?: unknown; project?: { name?: unknown }; entries?: unknown[] }
      if (manifest.schemaVersion !== 3) throw new Error('This project file needs a newer version of nodeterm.')
      return {
        archiveVersion: 3,
        needsDestination: false,
        ...(typeof manifest.project?.name === 'string' ? { projectName: manifest.project.name } : {})
      }
    }
    let hasPayload = false
    const picked = openContainer(bytes, READ_LIMITS, (name) => {
      if (name === 'repo/repository.bundle' || name.startsWith('files/')) hasPayload = true
      return name === 'archive.json'
    })
    const manifestBytes = picked.get('archive.json')
    if (!manifestBytes) throw new Error('This is not a supported nodeterm project archive (no manifest).')
    const manifest = JSON.parse(manifestBytes.toString('utf-8')) as Partial<ArchiveManifestV2>
    if (manifest.schemaVersion !== 2) throw new Error('This project file needs a newer version of nodeterm.')
    return {
      archiveVersion: 2,
      needsDestination: hasPayload,
      ...(typeof manifest.projectName === 'string' ? { projectName: manifest.projectName } : {})
    }
  }

  async import(bytes: Buffer, opts: { destination?: string; signal?: AbortSignal; onProgress?: (progress: unknown) => void } = {}): Promise<ProjectArchiveImportResult> {
    if (!looksLikeContainer(bytes)) {
      const project = await this.importV1(bytes.toString('utf-8'))
      return {
        project,
        archiveVersion: 1,
        contents: emptyContents(
          'not-in-archive',
          'This archive was saved by an older nodeterm and carries the canvas and its local ' +
            'history only — no repository or working files were inside it.'
        )
      }
    }
    if (looksLikePortableProjectV3(bytes)) {
      const imported = await importPortableProjectV3(bytes, opts)
      return {
        project: imported.project,
        archiveVersion: 3,
        contents: portableContents(imported),
        ...(imported.stagedPath ? { restoredTo: imported.stagedPath } : {}),
        ...(imported.plannerDefinitions ? { plannerDefinitions: imported.plannerDefinitions } : {}),
        repairs: imported.repairs
      }
    }
    return this.importV2(bytes, opts.destination)
  }

  private async importV2(bytes: Buffer, destination?: string): Promise<ProjectArchiveImportResult> {
    const entries = openContainer(bytes, READ_LIMITS)
    const manifestBytes = entries.get('archive.json')
    if (!manifestBytes) throw new Error('This is not a supported nodeterm project archive (no manifest).')
    let manifest: Partial<ArchiveManifestV2>
    try {
      manifest = JSON.parse(manifestBytes.toString('utf-8')) as Partial<ArchiveManifestV2>
    } catch {
      throw new Error('The project file manifest is not valid JSON.')
    }
    if (manifest.schemaVersion !== 2) throw new Error('This project file needs a newer version of nodeterm.')
    const projectBytes = entries.get('project.json')
    if (!projectBytes) throw new Error('The project snapshot is missing from the archive.')
    let parsedProject: unknown
    try {
      parsedProject = JSON.parse(projectBytes.toString('utf-8'))
    } catch {
      throw new Error('The project snapshot is not valid JSON.')
    }
    if (!isProjectFile(parsedProject)) throw new Error('The project snapshot is invalid.')
    const historyBundle = entries.get('history.bundle')
    if (!historyBundle) throw new Error('The project history bundle is missing.')

    const repoBundle = entries.get('repo/repository.bundle') ?? null
    const fileEntries: { rel: string; data: Buffer }[] = []
    for (const [name, data] of entries) {
      if (name.startsWith('files/')) fileEntries.push({ rel: name.slice('files/'.length), data })
    }
    const hasPayload = repoBundle !== null || fileEntries.length > 0
    if (hasPayload && !destination) {
      throw new Error('This project file carries a repository — choose an empty destination folder first.')
    }

    const id = freshProjectId()
    const domain = `project_${id}`
    let wroteIntoDestination = false
    try {
      await this.history.importBundle(domain, historyBundle)
      const head = await this.history.readHeadFile(domain, 'project.json')
      if (head?.trimEnd() !== serializeProjectFile(parsedProject).trimEnd()) {
        throw new Error('The project snapshot does not match the bundled history tip.')
      }

      let restoredTo: string | undefined
      if (hasPayload && destination) {
        await this.assertEmptyDestination(destination)
        wroteIntoDestination = true
        await this.extractFiles(destination, fileEntries)
        if (repoBundle) await this.restoreRepository(destination, repoBundle)
        restoredTo = destination
      }

      const baseContents: ProjectArchiveContents =
        manifest.contents && typeof manifest.contents === 'object'
          ? (manifest.contents as ProjectArchiveContents)
          : emptyContents(repoBundle ? 'git-bundle' : 'no-folder')
      const contents: ProjectArchiveContents = entries.has('vault.json')
        ? {
            ...baseContents,
            excluded: [...baseContents.excluded, { path: 'vault', reason: 'credential' as const, detail: 'The legacy vault payload remains machine-local and was excluded during import.' }],
            excludedFiles: baseContents.excludedFiles + 1
          }
        : baseContents
      const project = fileToProject(parsedProject, { id, ...(restoredTo ? { cwd: restoredTo } : {}) })
      // A carried vault is handed BACK rather than written here: where it belongs depends on the
      // project this import just minted (a restored folder's own .nodeterm, or the machine-local
      // working copy for a folder-less one), and that decision has exactly one home -
      // password-manager/vault-location.ts. A folder-restoring import already got its vault back
      // with the working files, so the entry is only expected on the folder-less path.
      return {
        project,
        archiveVersion: 2,
        contents,
        ...(restoredTo ? { restoredTo } : {})
      }
    } catch (error) {
      // importBundle only publishes a fresh domain, and the destination was proven EMPTY before
      // the first write — so everything under both is ours to remove, and removing it is what
      // lets a retry start clean instead of inheriting partial state.
      await fs.rm(this.history.domainPath(domain), { recursive: true, force: true }).catch(() => {})
      if (wroteIntoDestination && destination) {
        const children = await fs.readdir(destination).catch(() => [] as string[])
        for (const child of children) {
          await fs.rm(path.join(destination, child), { recursive: true, force: true }).catch(() => {})
        }
      }
      throw error
    }
  }

  private async importV1(text: string): Promise<Project> {
    if (Buffer.byteLength(text, 'utf-8') > MAX_ARCHIVE_BYTES_V1) {
      throw new Error('The project archive exceeds the 180 MB limit.')
    }
    const parsed = JSON.parse(text) as Partial<ProjectArchiveV1>
    const keys = Object.keys(parsed).sort().join(',')
    if (keys !== 'exportedAt,history,project,schemaVersion' || parsed.schemaVersion !== 1) {
      throw new Error('This is not a supported nodeterm project archive.')
    }
    if (!isProjectFile(parsed.project)) throw new Error('The project snapshot is invalid.')
    if (parsed.history?.format !== 'git-bundle-base64' || typeof parsed.history.bytes !== 'string') {
      throw new Error('The project history bundle is missing.')
    }
    const bundle = Buffer.from(parsed.history.bytes, 'base64')
    if (bundle.toString('base64') !== parsed.history.bytes) throw new Error('The project history bundle is malformed.')
    const id = freshProjectId()
    const domain = `project_${id}`
    try {
      await this.history.importBundle(domain, bundle)
      const head = await this.history.readHeadFile(domain, 'project.json')
      if (head?.trimEnd() !== serializeProjectFile(parsed.project).trimEnd()) {
        throw new Error('The project snapshot does not match the bundled history tip.')
      }
      return fileToProject(parsed.project, { id })
    } catch (error) {
      await fs.rm(this.history.domainPath(domain), { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  // ── Export-side repository capture ────────────────────────────────────────────────────────────

  private async captureRepository(project: Project): Promise<RepositoryCapture> {
    if (project.ssh) {
      return {
        bundle: null,
        files: [],
        contents: emptyContents(
          'remote-project',
          `The project folder lives on ${project.ssh.server.host} — this save file carries the canvas and its local history only.`
        )
      }
    }
    if (!project.cwd) {
      return { bundle: null, files: [], contents: emptyContents('no-folder') }
    }
    const cwd = project.cwd
    const stat = await fs.stat(cwd).catch(() => null)
    if (!stat?.isDirectory()) {
      return {
        bundle: null,
        files: [],
        contents: emptyContents(
          'folder-missing',
          `The project folder (${cwd}) no longer exists — this save file carries the canvas and its local history only.`
        )
      }
    }
    const toplevel = await this.git(cwd, ['rev-parse', '--show-toplevel'])
    if (!toplevel.ok) return this.captureWithoutRepo(cwd)
    const sameRoot = await this.pathsEqual(toplevel.stdout.trim(), cwd)
    return this.captureGitRepo(cwd, sameRoot)
  }

  private async pathsEqual(a: string, b: string): Promise<boolean> {
    const [ra, rb] = await Promise.all([
      fs.realpath(a).catch(() => path.resolve(a)),
      fs.realpath(b).catch(() => path.resolve(b))
    ])
    const na = path.resolve(ra)
    const nb = path.resolve(rb)
    return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb
  }

  /** Working files + exclusion report from `git ls-files`, plus the repo bundle when this folder
   *  IS the repository root and it has at least one commit. */
  private async captureGitRepo(cwd: string, isRepoRoot: boolean): Promise<RepositoryCapture> {
    const listed = await this.git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.'])
    if (!listed.ok) throw new Error(`Could not list the project's files: ${'stderr' in listed ? listed.stderr.trim() : 'git failed'}`)
    const includePaths = listed.stdout.split('\0').filter((p) => p.length > 0)

    const excluded: ProjectArchiveExclusion[] = []
    const files: { path: string; data: Buffer }[] = []
    let workingBytes = 0
    const seen = new Set<string>()
    for (const rel of includePaths) {
      if (seen.has(rel)) continue
      seen.add(rel)
      if (`files/${rel}`.split('/').some((seg) => seg === '..' || seg === '.') || rel.includes('\\')) {
        excluded.push({ path: rel, reason: 'special' })
        continue
      }
      const full = path.join(cwd, ...rel.split('/'))
      const st = await fs.lstat(full).catch(() => null)
      if (!st) {
        excluded.push({ path: rel, reason: 'missing' })
        continue
      }
      if (st.isSymbolicLink()) {
        excluded.push({ path: rel, reason: 'symlink' })
        continue
      }
      if (st.isDirectory()) {
        // A gitlink (submodule / embedded repository) lists as one path that is a directory on
        // disk. Its history is not ours to bundle; say so instead of half-copying it.
        excluded.push({ path: `${rel}/`, reason: 'nested-repository' })
        continue
      }
      if (!st.isFile()) {
        excluded.push({ path: rel, reason: 'special' })
        continue
      }
      try {
        const data = await fs.readFile(full)
        workingBytes += data.length
        files.push({ path: rel, data })
      } catch {
        excluded.push({ path: rel, reason: 'unreadable', bytes: st.size })
      }
    }

    // `.nodeterm` is commonly ignored, but comment attachments are an explicit archive namespace,
    // not build output. Include only blobs referenced by valid board-log metadata and verify every
    // recorded length and digest before the archive is built.
    const commentFiles = await this.captureCommentAttachments(cwd, seen)
    for (const file of commentFiles) {
      files.push(file)
      workingBytes += file.data.length
    }

    // Ignored paths: grouped per ignored root (--directory), each measured so the user is told
    // the count and the bytes they are NOT carrying, not just that "some" files were skipped.
    const ignored = await this.git(cwd, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z', '--', '.'])
    if (ignored.ok) {
      for (const rel of ignored.stdout.split('\0').filter((p) => p.length > 0)) {
        if (rel.endsWith('/')) {
          const scan = await walkDirSizes(path.join(cwd, ...rel.slice(0, -1).split('/')), IGNORED_SCAN_CAP)
          excluded.push({
            path: rel,
            reason: 'gitignored',
            files: scan.files,
            bytes: scan.bytes,
            ...(scan.atLeast ? { atLeast: true } : {})
          })
        } else {
          const st = await fs.lstat(path.join(cwd, ...rel.split('/'))).catch(() => null)
          excluded.push({ path: rel, reason: 'gitignored', ...(st ? { bytes: st.size } : {}) })
        }
      }
    }

    let bundle: Buffer | null = null
    let repository: ProjectArchiveContents['repository'] = 'files-only'
    let repositoryNote: string | undefined
    if (!isRepoRoot) {
      repositoryNote =
        'This folder sits inside a larger Git repository; its files were included but the ' +
        'surrounding repository was not bundled.'
    } else {
      const hasCommits = await this.git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])
      if (!hasCommits.ok) {
        repositoryNote = 'The repository has no commits yet, so there was no history to bundle.'
      } else {
        const tmp = path.join(tmpdir(), `nodeterm-repo-${randomUUID()}.bundle`)
        try {
          const bundled = await this.git(cwd, ['bundle', 'create', tmp, '--all'])
          if (!bundled.ok) {
            throw new Error(`Could not bundle the project repository: ${'stderr' in bundled ? bundled.stderr.trim() : 'git failed'}`)
          }
          bundle = await fs.readFile(tmp)
          repository = 'git-bundle'
        } finally {
          await fs.rm(tmp, { force: true }).catch(() => {})
        }
      }
    }

    const finalized = finalizeExclusions(excluded)
    return {
      bundle,
      files,
      contents: {
        repository,
        ...(repositoryNote ? { repositoryNote } : {}),
        workingFiles: files.length,
        workingBytes,
        ...finalized
      }
    }
  }

  private async captureCommentAttachments(cwd: string, seen: Set<string>): Promise<{ path: string; data: Buffer }[]> {
    const logPath = path.join(cwd, LOG_DIR, LOG_FILE)
    const raw = await fs.readFile(logPath, 'utf8').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return ''
      throw error
    })
    if (!raw) return []
    const out: { path: string; data: Buffer }[] = []
    const logRel = `${LOG_DIR}/${LOG_FILE}`
    if (!seen.has(logRel)) {
      const logStat = await fs.lstat(logPath).catch(() => null)
      if (!logStat || logStat.isSymbolicLink() || !logStat.isFile()) throw new Error('The board-log archive entry is not a regular file.')
      const logData = Buffer.from(raw, 'utf8')
      if (logData.length > BOARD_LOG_ATTACHMENT_LIMITS.maxTotalBytes) throw new Error('The board-log attachment manifest exceeds its bound.')
      out.push({ path: logRel, data: logData })
      seen.add(logRel)
    }
    const referenced = parseLines(raw, { all: true }).flatMap((entry) => entry.attachments ?? [])
    for (const attachment of referenced) {
      const candidate: unknown = attachment
      if (!validBoardLogAttachment(candidate)) throw new Error('The comment attachment metadata is invalid.')
      if (out.length >= BOARD_LOG_ATTACHMENT_LIMITS.maxPerComment * 1000) throw new Error('Too many comment attachments for an archive.')
      const rel = `.nodeterm/board-attachments/${attachment.id}.bin`
      if (seen.has(rel)) continue
      const full = path.join(cwd, '.nodeterm', 'board-attachments', `${attachment.id}.bin`)
      const stat = await fs.lstat(full).catch(() => null)
      if (!stat || stat.isSymbolicLink() || !stat.isFile()) throw new Error(`The referenced comment attachment is missing or unsafe: ${attachment.id}`)
      if (stat.size !== attachment.bytes || stat.size > BOARD_LOG_ATTACHMENT_LIMITS.maxBytes) throw new Error(`The referenced comment attachment has an unexpected length: ${attachment.id}`)
      const data = await fs.readFile(full)
      const digest = createHash('sha256').update(data).digest('hex')
      if (digest !== attachment.sha256) throw new Error(`The referenced comment attachment failed its SHA-256 check: ${attachment.id}`)
      seen.add(rel)
      out.push({ path: rel, data })
    }
    return out
  }

  /** No git repo: there is no ignore rule to respect, so EVERYTHING regular is included (the size
   *  caps are the guard rail); nested `.git` directories and symlinks are skipped and reported. */
  private async captureWithoutRepo(cwd: string): Promise<RepositoryCapture> {
    const excluded: ProjectArchiveExclusion[] = []
    const files: { path: string; data: Buffer }[] = []
    let workingBytes = 0
    const stack: string[] = ['']
    while (stack.length > 0) {
      const relDir = stack.pop()!
      const full = relDir ? path.join(cwd, ...relDir.split('/')) : cwd
      let names: import('node:fs').Dirent[]
      try {
        names = await fs.readdir(full, { withFileTypes: true })
      } catch {
        excluded.push({ path: `${relDir || '.'}/`, reason: 'unreadable' })
        continue
      }
      for (const d of names) {
        const rel = relDir ? `${relDir}/${d.name}` : d.name
        if (d.isSymbolicLink()) {
          excluded.push({ path: rel, reason: 'symlink' })
          continue
        }
        if (d.isDirectory()) {
          if (d.name === '.git') {
            const scan = await walkDirSizes(path.join(full, d.name), IGNORED_SCAN_CAP)
            excluded.push({ path: `${rel}/`, reason: 'nested-repository', files: scan.files, bytes: scan.bytes })
            continue
          }
          stack.push(rel)
          continue
        }
        if (!d.isFile()) {
          excluded.push({ path: rel, reason: 'special' })
          continue
        }
        if (files.length >= MAX_FILE_ENTRIES) {
          throw new Error(
            `This folder holds more than ${MAX_FILE_ENTRIES.toLocaleString()} files and has no ` +
              'Git repository whose ignore rules could narrow it — too many for a save file.'
          )
        }
        try {
          const data = await fs.readFile(path.join(full, d.name))
          workingBytes += data.length
          files.push({ path: rel, data })
        } catch {
          excluded.push({ path: rel, reason: 'unreadable' })
        }
      }
    }
    const finalized = finalizeExclusions(excluded)
    return {
      bundle: null,
      files,
      contents: {
        repository: 'no-repository',
        repositoryNote: 'This folder has no Git repository; every regular file was included.',
        workingFiles: files.length,
        workingBytes,
        ...finalized
      }
    }
  }

  // ── Import-side restore ───────────────────────────────────────────────────────────────────────

  private async assertEmptyDestination(destination: string): Promise<void> {
    await assertNoSymlinkAncestors(destination)
    let st = await fs.lstat(destination).catch(() => null)
    if (!st) {
      const parent = path.dirname(path.resolve(destination))
      const parentStat = await fs.lstat(parent).catch(() => null)
      if (!parentStat?.isDirectory() || parentStat.isSymbolicLink()) throw new Error(`The destination parent is not a safe folder: ${parent}`)
      await fs.mkdir(destination)
      st = await fs.lstat(destination).catch(() => null)
    }
    if (!st?.isDirectory() || st.isSymbolicLink()) throw new Error(`The destination is not a safe folder: ${destination}`)
    const children = await fs.readdir(destination)
    if (children.length > 0) {
      throw new Error(
        `The destination folder is not empty (${children.length.toLocaleString()} item${children.length === 1 ? '' : 's'} inside). ` +
          'Choose an empty folder — import never overwrites existing files.'
      )
    }
  }

  private async extractFiles(destination: string, fileEntries: { rel: string; data: Buffer }[]): Promise<void> {
    const root = path.resolve(destination)
    await assertNoSymlinkAncestors(root)
    const rootStat = await fs.lstat(root).catch(() => null)
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw new Error('The destination contains an unsafe link.')
    this.validateArchivedCommentAttachments(fileEntries)
    for (const entry of fileEntries) {
      // openContainer already refused unsafe names; this is the belt-and-braces resolve check.
      const target = path.resolve(root, ...entry.rel.split('/'))
      if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error(`Refusing to write outside the destination: ${entry.rel}`)
      }
      for (const ancestor of ancestors(root, path.dirname(target))) {
        const stat = await fs.lstat(ancestor).catch(() => null)
        if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) throw new Error(`Refusing to follow an unsafe destination ancestor: ${entry.rel}`)
      }
      await fs.mkdir(path.dirname(target), { recursive: true })
      const parentStat = await fs.lstat(path.dirname(target))
      if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) throw new Error(`Refusing to write through an unsafe destination ancestor: ${entry.rel}`)
      await assertNoSymlinkAncestors(path.dirname(target))
      const temp = tempNameFor(target)
      try {
        await fs.writeFile(temp, entry.data, { flag: 'wx' })
        await renameAtomic(temp, target)
      } finally {
        await fs.rm(temp, { force: true }).catch(() => {})
      }
    }
  }

  private validateArchivedCommentAttachments(fileEntries: { rel: string; data: Buffer }[]): void {
    const log = fileEntries.find((entry) => entry.rel === '.nodeterm/board-log.jsonl')
    if (!log) return
    const blobs = new Map(fileEntries.filter((entry) => entry.rel.startsWith('.nodeterm/board-attachments/')).map((entry) => [entry.rel, entry.data]))
    for (const entry of parseLines(log.data.toString('utf8'), { all: true })) {
      for (const attachment of entry.attachments ?? []) {
        const candidate: unknown = attachment
        if (!validBoardLogAttachment(candidate)) throw new Error('Imported comment attachment metadata is invalid.')
        const data = blobs.get(attachment.ref)
        if (!data || data.length !== attachment.bytes || createHash('sha256').update(data).digest('hex') !== attachment.sha256) throw new Error(`Imported comment attachment failed integrity verification: ${attachment.id}`)
      }
    }
  }

  private async restoreRepository(destination: string, bundle: Buffer): Promise<void> {
    const tmp = path.join(tmpdir(), `nodeterm-repo-${randomUUID()}.bundle`)
    try {
      await fs.writeFile(tmp, bundle)
      const run = async (args: string[], what: string): Promise<string> => {
        const result = await this.git(destination, args)
        if (!result.ok) {
          throw new Error(`Could not restore the repository (${what}): ${'stderr' in result ? result.stderr.trim() : 'git failed'}`)
        }
        return result.stdout
      }
      await run(['init', '--quiet'], 'init')
      await run(['bundle', 'verify', '--quiet', tmp], 'verify')
      await run(['fetch', '--quiet', tmp, '+refs/*:refs/*'], 'fetch')
      // Restore HEAD: prefer the branch the bundle's HEAD pointed at; a detached HEAD stays
      // detached at the same commit.
      const heads = await run(['bundle', 'list-heads', tmp], 'list-heads')
      let headSha: string | undefined
      const branches = new Map<string, string>()
      for (const line of heads.split('\n')) {
        const m = line.trim().match(/^([0-9a-f]{40,64})\s+(.+)$/)
        if (!m) continue
        if (m[2] === 'HEAD') headSha = m[1]
        else if (m[2].startsWith('refs/heads/')) branches.set(m[2], m[1])
      }
      let attached = false
      if (headSha) {
        for (const [ref, sha] of branches) {
          if (sha === headSha) {
            await run(['symbolic-ref', 'HEAD', ref], 'set HEAD')
            attached = true
            break
          }
        }
        if (!attached) await run(['update-ref', '--no-deref', 'HEAD', headSha], 'set detached HEAD')
      } else if (branches.size > 0) {
        await run(['symbolic-ref', 'HEAD', branches.keys().next().value as string], 'set HEAD')
      }
      // Index = HEAD, working tree untouched: `git status` afterwards shows exactly the
      // uncommitted state the export captured (staged/unstaged split not preserved — stated).
      await run(['reset', '--quiet', '--mixed'], 'reset index')
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => {})
    }
  }
}
