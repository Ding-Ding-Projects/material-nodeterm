import { createRequire } from 'node:module'
import { access, copyFile, lstat, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { constants as fsConstants, statfsSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  isMagnetUri,
  parseMagnetUri,
  validateTorrentBencode,
  WEBTORRENT_RUNTIME_DESCRIPTOR,
  normalizeSeedPolicy,
  safeTorrentRelativePath,
  TORRENT_DEFAULT_SEED_POLICY,
  TORRENT_MAX_FILES,
  TORRENT_MAX_SEED_MINUTES,
  TORRENT_MAX_SEED_RATIO,
  TORRENT_MAX_SOURCE_BYTES,
  TORRENT_PIECE_OVERHEAD_BYTES,
  TORRENT_DESTROY_TIMEOUT_MS,
  TORRENT_MAX_TASKS,
  TORRENT_MAX_ACTIVE_HANDLES,
  redactTorrentTask,
  type TorrentAddInput,
  type TorrentApi,
  type TorrentDestinationPreflight,
  type TorrentFileInfo,
  type TorrentSeedPolicy,
  type TorrentTaskState,
  type TorrentTaskStatus,
  type TorrentSourceKind
} from '../../shared/torrent'

const STORE_VERSION = 1

interface TorrentFileLike {
  path?: string
  name?: string
  length?: number
  downloaded?: number
  select?: () => void
  deselect?: () => void
}

interface TorrentLike {
  name?: string
  length?: number
  downloaded?: number
  uploaded?: number
  ratio?: number
  progress?: number
  downloadSpeed?: number
  numPeers?: number
  timeRemaining?: number
  done?: boolean
  files?: TorrentFileLike[]
  pause?: () => void
  resume?: () => void
  destroy?: (opts?: { destroyStore?: boolean }, cb?: (error?: Error) => void) => void
  on?: (event: string, listener: (...args: any[]) => void) => void
}

interface WebTorrentClientLike {
  add: (source: string, opts?: { path?: string; paused?: boolean }, cb?: (torrent: TorrentLike) => void) => TorrentLike
  destroy?: (cb?: (error?: Error) => void) => void
}

type WebTorrentCtor = new (opts?: Record<string, unknown>) => WebTorrentClientLike

interface PersistedStore {
  version: number
  tasks: TorrentTaskState[]
}

export interface TorrentServiceOptions {
  userDataDir: string
  resourcesPath?: string
  isPackaged?: boolean
  onTask?: (task: TorrentTaskState) => void
  runtimeCtor?: WebTorrentCtor
  quotaBytes?: number
  onHistory?: (event: { action: 'created' | 'updated' | 'deleted' | 'restored'; label: string; content: string }) => Promise<void>
}

function clampStatus(status: unknown): TorrentTaskStatus {
  return status === 'metadata' || status === 'downloading' || status === 'paused' || status === 'recoverable-paused' || status === 'completed' || status === 'seeding' || status === 'stopped' || status === 'cancelled' || status === 'failed'
    ? status
    : 'queued'
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function safeTask(task: TorrentTaskState): TorrentTaskState {
  const files = Array.isArray(task.files)
    ? task.files
        .map((file) => {
          const path = file.path
          if (!safeTorrentRelativePath(path)) return null
          return {
            path: path.replaceAll('\\', '/'),
            name: typeof file.name === 'string' && file.name.length <= 1024 ? file.name : path,
            sizeBytes: finiteNumber(file.sizeBytes),
            selected: file.selected === true,
            downloadedBytes: Math.min(finiteNumber(file.downloadedBytes), finiteNumber(file.sizeBytes))
          }
        })
        .filter((file): file is NonNullable<typeof file> => file !== null)
        .slice(0, TORRENT_MAX_FILES)
    : []
  return {
    ...task,
    id: typeof task.id === 'string' && task.id.length < 200 ? task.id : randomUUID(),
    nodeId: typeof task.nodeId === 'string' && task.nodeId.length < 200 ? task.nodeId : '',
    sourceKind: task.sourceKind === 'torrent-file' ? 'torrent-file' : 'magnet',
    sourceRef: typeof task.sourceRef === 'string' && task.sourceRef.length <= 16_384 ? task.sourceRef : '',
    networkConsent: task.networkConsent?.accepted === true && typeof task.networkConsent.activationId === 'string' ? task.networkConsent : undefined,
    name: typeof task.name === 'string' && task.name.length <= 1024 ? task.name : 'Torrent download',
    destination: typeof task.destination === 'string' && task.destination.length <= 4096 ? task.destination : null,
    files,
    status: clampStatus(task.status),
    integrity: task.integrity === 'checking' || task.integrity === 'verified' || task.integrity === 'failed' ? task.integrity : 'unknown',
    progress: Math.min(1, finiteNumber(task.progress)),
    downloadedBytes: finiteNumber(task.downloadedBytes),
    selectedBytes: finiteNumber(task.selectedBytes),
    totalBytes: finiteNumber(task.totalBytes),
    speedBytesPerSecond: finiteNumber(task.speedBytesPerSecond),
    peers: Math.min(10_000, Math.round(finiteNumber(task.peers))),
    etaSeconds: task.etaSeconds === null ? null : finiteNumber(task.etaSeconds),
    error: typeof task.error === 'string' && task.error.length <= 2000 ? task.error : null,
    seedPolicy: normalizeSeedPolicy(task.seedPolicy),
    seedingRemainingSeconds: task.seedingRemainingSeconds === null ? null : finiteNumber(task.seedingRemainingSeconds),
    uploadedBytes: finiteNumber(task.uploadedBytes),
    ratio: finiteNumber(task.ratio),
    createdAt: finiteNumber(task.createdAt, Date.now()),
    updatedAt: finiteNumber(task.updatedAt, Date.now())
  }
}

function targetPath(destination: string, relativePath: string): string | null {
  if (!safeTorrentRelativePath(relativePath)) return null
  const root = resolve(destination)
  const target = resolve(root, relativePath)
  if (target !== root && !target.startsWith(`${root}${sep}`)) return null
  return target
}

async function rejectSymlinkComponents(destination: string, relativePaths: readonly string[]): Promise<void> {
  const root = resolve(destination)
  for (const relative of relativePaths) {
    const target = targetPath(root, relative)
    if (!target) throw new Error('One selected torrent path is unsafe and cannot be written.')
    const components = target.slice(root.length).split(sep).filter(Boolean)
    let current = root
    for (const component of components) {
      current = join(current, component)
      try {
        const info = await lstat(current)
        if (info.isSymbolicLink()) throw new Error('The destination contains a symbolic link or reparse point.')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
        throw error
      }
    }
  }
}

export class TorrentService implements TorrentApi {
  private readonly storeFile: string
  private readonly historyFile: string
  private readonly tasks = new Map<string, TorrentTaskState>()
  private readonly handles = new Map<string, TorrentLike>()
  private readonly reservations = new Map<string, number>()
  private readonly consentUses = new Map<string, { activationId: string; binding: string }>()
  private readonly owners = new Map<string, number>()
  private readonly seedTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private persistenceStatus: import('../../shared/torrent').TorrentPersistenceStatus = 'missing'
  private persistenceDetail: string | null = null
  private readonly listeners = new Set<(task: TorrentTaskState) => void>()
  private readonly taskSink?: (task: TorrentTaskState) => void
  private client: WebTorrentClientLike | null = null
  private runtimeInfo: Awaited<ReturnType<TorrentApi['runtime']>> | null = null
  private initPromise: Promise<void>
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: TorrentServiceOptions) {
    this.storeFile = join(options.userDataDir, 'torrent-downloader', 'tasks.json')
    this.historyFile = join(options.userDataDir, 'torrent-downloader', 'history.jsonl')
    this.taskSink = options.onTask
    this.initPromise = this.load()
  }

  private async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.storeFile, 'utf8')) as PersistedStore
      if (raw?.version !== STORE_VERSION || !Array.isArray(raw.tasks)) throw new Error('Torrent task state has an unsupported schema.')
      for (const task of raw.tasks) {
        const normalized = safeTask(task)
        if (normalized.id && normalized.sourceRef) {
          if (normalized.status === 'downloading' || normalized.status === 'metadata' || normalized.status === 'seeding') normalized.status = 'recoverable-paused'
          normalized.error = null
          this.tasks.set(normalized.id, normalized)
        }
      }
      this.persistenceStatus = 'loaded'
      this.persistenceDetail = null
    } catch (error) {
      // Missing or corrupt task state is a recoverable local-state failure. Keep the service usable
      // with an empty queue instead of inventing records or failing application startup.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.persistenceStatus = 'missing'
        this.persistenceDetail = null
      } else {
        this.persistenceStatus = 'corrupt'
        this.persistenceDetail = error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async persist(): Promise<void> {
    const next = async (): Promise<void> => {
      const dir = join(this.options.userDataDir, 'torrent-downloader')
      await mkdir(dir, { recursive: true })
      const temp = `${this.storeFile}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`
      const body: PersistedStore = { version: STORE_VERSION, tasks: [...this.tasks.values()].map(safeTask) }
      await writeFile(temp, JSON.stringify(body, null, 2), { encoding: 'utf8', mode: 0o600 })
      await rename(temp, this.storeFile)
    }
    this.writeQueue = this.writeQueue.then(next, next)
    await this.writeQueue
  }

  private async recordHistory(action: string, task: TorrentTaskState): Promise<void> {
    await mkdir(join(this.options.userDataDir, 'torrent-downloader'), { recursive: true })
    const line = JSON.stringify({ version: 1, action, taskId: task.id, name: task.name, status: task.status, at: Date.now() }) + '\n'
    await import('node:fs/promises').then(({ appendFile }) => appendFile(this.historyFile, line, { encoding: 'utf8', mode: 0o600 })).catch(() => undefined)
    const actionName = action === 'created' ? 'created' : action === 'removed' ? 'deleted' : 'updated'
    const historyWrite = this.options.onHistory?.({
      action: actionName,
      label: `Torrent task ${action}: ${task.name}`,
      content: JSON.stringify({ version: STORE_VERSION, tasks: [...this.tasks.values()] })
    })
    if (historyWrite) await historyWrite.catch(() => undefined)
  }

  private emit(task: TorrentTaskState): void {
    const normalized = safeTask(task)
    normalized.updatedAt = Date.now()
    this.tasks.set(normalized.id, normalized)
    this.taskSink?.(redactTorrentTask(normalized))
    for (const listener of this.listeners) listener(redactTorrentTask(normalized))
    void this.persist().catch(() => undefined)
  }

  ownerFor(taskId: string): number | undefined { return this.owners.get(taskId) }

  private isOwner(taskId: string, ownerId?: number): boolean {
    const owner = this.owners.get(taskId)
    return ownerId === undefined || owner === undefined || owner === ownerId
  }

  private async resolveRuntime(): Promise<{ ctor: WebTorrentCtor; origin: 'bundled' }> {
    if (this.options.runtimeCtor) return { ctor: this.options.runtimeCtor, origin: 'bundled' }
    if (!this.options.isPackaged || !this.options.resourcesPath) throw new Error('Bundled WebTorrent is available only from a packaged application.')
    const candidates = [
      join(this.options.resourcesPath, 'app.asar', WEBTORRENT_RUNTIME_DESCRIPTOR.packagedPath),
      join(this.options.resourcesPath, 'app.asar.unpacked', WEBTORRENT_RUNTIME_DESCRIPTOR.packagedPath)
    ]
    for (const candidate of candidates) {
      try {
        const req = createRequire(join(candidate, 'package.json'))
        const packageInfo = req('./package.json') as { version?: string }
        if (packageInfo.version !== WEBTORRENT_RUNTIME_DESCRIPTOR.version) continue
        for (const required of WEBTORRENT_RUNTIME_DESCRIPTOR.requiredFiles) req(`./${required}`)
        for (const dependency of WEBTORRENT_RUNTIME_DESCRIPTOR.requiredDependencies) req.resolve(dependency)
        const loaded = req('./index.js') as { default?: WebTorrentCtor } | WebTorrentCtor
        const ctor = (typeof loaded === 'function' ? loaded : loaded.default) as WebTorrentCtor
        if (typeof ctor === 'function') return { ctor, origin: 'bundled' }
      } catch {
        // A missing bundle is unavailable. Never consult PATH, npm, a registry or a network host.
      }
    }
    throw new Error(`Bundled WebTorrent ${WEBTORRENT_RUNTIME_DESCRIPTOR.version} is not packaged.`)
  }

  async runtime(): Promise<{ available: boolean; origin: 'bundled' | 'unavailable'; detail: string | null }> {
    await this.initPromise
    if (this.runtimeInfo) return this.runtimeInfo
    try {
      const { origin } = await this.resolveRuntime()
      this.runtimeInfo = { available: true, origin, detail: null }
      return this.runtimeInfo
    } catch (error) {
      this.runtimeInfo = { available: false, origin: 'unavailable', detail: error instanceof Error ? error.message : String(error) }
      return this.runtimeInfo
    }
  }

  private async ensureClient(task: TorrentTaskState, consent: import('../../shared/torrent').TorrentNetworkConsent | undefined): Promise<WebTorrentClientLike> {
    if (!consent?.accepted || consent.disclosed !== 'trackers-dht-peers-ip-seeding-destination' || !Number.isFinite(consent.acceptedAt) || !consent.activationId) {
      throw new Error('Explicit network consent is required before contacting trackers, DHT or peers.')
    }
    const binding = JSON.stringify({ source: task.sourceRef, destination: task.destination, selected: task.files.filter((file) => file.selected).map((file) => file.path) })
    const prior = this.consentUses.get(task.id)
    if (prior?.activationId === consent.activationId || (prior && prior.binding !== binding)) throw new Error('Network consent is stale for this torrent activation.')
    this.consentUses.set(task.id, { activationId: consent.activationId, binding })
    if (this.handles.size >= TORRENT_MAX_ACTIVE_HANDLES) throw new Error('The active torrent handle limit has been reached.')
    if (this.client) return this.client
    const { ctor } = await this.resolveRuntime()
    this.client = new ctor({ dht: true })
    return this.client
  }

  async list(nodeId?: string, ownerId?: number): Promise<TorrentTaskState[]> {
    await this.initPromise
    return [...this.tasks.values()].filter((task) => (nodeId === undefined || task.nodeId === nodeId) && (ownerId === undefined || this.owners.get(task.id) === ownerId || !this.owners.has(task.id))).map(redactTorrentTask)
  }

  async persistence(): Promise<{ status: import('../../shared/torrent').TorrentPersistenceStatus; detail: string | null }> {
    await this.initPromise
    return { status: this.persistenceStatus, detail: this.persistenceDetail }
  }

  private validateSource(kind: TorrentSourceKind, sourceRef: string): void {
    if (kind === 'magnet') {
      if (!isMagnetUri(sourceRef)) throw new Error('Enter a valid magnet URI beginning with magnet:?xt=urn:btih:')
      return
    }
    if (!sourceRef || sourceRef.length > 4096) throw new Error('Choose a torrent file with a valid local path.')
  }

  private async readTorrentSource(input: { sourceKind: TorrentSourceKind; sourceRef: string }): Promise<ReturnType<typeof validateTorrentBencode> | null> {
    this.validateSource(input.sourceKind, input.sourceRef)
    if (input.sourceKind === 'magnet') {
      parseMagnetUri(input.sourceRef)
      return null
    }
    if (input.sourceKind === 'torrent-file') {
      const info = await stat(input.sourceRef)
      if (!info.isFile()) throw new Error('The selected torrent source is not a file.')
      if (info.size > TORRENT_MAX_SOURCE_BYTES) throw new Error(`Torrent metadata is larger than the ${TORRENT_MAX_SOURCE_BYTES} byte safety limit.`)
      await access(input.sourceRef, fsConstants.R_OK)
      const bytes = await readFile(input.sourceRef)
      return validateTorrentBencode(bytes)
    }
    return null
  }

  private async stageTorrentFile(source: string): Promise<string> {
    const directory = join(this.options.userDataDir, 'torrent-downloader', 'sources')
    await mkdir(directory, { recursive: true })
    const target = join(directory, `${randomUUID()}.torrent`)
    const temporary = `${target}.${process.pid}.part`
    try {
      await copyFile(source, temporary)
      await rename(temporary, target)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
    return target
  }

  async inspect(input: { sourceKind: TorrentSourceKind; sourceRef: string }, ownerId?: number): Promise<TorrentTaskState> {
    await this.initPromise
    const metadata = await this.readTorrentSource(input)
    const sourceRef = input.sourceKind === 'torrent-file' ? await this.stageTorrentFile(input.sourceRef) : input.sourceRef
    const task = this.newTask({ nodeId: '', sourceKind: input.sourceKind, sourceRef, destination: '' })
    if (ownerId !== undefined) this.owners.set(task.id, ownerId)
    if (metadata) {
      task.name = metadata.name
      task.files = metadata.files.map((file) => ({ ...file, name: file.path.split('/').pop() ?? file.path, selected: false, downloadedBytes: 0 }))
      task.totalBytes = metadata.totalBytes
      task.integrity = 'unknown'
    }
    this.emit({ ...task, status: 'paused' })
    await this.persist()
    return redactTorrentTask(safeTask(this.tasks.get(task.id) ?? task))
  }

  private newTask(input: TorrentAddInput): TorrentTaskState {
    const now = Date.now()
    const task: TorrentTaskState = {
      id: randomUUID(),
      nodeId: input.nodeId,
      sourceKind: input.sourceKind,
      sourceRef: input.sourceRef,
      networkConsent: input.networkConsent,
      name: 'Torrent download',
      destination: input.destination || null,
      files: [],
      status: 'metadata',
      integrity: 'unknown',
      progress: 0,
      downloadedBytes: 0,
      selectedBytes: 0,
      totalBytes: 0,
      speedBytesPerSecond: 0,
      peers: 0,
      etaSeconds: null,
      error: null,
      seedPolicy: normalizeSeedPolicy(input.seedPolicy ?? TORRENT_DEFAULT_SEED_POLICY),
      seedingRemainingSeconds: null,
      uploadedBytes: 0,
      ratio: 0,
      createdAt: now,
      updatedAt: now
    }
    this.tasks.set(task.id, task)
    return task
  }

  async add(input: TorrentAddInput, ownerId?: number): Promise<TorrentTaskState> {
    await this.initPromise
    const metadata = await this.readTorrentSource(input)
    if (!input.destination || input.destination.length > 4096) throw new Error('Choose a destination folder before adding the torrent.')
    if (!input.networkConsent?.accepted) throw new Error('Review and accept the network disclosure before adding a torrent.')
    if (this.tasks.size >= TORRENT_MAX_TASKS) throw new Error('The torrent task limit has been reached.')
    await this.runtime()
    const sourceRef = input.sourceKind === 'torrent-file' ? await this.stageTorrentFile(input.sourceRef) : input.sourceRef
    const task = this.newTask({ ...input, sourceRef })
    if (metadata) {
      task.name = metadata.name
      task.files = metadata.files.map((file) => ({ ...file, name: file.path.split('/').pop() ?? file.path, selected: input.selectedPaths?.includes(file.path) ?? false, downloadedBytes: 0 }))
      task.totalBytes = metadata.totalBytes
    }
    this.tasks.set(task.id, task)
    if (ownerId !== undefined) this.owners.set(task.id, ownerId)
    task.status = 'paused'
    const initialPreflight = await this.preflight(task.id)
    if (!initialPreflight.ok) {
      this.tasks.delete(task.id)
      this.reservations.delete(task.id)
      throw new Error(initialPreflight.reason ?? 'Torrent destination preflight failed.')
    }
    // The destination and selection are the identity of the write reservation. Re-read them after
    // the awaited disk probe so a changed picker value cannot publish into an unreviewed folder.
    const current = this.tasks.get(task.id)
    if (!current || current.destination !== task.destination || current.files.some((file) => file.selected !== task.files.find((entry) => entry.path === file.path)?.selected)) {
      this.tasks.delete(task.id)
      this.reservations.delete(task.id)
      throw new Error('Torrent destination or file selection changed during preflight.')
    }
    await this.attach(task, false, input.networkConsent)
    await this.persist()
    await this.recordHistory('created', task)
    return redactTorrentTask(safeTask(this.tasks.get(task.id) ?? task))
  }

  private async attach(task: TorrentTaskState, inspectOnly: boolean, consent?: import('../../shared/torrent').TorrentNetworkConsent): Promise<void> {
    const client = await this.ensureClient(task, consent)
    const torrent = client.add(task.sourceRef, task.destination ? { path: task.destination, paused: task.status !== 'downloading' && task.status !== 'seeding' } : { paused: true })
    this.handles.set(task.id, torrent)
    const update = (): void => {
      const current = this.tasks.get(task.id)
      if (!current) return
      const engineFiles = (torrent.files ?? []).slice(0, TORRENT_MAX_FILES).map((file) => {
        const relativePath = (file.path ?? file.name ?? '').replaceAll('\\', '/')
        return {
          path: relativePath,
          name: file.name ?? relativePath,
          sizeBytes: finiteNumber(file.length),
          selected: current.files.find((entry) => entry.path === relativePath)?.selected ?? false,
          downloadedBytes: Math.min(finiteNumber(file.downloaded), finiteNumber(file.length))
        } satisfies TorrentFileInfo
      }).filter((file) => safeTorrentRelativePath(file.path))
      const files = engineFiles.length > 0 ? engineFiles : current.files
      const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0) || finiteNumber(torrent.length)
      const downloadedBytes = files.reduce((sum, file) => sum + file.downloadedBytes, 0) || finiteNumber(torrent.downloaded)
      const selectedTotal = files.filter((file) => file.selected).reduce((sum, file) => sum + file.sizeBytes, 0)
      const selectedDownloaded = files.filter((file) => file.selected).reduce((sum, file) => sum + file.downloadedBytes, 0)
      const speed = finiteNumber(torrent.downloadSpeed)
      const ratio = finiteNumber(torrent.ratio) || (downloadedBytes > 0 ? finiteNumber(torrent.uploaded) / downloadedBytes : 0)
      const progress = selectedTotal > 0 ? Math.min(1, selectedDownloaded / selectedTotal) : 0
      const selectedBytes = files.filter((file) => file.selected).reduce((sum, file) => sum + file.sizeBytes, 0)
      const status: TorrentTaskStatus = current.status === 'paused' || current.status === 'recoverable-paused' ? current.status : progress >= 1 ? (current.seedPolicy.kind === 'never' ? 'completed' : 'seeding') : 'downloading'
      this.emit({ ...current, name: torrent.name || current.name, files, totalBytes, downloadedBytes, selectedBytes, progress, speedBytesPerSecond: speed, peers: Math.round(finiteNumber(torrent.numPeers)), etaSeconds: speed > 0 && totalBytes > downloadedBytes ? Math.ceil((totalBytes - downloadedBytes) / speed) : null, uploadedBytes: finiteNumber(torrent.uploaded), ratio, integrity: progress >= 1 ? 'verified' : current.integrity, status, error: null })
      if (status === 'seeding' && current.seedPolicy.kind === 'minutes' && current.seedPolicy.minutes > 0) this.scheduleSeedTimer(task.id, current.seedPolicy.minutes)
      if (status === 'completed' && current.seedPolicy.kind === 'never') void this.stopHandle(task.id, false)
      if (status === 'seeding' && current.seedPolicy.kind === 'ratio' && ratio >= current.seedPolicy.ratio) {
        void this.stopHandle(task.id, false).then(() => {
          const latest = this.tasks.get(task.id)
          if (latest) this.emit({ ...latest, status: 'stopped', seedingRemainingSeconds: 0 })
        }).catch(() => undefined)
      }
    }
    const metadata = (): void => {
      update()
      const current = this.tasks.get(task.id)
      if (current && inspectOnly) {
        torrent.pause?.()
        this.emit({ ...current, status: 'paused' })
      }
    }
    torrent.on?.('metadata', metadata)
    torrent.on?.('download', update)
    torrent.on?.('upload', update)
    torrent.on?.('wire', update)
    torrent.on?.('done', () => {
      update()
      const current = this.tasks.get(task.id)
      if (current) this.emit({ ...current, integrity: torrent.done === false ? 'unknown' : 'verified' })
    })
    torrent.on?.('error', (error: Error) => {
      const current = this.tasks.get(task.id)
      if (current) this.emit({ ...current, status: 'failed', error: error.message.slice(0, 2000) })
    })
    update()
    if (inspectOnly) torrent.pause?.()
    else if (task.files.length === 0) torrent.pause?.()
    this.emit(this.tasks.get(task.id) ?? task)
  }

  async chooseFiles(taskId: string, selectedPaths: string[], ownerId?: number): Promise<TorrentTaskState | null> {
    await this.initPromise
    const task = this.tasks.get(taskId)
    if (!task || !this.isOwner(taskId, ownerId)) return null
    const wanted = new Set(selectedPaths.filter((path) => safeTorrentRelativePath(path)))
    const handle = this.handles.get(taskId)
    for (const file of handle?.files ?? []) {
      const path = (file.path ?? file.name ?? '').replaceAll('\\', '/')
      if (!safeTorrentRelativePath(path)) continue
      if (wanted.has(path)) file.select?.()
      else file.deselect?.()
    }
    const files = task.files.map((file) => ({ ...file, selected: wanted.has(file.path) }))
    this.emit({ ...task, files })
    await this.recordHistory('selection changed', this.tasks.get(taskId)!)
    return redactTorrentTask(safeTask(this.tasks.get(taskId)!))
  }

  async setDestination(taskId: string, destination: string, ownerId?: number): Promise<TorrentTaskState | null> {
    await this.initPromise
    const task = this.tasks.get(taskId)
    if (!task || !this.isOwner(taskId, ownerId) || !destination || destination.length > 4096 || !isAbsolute(destination) || destination.includes('\0')) return null
    this.emit({ ...task, destination })
    await this.recordHistory('destination changed', this.tasks.get(taskId)!)
    return redactTorrentTask(safeTask(this.tasks.get(taskId)!))
  }

  async preflight(taskId: string, ownerId?: number): Promise<TorrentDestinationPreflight> {
    await this.initPromise
    const task = this.tasks.get(taskId)
    const destination = task?.destination ?? ''
    const payloadBytes = task?.files.filter((file) => file.selected).reduce((sum, file) => sum + Math.max(0, file.sizeBytes - file.downloadedBytes), 0) ?? 0
    const overheadBytes = task && task.files.length > 0 ? TORRENT_PIECE_OVERHEAD_BYTES : 0
    const requiredBytes = payloadBytes + overheadBytes
    const quotaBytes = Math.max(0, this.options.quotaBytes ?? 4 * 1024 * 1024 * 1024)
    const reservedBytes = [...this.reservations.entries()].filter(([id]) => id !== taskId).reduce((sum, [, value]) => sum + value, 0)
    if (task && !this.isOwner(taskId, ownerId)) return { path: '', exists: false, writable: false, freeBytes: null, requiredBytes, overheadBytes, quotaBytes, reservedBytes, ok: false, reason: 'This torrent task belongs to another authorized client.' }
    if (!destination) return { path: destination, exists: false, writable: false, freeBytes: null, requiredBytes, overheadBytes, quotaBytes, reservedBytes, ok: false, reason: 'Choose a destination folder.' }
    if (task?.files.some((file) => file.selected && !targetPath(destination, file.path))) {
      return { path: destination, exists: true, writable: false, freeBytes: null, requiredBytes, overheadBytes, quotaBytes, reservedBytes, ok: false, reason: 'One selected torrent path is unsafe and cannot be written.' }
    }
    try {
      const info = await stat(destination)
      if (!info.isDirectory()) return { path: destination, exists: true, writable: false, freeBytes: null, requiredBytes, overheadBytes, quotaBytes, reservedBytes, ok: false, reason: 'The destination is not a folder.' }
      await access(destination, fsConstants.W_OK)
      await rejectSymlinkComponents(destination, task?.files.filter((file) => file.selected).map((file) => file.path) ?? [])
      let freeBytes: number | null = null
      try {
        const fsInfo = statfsSync(destination)
        freeBytes = Number(fsInfo.bavail) * Number(fsInfo.bsize)
      } catch {
        freeBytes = null
      }
      const enough = freeBytes !== null && freeBytes >= requiredBytes + reservedBytes && requiredBytes + reservedBytes <= quotaBytes
      if (enough) this.reservations.set(taskId, requiredBytes)
      return { path: destination, exists: true, writable: true, freeBytes, requiredBytes, overheadBytes, quotaBytes, reservedBytes, ok: enough, reason: enough ? null : freeBytes === null ? 'Available disk space is unknown; choose a destination with a readable free-space report.' : requiredBytes + reservedBytes > quotaBytes ? 'The torrent quota would be exceeded.' : 'The destination does not have enough free space for the selected files and piece overhead.' }
    } catch {
      return { path: destination, exists: false, writable: false, freeBytes: null, requiredBytes, overheadBytes, quotaBytes, reservedBytes, ok: false, reason: 'The destination folder cannot be read or written.' }
    }
  }

  private async stopHandle(taskId: string, destroyStore: boolean): Promise<void> {
    const handle = this.handles.get(taskId)
    if (!handle?.destroy) return
    await new Promise<void>((resolveDestroy, rejectDestroy) => {
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) rejectDestroy(error)
        else resolveDestroy()
      }
      const timer = setTimeout(() => finish(new Error('Torrent handle destroy timed out.')), TORRENT_DESTROY_TIMEOUT_MS)
      try { handle.destroy?.({ destroyStore }, finish) } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
    })
    this.handles.delete(taskId)
    if (this.handles.size === 0 && this.client?.destroy) {
      const client = this.client
      this.client = null
      await new Promise<void>((resolveDestroy, rejectDestroy) => {
        let settled = false
        const finish = (error?: Error): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (error) rejectDestroy(error)
          else resolveDestroy()
        }
        const timer = setTimeout(() => finish(new Error('WebTorrent client destroy timed out.')), TORRENT_DESTROY_TIMEOUT_MS)
        try { client.destroy?.(finish) } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
      })
    }
  }

  async start(taskId: string, consent?: import('../../shared/torrent').TorrentNetworkConsent, ownerId?: number): Promise<TorrentTaskState | null> {
    await this.initPromise
    const task = this.tasks.get(taskId)
    if (!task || !this.isOwner(taskId, ownerId)) return null
    if (task.files.length > 0 && !task.files.some((file) => file.selected)) {
      this.emit({ ...task, status: 'failed', error: 'Select at least one file before starting the download.' })
      return redactTorrentTask(safeTask(this.tasks.get(taskId)!))
    }
    const preflight = await this.preflight(taskId, ownerId)
    if (!preflight.ok) {
      this.emit({ ...task, status: 'failed', error: preflight.reason })
      return redactTorrentTask(safeTask(this.tasks.get(taskId)!))
    }
    const activationConsent = consent ?? task.networkConsent
    const activationTask = { ...task, networkConsent: activationConsent }
    this.tasks.set(taskId, activationTask)
    if (!this.handles.has(taskId)) await this.attach(activationTask, false, activationConsent)
    else await this.ensureClient(activationTask, activationConsent)
    const handle = this.handles.get(taskId)
    handle?.resume?.()
    this.emit({ ...activationTask, status: 'downloading', error: null })
    await this.recordHistory('resumed', this.tasks.get(taskId)!)
    return redactTorrentTask(safeTask(this.tasks.get(taskId)!))
  }

  async pause(taskId: string, ownerId?: number): Promise<TorrentTaskState | null> {
    await this.initPromise
    const task = this.tasks.get(taskId)
    if (!task || !this.isOwner(taskId, ownerId)) return null
    try {
      await this.stopHandle(taskId, false)
      this.emit({ ...task, status: 'paused', speedBytesPerSecond: 0, etaSeconds: null, seedingRemainingSeconds: null })
      await this.recordHistory('paused', this.tasks.get(taskId)!)
    } catch (error) {
      this.emit({ ...task, status: 'failed', error: error instanceof Error ? error.message : String(error) })
    }
    return redactTorrentTask(safeTask(this.tasks.get(taskId)!))
  }

  async resume(taskId: string, consent?: import('../../shared/torrent').TorrentNetworkConsent, ownerId?: number): Promise<TorrentTaskState | null> {
    await this.initPromise
    return this.start(taskId, consent, ownerId)
  }

  async cancel(taskId: string, ownerId?: number): Promise<TorrentTaskState | null> {
    await this.initPromise
    const task = this.tasks.get(taskId)
    if (!task || !this.isOwner(taskId, ownerId)) return null
    await this.stopHandle(taskId, false)
    this.emit({ ...task, status: 'cancelled', speedBytesPerSecond: 0, etaSeconds: null })
    await this.recordHistory('cancelled', this.tasks.get(taskId)!)
    return redactTorrentTask(safeTask(this.tasks.get(taskId)!))
  }

  async retry(taskId: string, consent?: import('../../shared/torrent').TorrentNetworkConsent, ownerId?: number): Promise<TorrentTaskState | null> {
    await this.initPromise
    const task = this.tasks.get(taskId)
    if (!task || !this.isOwner(taskId, ownerId)) return null
    await this.stopHandle(taskId, false)
    const activationConsent = consent ?? task.networkConsent
    const activationTask = { ...task, status: 'metadata' as const, error: null, speedBytesPerSecond: 0, etaSeconds: null, networkConsent: activationConsent }
    this.emit(activationTask)
    await this.recordHistory('retry started', activationTask)
    await this.attach(activationTask, false, activationConsent)
    return redactTorrentTask(safeTask(this.tasks.get(taskId)!))
  }

  async remove(taskId: string, ownerId?: number): Promise<void> {
    await this.initPromise
    const task = this.tasks.get(taskId)
    if (!task || !this.isOwner(taskId, ownerId)) return
    await this.stopHandle(taskId, false)
    this.reservations.delete(taskId)
    const timer = this.seedTimers.get(taskId)
    if (timer) clearTimeout(timer)
    this.seedTimers.delete(taskId)
    this.tasks.delete(taskId)
    this.owners.delete(taskId)
    this.consentUses.delete(taskId)
    if (task.sourceKind === 'torrent-file') {
      const sourceRoot = resolve(join(this.options.userDataDir, 'torrent-downloader', 'sources'))
      const staged = resolve(task.sourceRef)
      if (staged.startsWith(`${sourceRoot}${sep}`)) await unlink(staged).catch(() => undefined)
    }
    await this.persist()
    await this.recordHistory('removed', task)
  }

  async restoreHistory(content: string): Promise<void> {
    await this.initPromise
    const parsed = JSON.parse(content) as PersistedStore
    if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.tasks) || parsed.tasks.length > TORRENT_MAX_TASKS) throw new Error('Torrent history snapshot is not valid.')
    for (const handleId of [...this.handles.keys()]) await this.stopHandle(handleId, false)
    this.tasks.clear()
    for (const raw of parsed.tasks) {
      const task = safeTask(raw)
      if (!task.id || !task.sourceRef) throw new Error('Torrent history snapshot contains an invalid task.')
      task.status = task.status === 'downloading' || task.status === 'metadata' || task.status === 'seeding' ? 'recoverable-paused' : task.status
      this.tasks.set(task.id, task)
    }
    await this.persist()
    const first = this.tasks.values().next().value as TorrentTaskState | undefined
    if (first) await this.recordHistory('updated', first)
  }

  private scheduleSeedTimer(taskId: string, minutes: number): void {
    if (this.seedTimers.has(taskId)) return
    const timer = setTimeout(() => {
      const current = this.tasks.get(taskId)
      if (current?.seedPolicy.kind !== 'minutes' || (current.status !== 'completed' && current.status !== 'seeding')) return
      void this.stopHandle(taskId, false).then(() => this.emit({ ...current, status: 'stopped', seedingRemainingSeconds: 0 })).catch(() => undefined)
      this.seedTimers.delete(taskId)
    }, minutes * 60_000)
    this.seedTimers.set(taskId, timer)
  }

  async setSeedPolicy(taskId: string, policy: TorrentSeedPolicy, ownerId?: number): Promise<TorrentTaskState | null> {
    await this.initPromise
    const task = this.tasks.get(taskId)
    if (!task || !this.isOwner(taskId, ownerId)) return null
    const seedPolicy = normalizeSeedPolicy(policy)
    if (seedPolicy.kind === 'minutes' && seedPolicy.minutes > TORRENT_MAX_SEED_MINUTES) return redactTorrentTask(safeTask(task))
    if (seedPolicy.kind === 'ratio' && seedPolicy.ratio > TORRENT_MAX_SEED_RATIO) return redactTorrentTask(safeTask(task))
    this.emit({ ...task, seedPolicy })
    await this.recordHistory('seeding policy changed', this.tasks.get(taskId)!)
    const oldTimer = this.seedTimers.get(taskId)
    if (oldTimer) clearTimeout(oldTimer)
    if (seedPolicy.kind === 'minutes' && seedPolicy.minutes > 0 && (task.status === 'completed' || task.status === 'seeding')) this.scheduleSeedTimer(taskId, seedPolicy.minutes)
    return redactTorrentTask(safeTask(this.tasks.get(taskId)!))
  }

  async reconcile(): Promise<TorrentTaskState[]> {
    await this.initPromise
    // A restart never revives a client or contacts a tracker. The user must explicitly Resume,
    // which rechecks consent, destination, disk and quota before creating a new handle.
    for (const task of [...this.tasks.values()]) {
      if (task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed' || task.status === 'stopped') continue
      if (task.status !== 'recoverable-paused') this.emit({ ...task, status: 'recoverable-paused', error: null })
    }
    return this.list()
  }

  onTask(listener: (task: TorrentTaskState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
