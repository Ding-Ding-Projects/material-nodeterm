import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import unzipper from 'unzipper'
import { platform as currentPlatform } from '../platform'
import { renameAtomic, writeFileAtomic } from '../fs-atomic'
import {
  dependencyManifestEntry,
  dependencyManifestFor,
  NODE_DEPENDENCY_MANIFEST,
  type NodeDependencyArchitecture,
  type NodeDependencyAvailability,
  type NodeDependencyDetails,
  type NodeDependencyInstallRecord,
  type NodeDependencyInstallResult,
  type NodeDependencyManifestEntry,
  type NodeDependencyModelInventoryEntry,
  type NodeDependencyPlatform,
  type NodeDependencyProgress,
  type NodeDependencyState
} from '../../shared/node-dependencies'

const execFileAsync = promisify(execFile)

export const NODE_DEPENDENCY_MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
export const NODE_DEPENDENCY_MAX_UNPACKED_BYTES = 1 * 1024 * 1024 * 1024
export const NODE_DEPENDENCY_MAX_REDIRECTS = 3
export const NODE_DEPENDENCY_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000

const AWS_MODEL_INVENTORY_MAX_ENTRIES = 20_000
const AWS_MODEL_INVENTORY_MAX_SERVICES = 2_000

const RECORDS_VERSION = 1

type RecordMap = Record<string, NodeDependencyInstallRecord>

const ALLOWED_TRANSITIONS: Record<NodeDependencyState, readonly NodeDependencyState[]> = {
  missing: ['checking', 'downloading', 'installing', 'repairing', 'unavailable'],
  checking: ['missing', 'downloading', 'verifying', 'ready', 'repairing', 'failed', 'unavailable', 'cancelled'],
  downloading: ['verifying', 'cancelled', 'failed', 'unavailable'],
  verifying: ['installing', 'ready', 'cancelled', 'failed'],
  installing: ['ready', 'repairing', 'cancelled', 'failed'],
  ready: ['checking', 'repairing', 'missing', 'failed', 'unavailable'],
  repairing: ['checking', 'downloading', 'verifying', 'installing', 'ready', 'cancelled', 'failed'],
  cancelled: ['checking', 'downloading', 'repairing', 'missing'],
  failed: ['checking', 'downloading', 'repairing', 'missing', 'unavailable'],
  unavailable: ['checking', 'repairing', 'missing']
}

function platformName(): NodeDependencyPlatform | null {
  if (process.platform === 'win32' || process.platform === 'linux') {
    return process.platform
  }
  return null
}

function architectureName(): NodeDependencyArchitecture | null {
  if (process.arch === 'x64' || process.arch === 'arm64') return process.arch
  return null
}

function keyFor(entry: Pick<NodeDependencyManifestEntry, 'id' | 'platform' | 'architecture'>): string {
  return `${entry.id}:${entry.platform}:${entry.architecture}`
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
}

function isSafeRelative(value: string): boolean {
  if (!value || path.isAbsolute(value)) return false
  const normalized = path.normalize(value)
  return normalized !== '..' && !normalized.startsWith(`..${path.sep}`) && !normalized.includes(`.${path.sep}`)
}

function isChildPath(root: string, candidate: string | null): candidate is string {
  if (!candidate || !path.isAbsolute(candidate)) return false
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  return resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
}

const DEPENDENCY_STATES: readonly NodeDependencyState[] = [
  'missing', 'checking', 'downloading', 'verifying', 'installing', 'ready', 'repairing',
  'cancelled', 'failed', 'unavailable'
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function validResume(value: unknown): value is NodeDependencyInstallRecord['resume'] {
  if (value === null) return true
  if (!isRecord(value)) return false
  if (!isUuid(value.operationId) || !DEPENDENCY_STATES.includes(value.phase as NodeDependencyState)) return false
  const phaseLimit = value.phase === 'downloading' || value.phase === 'verifying'
    ? NODE_DEPENDENCY_MAX_ARCHIVE_BYTES
    : NODE_DEPENDENCY_MAX_UNPACKED_BYTES
  if (typeof value.completedBytes !== 'number' || !Number.isSafeInteger(value.completedBytes) || value.completedBytes < 0 || value.completedBytes > phaseLimit) return false
  if (value.totalBytes !== null && (typeof value.totalBytes !== 'number' || !Number.isSafeInteger(value.totalBytes) || value.totalBytes < value.completedBytes || value.totalBytes > phaseLimit)) return false
  return typeof value.canResume === 'boolean'
}

/** Validate before a persisted row can enter RecordMap. The map key and manifest tuple are part of
 * the record's identity, so a row copied from another version or dependency cannot be adopted. */
function validPersistedRecord(
  mapKey: string,
  value: unknown,
  installsDir: string
): value is NodeDependencyInstallRecord {
  if (!isRecord(value)) return false
  const id = value.id
  const version = value.version
  const targetPlatform = value.platform
  const architecture = value.architecture
  const state = value.state
  if (typeof id !== 'string' || typeof version !== 'string' || typeof targetPlatform !== 'string' || typeof architecture !== 'string') return false
  if (typeof state !== 'string' || !DEPENDENCY_STATES.includes(state as NodeDependencyState)) return false
  const entry = NODE_DEPENDENCY_MANIFEST.find(
    (candidate) => candidate.id === id && candidate.version === version && candidate.platform === targetPlatform && candidate.architecture === architecture
  )
  if (!entry || mapKey !== keyFor(entry)) return false
  if (value.schemaVersion !== 1 || (value.archiveSha256 !== null && !isSha256(value.archiveSha256))) return false
  if (typeof value.installPath !== 'string' && value.installPath !== null) return false
  if (typeof value.executablePath !== 'string' && value.executablePath !== null) return false
  const expectedInstall = path.join(installsDir, `${entry.id}-${entry.version}-${entry.platform}-${entry.architecture}`)
  if (value.installPath !== null && path.resolve(value.installPath) !== path.resolve(expectedInstall)) return false
  const expectedExecutable = path.join(expectedInstall, entry.healthProbe.relativePath)
  if (value.executablePath !== null && (!value.installPath || !isChildPath(value.installPath, value.executablePath) || path.resolve(value.executablePath) !== path.resolve(expectedExecutable))) return false
  if (state === 'ready' && (value.installPath === null || value.executablePath === null || value.resume !== null)) return false
  if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) || value.updatedAt < 0) return false
  if (typeof value.error !== 'string' && value.error !== null) return false
  if (typeof value.error === 'string' && value.error.length > 4096) return false
  if (value.archiveSource !== undefined && value.archiveSource !== null &&
    value.archiveSource !== 'bundled' && value.archiveSource !== 'verified-cache' && value.archiveSource !== 'verified-download') return false
  return validResume(value.resume)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function awsCliVersion(output: string): string | null {
  const match = /^aws-cli\/(\d+\.\d+\.\d+)\b/u.exec(output.trim())
  return match?.[1] ?? null
}

function dependencyVersion(id: string, output: string): string | null {
  if (id === 'aws-cli-v2') return awsCliVersion(output)
  const match = /^v?(\d+\.\d+\.\d+)\b/u.exec(output.trim())
  return match?.[1] ?? null
}

function aborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Dependency installation was cancelled.')
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target)
    return true
  } catch {
    return false
  }
}

async function removeBestEffort(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }).catch(() => undefined)
}

/** Local, privileged lifecycle service. It never accepts a URL, executable, or shell command from
 * the renderer. The only source and probe values are selected from the immutable shared manifest. */
export class NodeDependencyService {
  private readonly root: string
  private readonly recordsFile: string
  private readonly cacheDir: string
  private readonly installsDir: string
  private records: RecordMap | null = null
  private readonly operations = new Map<string, { id: string; controller: AbortController }>()
  private readonly tails = new Map<string, Promise<unknown>>()

  constructor(
    private readonly onState: (value: NodeDependencyAvailability) => void = () => undefined,
    private readonly onProgress: (value: NodeDependencyProgress) => void = () => undefined
  ) {
    const userData = currentPlatform().userDataDir
    this.root = path.join(userData, 'node-dependencies')
    this.recordsFile = path.join(this.root, 'records.json')
    this.cacheDir = path.join(this.root, 'cache')
    this.installsDir = path.join(this.root, 'installs')
  }

  private async loadRecords(): Promise<RecordMap> {
    if (this.records) return this.records
    try {
      const body = await fs.readFile(this.recordsFile, 'utf8')
      const parsed = JSON.parse(body) as { schemaVersion?: unknown; records?: unknown }
      if (parsed.schemaVersion !== RECORDS_VERSION || !isRecord(parsed.records)) {
        throw new Error('Dependency records have an unsupported schema.')
      }
      const valid: RecordMap = {}
      for (const [mapKey, value] of Object.entries(parsed.records)) {
        if (validPersistedRecord(mapKey, value, this.installsDir)) valid[mapKey] = value
      }
      // Unknown and malformed rows are deliberately ignored. They never enter the typed map and
      // therefore can never steer a state transition, probe an external path, or reach the UI.
      this.records = valid
    } catch (error) {
      // A corrupt or unreadable record document is not readiness evidence. Start from an empty
      // in-memory map and let the next successful mutation replace it with a valid document. The
      // raw rows never enter RecordMap, so unknown states cannot reach ALLOWED_TRANSITIONS.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.records = {}
        return this.records
      }
      this.records = {}
    }
    return this.records
  }

  private async saveRecords(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true })
    await writeFileAtomic(
      this.recordsFile,
      JSON.stringify({ schemaVersion: RECORDS_VERSION, records: this.records ?? {} }, null, 2),
      { mode: 0o600 }
    )
  }

  private recordFor(entry: NodeDependencyManifestEntry): NodeDependencyInstallRecord {
    const existing = this.records?.[keyFor(entry)]
    return existing ?? {
      schemaVersion: 1,
      id: entry.id,
      version: entry.version,
      platform: entry.platform,
      architecture: entry.architecture,
      state: 'missing',
      archiveSha256: null,
      installPath: null,
      executablePath: null,
      updatedAt: Date.now(),
      error: null,
      resume: null,
      archiveSource: null
    }
  }

  private async putRecord(entry: NodeDependencyManifestEntry, patch: Partial<NodeDependencyInstallRecord>): Promise<NodeDependencyInstallRecord> {
    const records = await this.loadRecords()
    const next = { ...this.recordFor(entry), ...patch, updatedAt: Date.now() }
    records[keyFor(entry)] = next
    await this.saveRecords()
    // Persistence is the lifecycle result. A notification subscriber must not turn a durable
    // record into a failed install after the target has already been published.
    try {
      this.onState(await this.availability(entry, next))
    } catch {
      // The next catalog/status read remains authoritative.
    }
    return next
  }

  private async transition(
    entry: NodeDependencyManifestEntry,
    state: NodeDependencyState,
    patch: Partial<NodeDependencyInstallRecord> = {}
  ): Promise<NodeDependencyInstallRecord> {
    const current = this.recordFor(entry)
    if (current.state !== state && !ALLOWED_TRANSITIONS[current.state].includes(state)) {
      throw new Error(`Invalid dependency state transition ${current.state} -> ${state}.`)
    }
    return this.putRecord(entry, { ...patch, state })
  }

  private emitProgress(
    operationId: string,
    entry: NodeDependencyManifestEntry,
    state: NodeDependencyState,
    completedBytes: number,
    totalBytes: number | null,
    message: string
  ): void {
    this.onProgress({ operationId, id: entry.id, state, completedBytes, totalBytes, message })
  }

  private async availability(
    entry: NodeDependencyManifestEntry,
    record: NodeDependencyInstallRecord | null = null
  ): Promise<NodeDependencyAvailability> {
    const current = record ?? this.records?.[keyFor(entry)] ?? null
    if (!current) {
      return { manifest: entry, record: null, state: 'missing', available: false, executablePath: null, disabledReason: 'This dependency is not installed yet. Install it to continue.', resume: null }
    }
    const safeInstallPath = isChildPath(this.installsDir, current.installPath) ? current.installPath : null
    const safeExecutablePath = safeInstallPath && current.executablePath && isChildPath(safeInstallPath, current.executablePath)
      ? current.executablePath
      : null
    const publicRecord = safeInstallPath === current.installPath && safeExecutablePath === current.executablePath
      ? current
      : { ...current, installPath: safeInstallPath, executablePath: safeExecutablePath }
    const available = current.state === 'ready' && !!safeExecutablePath && await this.probe(entry, safeInstallPath)
    if (available) {
      return { manifest: entry, record: publicRecord, state: 'ready', available: true, executablePath: safeExecutablePath, disabledReason: null, resume: current.resume }
    }
    const reason = current.error ?? (current.state === 'ready'
      ? 'The installed dependency failed its health probe and needs repair.'
      : current.state === 'unavailable'
        ? 'This dependency is unavailable on the current platform or architecture.'
        : current.state === 'cancelled'
          ? 'Installation was cancelled before the dependency became ready.'
          : `Dependency installation is ${current.state}.`)
    return { manifest: entry, record: publicRecord, state: current.state, available: false, executablePath: null, disabledReason: reason, resume: current.resume }
  }

  async catalog(): Promise<NodeDependencyAvailability[]> {
    await this.loadRecords()
    const detectedPlatform = platformName()
    const detectedArchitecture = architectureName()
    if (!detectedPlatform || !detectedArchitecture) {
      const seen = new Set<string>()
      return Promise.all(
        NODE_DEPENDENCY_MANIFEST
          .filter((entry) => {
            if (seen.has(entry.id)) return false
            seen.add(entry.id)
            return true
          })
          .map((entry) => ({
            manifest: entry,
            record: null,
            state: 'unavailable' as const,
            available: false,
            executablePath: null,
            disabledReason: `Dependency '${entry.id}' is not available for ${String(process.platform)}/${String(process.arch)}.`,
            resume: null
          }))
      )
    }
    const entries = dependencyManifestFor(detectedPlatform, detectedArchitecture)
    return Promise.all(entries.map((entry) => this.availability(entry)))
  }

  async status(id: string): Promise<NodeDependencyAvailability> {
    await this.loadRecords()
    const detectedPlatform = platformName()
    const detectedArchitecture = architectureName()
    const entry = detectedPlatform && detectedArchitecture
      ? dependencyManifestEntry(id, detectedPlatform, detectedArchitecture)
      : null
    if (!entry) {
      const fallback = NODE_DEPENDENCY_MANIFEST.find((candidate) => candidate.id === id)
      if (!fallback) throw new Error(`Dependency '${id}' is not registered in the built-in manifest.`)
      const reason = `Dependency '${id}' is not available for ${String(process.platform)}/${String(process.arch)}.`
      return { manifest: fallback, record: null, state: 'unavailable', available: false, executablePath: null, disabledReason: reason, resume: null }
    }
    return this.availability(entry)
  }

  async details(id: string): Promise<NodeDependencyDetails> {
    const dependency = await this.status(id)
    const archiveSource = dependency.record?.archiveSource ?? null
    if (!dependency.available || !dependency.executablePath) {
      return { dependency, version: null, versionOutput: null, archiveSource, models: [], modelCount: 0, inventoryComplete: false, inventoryError: dependency.disabledReason }
    }

    let versionOutput: string
    try {
      const result = await execFileAsync(dependency.executablePath, ['--version'], { timeout: 10_000, windowsHide: true, encoding: 'utf8' })
      versionOutput = String(result.stdout || result.stderr).trim()
    } catch (error) {
      return { dependency, version: null, versionOutput: null, archiveSource, models: [], modelCount: 0, inventoryComplete: false, inventoryError: `AWS CLI version probe failed: ${errorMessage(error)}` }
    }
    const version = dependencyVersion(id, versionOutput)
    if (version !== dependency.manifest.version) {
      return {
        dependency,
        version,
        versionOutput,
        archiveSource,
        models: [],
        modelCount: 0,
        inventoryComplete: false,
        inventoryError: `Dependency reported version ${version ?? 'unknown'}; expected ${dependency.manifest.version}.`
      }
    }
    if (id !== 'aws-cli-v2') {
      return { dependency, version, versionOutput, archiveSource, models: [], modelCount: 0, inventoryComplete: true, inventoryError: null }
    }

    const root = path.join(path.dirname(dependency.executablePath), 'awscli', 'botocore', 'data')
    const models: NodeDependencyModelInventoryEntry[] = []
    let visited = 0
    let visitedServices = 0
    try {
      for (const serviceEntry of await fs.readdir(root, { withFileTypes: true })) {
        if (!serviceEntry.isDirectory()) continue
        visitedServices += 1
        if (visitedServices > AWS_MODEL_INVENTORY_MAX_SERVICES) throw new Error('AWS CLI model inventory exceeded its service limit.')
        const serviceRoot = path.join(root, serviceEntry.name)
        const versions: string[] = []
        let modelFileCount = 0
        for (const versionEntry of await fs.readdir(serviceRoot, { withFileTypes: true })) {
          if (!versionEntry.isDirectory()) continue
          const files = await fs.readdir(path.join(serviceRoot, versionEntry.name), { withFileTypes: true })
          visited += files.length
          if (visited > AWS_MODEL_INVENTORY_MAX_ENTRIES) throw new Error('AWS CLI model inventory exceeded its file limit.')
          const count = files.filter((file) => file.isFile() && /^service-2(?:\.sdk-extras)?\.json(?:\.gz)?$/u.test(file.name)).length
          if (count > 0) {
            versions.push(versionEntry.name)
            modelFileCount += count
          }
        }
        if (versions.length) models.push({ service: serviceEntry.name, versions: versions.sort(), modelFileCount })
      }
      models.sort((left, right) => left.service.localeCompare(right.service))
      const complete = models.length > 0
      return {
        dependency,
        version,
        versionOutput,
        archiveSource,
        models,
        modelCount: models.reduce((total, item) => total + item.modelFileCount, 0),
        inventoryComplete: complete,
        inventoryError: complete ? null : 'AWS CLI model inventory contained no service models.'
      }
    } catch (error) {
      return { dependency, version, versionOutput, archiveSource, models: [], modelCount: 0, inventoryComplete: false, inventoryError: errorMessage(error) }
    }
  }

  async reconcile(): Promise<NodeDependencyAvailability[]> {
    await this.loadRecords()
    const detectedPlatform = platformName()
    const detectedArchitecture = architectureName()
    if (!detectedPlatform || !detectedArchitecture) return this.catalog()
    const entries = dependencyManifestFor(detectedPlatform, detectedArchitecture)
    for (const entry of entries) {
      const record = this.records?.[keyFor(entry)]
      if (!record) continue
      if (record.state === 'ready' && !(await this.probe(entry, record.installPath))) {
        await this.transition(entry, 'missing', { installPath: null, executablePath: null, error: 'The installed dependency is missing or failed its health probe.' })
      }
    }
    return this.catalog()
  }

  async cancel(operationId: string): Promise<boolean> {
    const operation = this.operations.get(operationId)
    if (!operation) return false
    operation.controller.abort()
    return true
  }

  install(id: string): Promise<NodeDependencyInstallResult> {
    return this.start(id, false)
  }

  repair(id: string): Promise<NodeDependencyInstallResult> {
    return this.start(id, true)
  }

  private start(id: string, repair: boolean): Promise<NodeDependencyInstallResult> {
    const detectedPlatform = platformName()
    const detectedArchitecture = architectureName()
    const entry = detectedPlatform && detectedArchitecture
      ? dependencyManifestEntry(id, detectedPlatform, detectedArchitecture)
      : null
    if (!entry) {
      const fallback = NODE_DEPENDENCY_MANIFEST.find((candidate) => candidate.id === id)
      if (!fallback) {
        return Promise.reject(new Error(`Dependency '${id}' is not registered in the built-in manifest.`))
      }
      return Promise.resolve({ ok: false, operationId: null, dependency: {
        manifest: fallback, record: null, state: 'unavailable', available: false,
        executablePath: null, disabledReason: `Dependency '${id}' is not available for ${String(process.platform)}/${String(process.arch)}.`, resume: null
      }, error: 'No manifest entry exists for the current platform and architecture.' })
    }
    const key = keyFor(entry)
    const previous = this.tails.get(key) ?? Promise.resolve()
    const operation = previous.then(() => this.installOne(entry, repair))
    const tail = operation.then(() => undefined, () => undefined)
    this.tails.set(key, tail)
    void tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key) })
    return operation
  }

  private async installOne(entry: NodeDependencyManifestEntry, repair: boolean): Promise<NodeDependencyInstallResult> {
    const operationId = randomUUID()
    const controller = new AbortController()
    this.operations.set(operationId, { id: entry.id, controller })
    let record = this.recordFor(entry)
    let archiveStage: string | null = null
    let installStage: string | null = null
    try {
      record = await this.transition(entry, repair ? 'repairing' : 'checking', { error: null, resume: null })
      this.emitProgress(operationId, entry, record.state, 0, null, repair ? 'Checking the existing installation.' : 'Checking the dependency manifest.')
      if (entry.installMode === 'bundled' && !entry.bundledSource) {
        throw new Error('This dependency is bundled-only and has no installable source.')
      }
      if (!repair && record.state === 'checking' && record.installPath) {
        aborted(controller.signal)
        const healthy = await this.probe(entry, record.installPath)
        aborted(controller.signal)
        if (!healthy) {
          record = await this.transition(entry, 'missing', { installPath: null, executablePath: null, error: 'The installed dependency is missing or failed its health probe.' })
        }
      }
      if (!repair && record.state === 'checking' && record.installPath) {
        aborted(controller.signal)
        record = await this.transition(entry, 'ready', { executablePath: path.join(record.installPath, entry.healthProbe.relativePath), error: null })
        aborted(controller.signal)
        return { ok: true, operationId, dependency: await this.availability(entry, record), error: null }
      }

      await fs.mkdir(this.cacheDir, { recursive: true })
      await fs.mkdir(this.installsDir, { recursive: true })
      const cachePath = path.join(this.cacheDir, `${entry.id}-${entry.version}-${entry.platform}-${entry.architecture}.${entry.archiveFormat.replace('.', '-')}`)
      let archivePath: string | null = null
      let archiveSource: NodeDependencyInstallRecord['archiveSource'] = record.archiveSource ?? null
      const resourcesPath = currentPlatform().resourcesPath
      if (entry.bundledSource && resourcesPath && isSafeRelative(entry.bundledSource)) {
        const resourceRoot = path.resolve(resourcesPath)
        const bundled = path.resolve(resourceRoot, entry.bundledSource)
        if (bundled === resourceRoot || !bundled.startsWith(`${resourceRoot}${path.sep}`)) {
          throw new Error('The bundled dependency source escapes the packaged resources directory.')
        }
        if (await pathExists(bundled)) {
          const bundleStage = `${cachePath}.${process.pid}.${randomUUID()}.bundle.part`
          try {
            await fs.copyFile(bundled, bundleStage)
            if (await this.verifySha(bundleStage, entry.sha256, controller.signal)) {
              await removeBestEffort(cachePath)
              await renameAtomic(bundleStage, cachePath)
              archiveSource = 'bundled'
            }
          } finally {
            await removeBestEffort(bundleStage)
          }
        }
      }
      if (await pathExists(cachePath) && await this.verifySha(cachePath, entry.sha256, controller.signal)) {
        archivePath = cachePath
        archiveSource ??= 'verified-cache'
        record = await this.transition(entry, 'verifying', { archiveSha256: entry.sha256, resume: null })
        this.emitProgress(operationId, entry, 'verifying', 0, null, 'Reusing the verified dependency cache.')
      } else {
        if (entry.installMode === 'bundled') {
          throw new Error('Bundled dependency is missing or failed verification; refusing network installation.')
        }
        await removeBestEffort(cachePath)
        archiveStage = path.join(this.cacheDir, `.${entry.id}.${process.pid}.${randomUUID()}.part`)
        record = await this.transition(entry, 'downloading', { resume: { operationId, phase: 'downloading', completedBytes: 0, totalBytes: null, canResume: false } })
        await this.obtainArchive(entry, archiveStage, operationId, controller.signal)
        aborted(controller.signal)
        if (!(await this.verifySha(archiveStage, entry.sha256, controller.signal))) {
          await removeBestEffort(archiveStage)
          archiveStage = null
          await removeBestEffort(cachePath)
          throw new Error('The downloaded dependency archive failed its SHA-256 verification.')
        }
        aborted(controller.signal)
        await renameAtomic(archiveStage, cachePath)
        archiveStage = null
        archiveSource = 'verified-download'
        record = await this.transition(entry, 'verifying', { archiveSha256: entry.sha256, resume: null })
        archivePath = cachePath
      }

      aborted(controller.signal)
      installStage = await fs.mkdtemp(path.join(this.installsDir, `.${entry.id}.${process.pid}.`))
      record = await this.transition(entry, 'installing', { resume: { operationId, phase: 'installing', completedBytes: 0, totalBytes: entry.unpackedSizeBytes, canResume: false } })
      this.emitProgress(operationId, entry, 'installing', 0, entry.unpackedSizeBytes, 'Extracting the verified dependency.')
      await this.extract(entry, archivePath!, installStage, controller.signal, operationId)
      const payloadRoot = await this.locatePayloadRoot(entry, installStage)
      for (const expected of entry.expectedFiles) {
        if (!isSafeRelative(expected) || !(await pathExists(path.join(payloadRoot, expected)))) {
          throw new Error(`Dependency archive did not contain the expected file ${expected}.`)
        }
      }
      const target = path.join(this.installsDir, `${entry.id}-${entry.version}-${entry.platform}-${entry.architecture}`)
      const backup = `${target}.${process.pid}.${randomUUID()}.previous`
      let movedOld = false
      let readyDurablyRecorded = false
      aborted(controller.signal)
      if (await pathExists(target)) {
        await renameAtomic(target, backup)
        movedOld = true
      }
      try {
        aborted(controller.signal)
        await renameAtomic(payloadRoot, target)
        aborted(controller.signal)
        const healthy = await this.probe(entry, target)
        aborted(controller.signal)
        if (!healthy) throw new Error('The published dependency failed its health probe.')
        // The cancellation fence is deliberately immediately before the durable ready record.
        // Once this write succeeds, a late cancellation cannot delete a healthy published target.
        aborted(controller.signal)
        record = await this.transition(entry, 'ready', { installPath: target, executablePath: path.join(target, entry.healthProbe.relativePath), archiveSha256: entry.sha256, archiveSource, error: null, resume: null })
        readyDurablyRecorded = true
        // Rollback material is retained until the record above is durable. Cleanup is best effort;
        // leaving a previous backup is safe and never changes the recorded ready target.
        if (movedOld) await removeBestEffort(backup)
        this.emitProgress(operationId, entry, 'ready', entry.unpackedSizeBytes, entry.unpackedSizeBytes, 'Dependency is ready.')
        return { ok: true, operationId, dependency: await this.availability(entry, record), error: null }
      } catch (error) {
        if (readyDurablyRecorded) {
          return { ok: true, operationId, dependency: await this.availability(entry, record), error: null }
        }
        await removeBestEffort(target)
        if (movedOld && await pathExists(backup)) await renameAtomic(backup, target).catch(() => undefined)
        throw error
      }
    } catch (error) {
      const cancelled = controller.signal.aborted || /cancelled/i.test(errorMessage(error))
      const state: NodeDependencyState = cancelled ? 'cancelled' : 'failed'
      const current = this.recordFor(entry)
      record = await this.transition(entry, state, { error: cancelled ? 'Installation was cancelled before the dependency became ready.' : errorMessage(error), executablePath: null })
      this.emitProgress(operationId, entry, state, record.resume?.completedBytes ?? 0, record.resume?.totalBytes ?? null, record.error ?? state)
      return { ok: false, operationId, dependency: await this.availability(entry, record), error: record.error }
    } finally {
      this.operations.delete(operationId)
      if (archiveStage) await removeBestEffort(archiveStage)
      if (installStage) await removeBestEffort(installStage)
    }
  }

  private async obtainArchive(entry: NodeDependencyManifestEntry, destination: string, operationId: string, signal: AbortSignal): Promise<void> {
    const source = new URL(entry.source)
    if (source.protocol !== 'https:' || source.username || source.password) throw new Error('Dependency source must be a canonical HTTPS URL without credentials.')
    let url = source
    let response: Response | null = null
    let cleanupRequest: (() => void) | null = null
    for (let redirects = 0; redirects <= NODE_DEPENDENCY_MAX_REDIRECTS; redirects++) {
      aborted(signal)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), NODE_DEPENDENCY_DOWNLOAD_TIMEOUT_MS)
      const onAbort = () => controller.abort()
      signal.addEventListener('abort', onAbort, { once: true })
      const closeRequest = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      }
      cleanupRequest = closeRequest
      try {
        response = await fetch(url, { redirect: 'manual', signal: controller.signal })
      } catch (error) {
        closeRequest()
        cleanupRequest = null
        throw error
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        try {
          // A redirect response can own an unread body. Cancel it before creating the next
          // request so a slow intermediary cannot keep a stream and its resources alive while the
          // redirect chain advances.
          await response.body?.cancel()
          if (!location) throw new Error('Dependency source returned a redirect without a location.')
          const redirected = new URL(location, url)
          if (redirected.protocol !== 'https:' || redirected.origin !== source.origin) throw new Error('Dependency source redirected away from its canonical HTTPS origin.')
          url = redirected
          continue
        } finally {
          closeRequest()
          cleanupRequest = null
        }
      }
      // Keep this request's controller and deadline alive through the entire response body below.
      // It is closed only after the stream, file handle, and reader have all settled.
      if (!response.ok || !response.body) {
        closeRequest()
        cleanupRequest = null
      }
      break
    }
    if (!response || !response.ok || !response.body) throw new Error(`Dependency download returned HTTP ${response?.status ?? 'no response'}.`)
    const declared = Number(response.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > NODE_DEPENDENCY_MAX_ARCHIVE_BYTES) {
      cleanupRequest?.()
      cleanupRequest = null
      throw new Error('Dependency archive exceeds the download size limit.')
    }
    let handle: FileHandle
    try {
      handle = await fs.open(destination, 'wx', 0o600)
    } catch (error) {
      cleanupRequest?.()
      cleanupRequest = null
      throw error
    }
    let completed = 0
    const reader = response.body.getReader()
    try {
      while (true) {
        aborted(signal)
        const chunk = await reader.read()
        if (chunk.done) break
        const bytes = Buffer.from(chunk.value)
        completed += bytes.byteLength
        if (completed > NODE_DEPENDENCY_MAX_ARCHIVE_BYTES) throw new Error('Dependency archive exceeds the download size limit.')
        await handle.write(bytes)
        this.emitProgress(operationId, entry, 'downloading', completed, Number.isFinite(declared) ? declared : null, 'Downloading the dependency archive.')
      }
    } finally {
      await reader.cancel().catch(() => undefined)
      await handle.close()
      // The request timeout remains active until the body stream is finished or cancelled.
      // `closeRequest` is attached to the final response below rather than cleared after headers.
      cleanupRequest?.()
      cleanupRequest = null
    }
  }

  private async verifySha(file: string, expected: string, signal: AbortSignal): Promise<boolean> {
    if (!isSha256(expected)) return false
    const hash = createHash('sha256')
    const input = await fs.open(file, 'r')
    try {
      const buffer = Buffer.allocUnsafe(1024 * 1024)
      while (true) {
        aborted(signal)
        const { bytesRead } = await input.read(buffer, 0, buffer.length, null)
        if (bytesRead === 0) break
        hash.update(buffer.subarray(0, bytesRead))
      }
    } finally {
      await input.close()
    }
    return hash.digest('hex').toLowerCase() === expected.toLowerCase()
  }

  private async extract(entry: NodeDependencyManifestEntry, archive: string, destination: string, signal: AbortSignal, operationId: string): Promise<void> {
    if (entry.archiveFormat === 'msi') {
      if (process.platform !== 'win32') throw new Error('MSI extraction is available only on Windows.')
      aborted(signal)
      await execFileAsync('msiexec.exe', ['/a', archive, '/qn', '/norestart', `TARGETDIR=${destination}`], {
        timeout: NODE_DEPENDENCY_DOWNLOAD_TIMEOUT_MS,
        windowsHide: true,
        encoding: 'utf8'
      })
      aborted(signal)
      this.emitProgress(operationId, entry, 'installing', entry.unpackedSizeBytes, entry.unpackedSizeBytes, 'Extracted the verified MSI payload.')
      return
    }
    if (entry.archiveFormat !== 'zip') throw new Error(`Archive format ${entry.archiveFormat} is not supported by this packaged installer.`)
    const directory = await unzipper.Open.file(archive)
    let unpacked = 0
    for (const item of directory.files) {
      aborted(signal)
      if (!isSafeRelative(item.path)) throw new Error('Dependency archive contains an unsafe path.')
      if (item.type !== 'File' && item.type !== 'Directory') throw new Error('Dependency archive contains an unsupported entry type.')
      const target = path.resolve(destination, item.path)
      if (target !== destination && !target.startsWith(`${path.resolve(destination)}${path.sep}`)) throw new Error('Dependency archive escapes its staging directory.')
      if (item.type === 'Directory') {
        await fs.mkdir(target, { recursive: true })
        continue
      }
      await fs.mkdir(path.dirname(target), { recursive: true })
      await pipeline(item.stream(), createWriteStream(target, { flags: 'wx', mode: 0o700 }))
      const stats = await fs.stat(target)
      unpacked += stats.size
      if (unpacked > NODE_DEPENDENCY_MAX_UNPACKED_BYTES) throw new Error('Dependency archive exceeds the unpacked size limit.')
      this.emitProgress(operationId, entry, 'installing', unpacked, entry.unpackedSizeBytes, 'Extracting the verified dependency.')
    }
  }

  private async locatePayloadRoot(entry: NodeDependencyManifestEntry, staging: string): Promise<string> {
    const expected = entry.healthProbe.relativePath
    const direct = path.join(staging, expected)
    if (await pathExists(direct)) return staging
    const queue = [staging]
    let visited = 0
    while (queue.length && visited < 100_000) {
      const root = queue.shift()!
      for (const name of await fs.readdir(root)) {
        const candidate = path.join(root, name)
        const stat = await fs.lstat(candidate)
        if (stat.isSymbolicLink()) throw new Error('Dependency archive contains a symbolic link.')
        if (stat.isDirectory()) queue.push(candidate)
        else if (name === expected) return path.dirname(candidate)
        visited++
      }
    }
    throw new Error(`Dependency archive did not contain the expected file ${expected}.`)
  }

  private async probe(entry: NodeDependencyManifestEntry, installPath: string | null): Promise<boolean> {
    if (!isChildPath(this.installsDir, installPath) || !isSafeRelative(entry.healthProbe.relativePath)) return false
    const file = path.join(installPath, entry.healthProbe.relativePath)
    try {
      const stat = await fs.stat(file)
      if (!stat.isFile()) return false
      if (entry.healthProbe.kind === 'file') return true
      const result = await execFileAsync(file, [...(entry.healthProbe.args ?? [])], { timeout: 10_000, windowsHide: true, encoding: 'utf8' })
      const output = String(result.stdout || result.stderr).trim()
      if (typeof entry.healthProbe.expectedVersion === 'string' && output !== entry.healthProbe.expectedVersion) return false
      return typeof entry.healthProbe.expectedVersionPrefix !== 'string' || output.startsWith(entry.healthProbe.expectedVersionPrefix)
    } catch {
      return false
    }
  }
}
