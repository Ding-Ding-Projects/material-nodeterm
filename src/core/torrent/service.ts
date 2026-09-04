import { execFile } from 'node:child_process'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { constants as fsConstants, statfsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { renameAtomic } from '../fs-atomic'
import {
  isMagnetUri,
  normalizeSeedPolicy,
  safeTorrentRelativePath,
  TORRENT_DEFAULT_SEED_POLICY,
  TORRENT_MAX_FILES,
  TORRENT_MAX_SEED_MINUTES,
  TORRENT_MAX_SEED_RATIO,
  TORRENT_MAX_SOURCE_BYTES,
  type TorrentAddInput,
  type TorrentApi,
  type TorrentDestinationPreflight,
  type TorrentFileInfo,
  type TorrentSeedPolicy,
  type TorrentTaskState,
  type TorrentTaskStatus,
  type TorrentSourceKind, TORRENT_MAX_TASKS} from '../../shared/torrent'

const execFileAsync = promisify(execFile)
const WEBTORRENT_VERSION = '2.8.1'
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
  files?: TorrentFileLike[]
  pause?: () => void
  resume?: () => void
  destroy?: (opts?: { destroyStore?: boolean }, cb?: (error?: Error) => void) => void
  on?: (event: string, listener: (...args: any[]) => void) => void
}

interface WebTorrentClientLike {
  add: (source: string, opts?: { path?: string }, cb?: (torrent: TorrentLike) => void) => TorrentLike
  destroy?: (cb?: (error?: Error) => void) => void
  destroyed?: boolean
  utp?: boolean
  on?: (event: string, listener: (...args: any[]) => void) => void
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
  /** Optional local-history hand-off. No shell wires it today, so recordHistory guards with ?.
   *  and falls back to the JSONL file alone. */
  onHistory?: (event: { action: 'created' | 'updated' | 'deleted' | 'restored'; label: string; content: string }) => Promise<void>
  platform?: NodeJS.Platform
  runtimeResolver?: () => Promise<{ ctor: WebTorrentCtor; origin: 'bundled' | 'auto-installed' }>
}

export function webTorrentClientOptions(options: Pick<TorrentServiceOptions, 'isPackaged' | 'platform'>): Record<string, unknown> {
  const platform = options.platform ?? process.platform
  return {
    dht: true,
    // utp-native can throw from its asynchronous bind after WebTorrent's constructor has returned.
    // TCP remains a complete peer transport, so packaged Windows builds avoid letting an optional
    // native listener decide whether the whole desktop process survives startup reconciliation.
    utp: !(options.isPackaged === true && platform === 'win32')
  }
}

function clampStatus(status: unknown): TorrentTaskStatus {
  return status === 'metadata' || status === 'downloading' || status === 'paused' || status === 'completed' || status === 'cancelled' || status === 'failed'
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
    name: typeof task.name === 'string' && task.name.length <= 1024 ? task.name : 'Torrent download',
    destination: typeof task.destination === 'string' && task.destination.length <= 4096 ? task.destination : null,
    files,
    status: clampStatus(task.status),
    progress: Math.min(1, finiteNumber(task.progress)),
    downloadedBytes: finiteNumber(task.downloadedBytes),
    totalBytes: finiteNumber(task.totalBytes),
    speedBytesPerSecond: finiteNumber(task.speedBytesPerSecond),
    peers: Math.min(10_000, Math.round(finiteNumber(task.peers))),
    etaSeconds: task.etaSeconds === null ? null : finiteNumber(task.etaSeconds),
    error: typeof task.error === 'string' && task.error.length <= 2000 ? task.error : null,
    seedPolicy: normalizeSeedPolicy(task.seedPolicy),
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

export class TorrentService implements TorrentApi {
  private readonly storeFile: string
  private readonly historyFile: string
  private readonly runtimeRoot: string
  private readonly tasks = new Map<string, TorrentTaskState>()
  private readonly handles = new Map<string, TorrentLike>()
  private readonly seedTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly listeners = new Set<(task: TorrentTaskState) => void>()
  private readonly taskCallback?: (task: TorrentTaskState) => void
  private client: WebTorrentClientLike | null = null
  private runtimeInfo: Awaited<ReturnType<TorrentApi['runtime']>> | null = null
  private initPromise: Promise<void>
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: TorrentServiceOptions) {
    this.storeFile = join(options.userDataDir, 'torrent-downloader', 'tasks.json')
    this.runtimeRoot = join(options.userDataDir, 'torrent-downloader', 'webtorrent-runtime')
    this.historyFile = join(options.userDataDir, 'torrent-downloader', 'history.jsonl')
    this.taskCallback = options.onTask
    this.initPromise = this.load()
  }

  private async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.storeFile, 'utf8')) as PersistedStore
      if (raw?.version !== STORE_VERSION || !Array.isArray(raw.tasks)) return
      for (const task of raw.tasks) {
        const normalized = safeTask(task)
        if (normalized.id && normalized.sourceRef) {
          if (normalized.status === 'downloading' || normalized.status === 'metadata') normalized.status = 'queued'
          this.tasks.set(normalized.id, normalized)
        }
      }
    } catch {
      // Missing or corrupt task state is a recoverable local-state failure. Keep the service usable
      // with an empty queue instead of inventing records or failing application startup.
    }
  }

  private async persist(): Promise<void> {
    const next = async (): Promise<void> => {
      const dir = join(this.options.userDataDir, 'torrent-downloader')
      await mkdir(dir, { recursive: true })
      const temp = `${this.storeFile}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`
      const body: PersistedStore = { version: STORE_VERSION, tasks: [...this.tasks.values()].map(safeTask) }
      await writeFile(temp, JSON.stringify(body, null, 2), { encoding: 'utf8', mode: 0o600 })
      await renameAtomic(temp, this.storeFile)
    }
    this.writeQueue = this.writeQueue.then(next, next)
    await this.writeQueue
  }

  // Recovered with restoreHistory: the merge dropped the whole history-recording leg while
  // keeping the Server Edition handler that calls it. onHistory is optional and no shell
  // wires it today, so this writes the JSONL and skips the local-history hand-off.
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
    this.taskCallback?.(normalized)
    for (const listener of this.listeners) listener(normalized)
    void this.persist()
  }

  private async importRuntime(specifier: string): Promise<WebTorrentCtor> {
    const loaded = await import(specifier) as { default?: unknown }
    if (typeof loaded.default !== 'function') throw new Error('WebTorrent did not expose its constructor.')
    return loaded.default as WebTorrentCtor
  }

  private async resolveRuntime(): Promise<{ ctor: WebTorrentCtor; origin: 'bundled' | 'auto-installed' }> {
    const candidates = [
      ...(this.options.resourcesPath
        ? [pathToFileURL(join(this.options.resourcesPath, 'webtorrent-runtime', 'node_modules', 'webtorrent', 'index.js')).href]
        : []),
      'webtorrent'
    ]
    for (const candidate of candidates) {
      try {
        return { ctor: await this.importRuntime(candidate), origin: 'bundled' }
      } catch {
        // Try the next sanctioned location, then the user-scoped auto-install below.
      }
    }
    await mkdir(this.runtimeRoot, { recursive: true })
    try {
      await execFileAsync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
        'install', '--prefix', this.runtimeRoot, '--no-save', '--ignore-scripts', `webtorrent@${WEBTORRENT_VERSION}`
      ], { cwd: this.runtimeRoot, windowsHide: true, maxBuffer: 1024 * 1024 })
      const specifier = pathToFileURL(join(this.runtimeRoot, 'node_modules', 'webtorrent', 'index.js')).href
      return { ctor: await this.importRuntime(specifier), origin: 'auto-installed' }
    } catch (error) {
      throw new Error(`WebTorrent runtime unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async runtime(): Promise<{ available: boolean; origin: 'bundled' | 'auto-installed' | 'unavailable'; detail: string | null }> {
    await this.initPromise
    if (this.runtimeInfo) return this.runtimeInfo
    try {
      const { ctor, origin } = this.options.runtimeResolver
        ? await this.options.runtimeResolver()
        : await this.resolveRuntime()
      const clientOptions = webTorrentClientOptions(this.options)
      const client = new ctor(clientOptions)
      const utpRequested = clientOptions.utp !== false
      client.on?.('error', (error: Error) => this.handleClientError(client, origin, utpRequested, error))
      this.client = client
      this.runtimeInfo = { available: true, origin, detail: null }
      return this.runtimeInfo
    } catch (error) {
      this.runtimeInfo = { available: false, origin: 'unavailable', detail: error instanceof Error ? error.message : String(error) }
      return this.runtimeInfo
    }
  }

  private handleClientError(client: WebTorrentClientLike, origin: 'bundled' | 'auto-installed', utpRequested: boolean, error: Error): void {
    const detail = error instanceof Error ? error.message : String(error)
    if (utpRequested && client.destroyed !== true && client.utp === false) {
      // WebTorrent disables uTP before emitting its recoverable bind error. Keep the working TCP
      // client and expose the degradation without allowing an unhandled EventEmitter error to end
      // the application process.
      this.runtimeInfo = { available: true, origin, detail: `uTP unavailable; using TCP: ${detail}`.slice(0, 2000) }
      return
    }

    if (this.client === client) this.client = null
    this.runtimeInfo = { available: false, origin: 'unavailable', detail: detail.slice(0, 2000) }
    for (const task of this.tasks.values()) {
      if (task.status === 'metadata' || task.status === 'downloading' || task.status === 'queued') {
        this.emit({ ...task, status: 'failed', error: `Torrent runtime failed: ${detail}`.slice(0, 2000) })
      }
    }
  }

  async list(nodeId?: string): Promise<TorrentTaskState[]> {
    await this.initPromise
    return [...this.tasks.values()].filter((task) => nodeId === undefined || task.nodeId === nodeId).map(safeTask)
  }

  private validateSource(kind: TorrentSourceKind, sourceRef: string): void {
    if (kind === 'magnet') {
      if (!isMagnetUri(sourceRef)) throw new Error('Enter a valid magnet URI beginning with magnet:?xt=urn:btih:')
      return
    }
    if (!sourceRef || sourceRef.length > 4096) throw new Error('Choose a torrent file with a valid local path.')
  }

  private async readTorrentSource(input: { sourceKind: TorrentSourceKind; sourceRef: string }): Promise<void> {
    this.validateSource(input.sourceKind, input.sourceRef)
    if (input.sourceKind === 'torrent-file') {
      const info = await stat(input.sourceRef)
      if (!info.isFile()) throw new Error('The selected torrent source is not a file.')
      if (info.size > TORRENT_MAX_SOURCE_BYTES) throw new Error(`Torrent metadata is larger than the ${TORRENT_MAX_SOURCE_BYTES} byte safety limit.`)
      await access(input.sourceRef, fsConstants.R_OK)
    }
  }

  async inspect(input: { nodeId: string; sourceKind: TorrentSourceKind; sourceRef: string }): Promise<TorrentTaskState> {
    await this.initPromise
    await this.readTorrentSource(input)
    const runtime = await this.runtime()
    if (!runtime.available || !this.client) throw new Error(runtime.detail ?? 'WebTorrent runtime is unavailable.')
    const task = this.newTask({ nodeId: input.nodeId, sourceKind: input.sourceKind, sourceRef: input.sourceRef, destination: '' })
    await this.attach(task, true)
    return safeTask(this.tasks.get(task.id) ?? task)
  }

  private newTask(input: TorrentAddInput): TorrentTaskState {
    const now = Date.now()
    const task: TorrentTaskState = {
      id: randomUUID(),
      nodeId: input.nodeId,
      sourceKind: input.sourceKind,
      sourceRef: input.sourceRef,
      name: 'Torrent download',
      destination: input.destination || null,
      files: [],
      status: 'metadata',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      speedBytesPerSecond: 0,
      peers: 0,
      etaSeconds: null,
      error: null,
      seedPolicy: normalizeSeedPolicy(input.seedPolicy ?? TORRENT_DEFAULT_SEED_POLICY),
      uploadedBytes: 0,
      ratio: 0,
      createdAt: now,
      updatedAt: now
    }
    this.tasks.set(task.id, task)
    return task
  }

  async add(input: TorrentAddInput): Promise<TorrentTaskState> {
    await this.initPromise
    await this.readTorrentSource(input)
    if (!input.destination || input.destination.length > 4096) throw new Error('Choose a destination folder before adding the torrent.')
    const runtime = await this.runtime()
    if (!runtime.available || !this.client) throw new Error(runtime.detail ?? 'WebTorrent runtime is unavailable.')
    const task = this.newTask(input)
    await this.attach(task, false)
    return safeTask(this.tasks.get(task.id) ?? task)
  }

  private async attach(task: TorrentTaskState, inspectOnly: boolean): Promise<void> {
    if (!this.client) throw new Error('WebTorrent client is unavailable.')
    const torrent = this.client.add(task.sourceRef, task.destination ? { path: task.destination } : undefined)
    this.handles.set(task.id, torrent)
    const update = (): void => {
      const current = this.tasks.get(task.id)
      if (!current) return
      const runtimeFiles = (torrent.files ?? []).slice(0, TORRENT_MAX_FILES)
      const files = runtimeFiles.length > 0 ? runtimeFiles.map((file) => {
        const relativePath = (file.path ?? file.name ?? '').replaceAll('\\', '/')
        return {
          path: relativePath,
          name: file.name ?? relativePath,
          sizeBytes: finiteNumber(file.length),
          selected: current.files.find((entry) => entry.path === relativePath)?.selected ?? true,
          downloadedBytes: Math.min(finiteNumber(file.downloaded), finiteNumber(file.length))
        } satisfies TorrentFileInfo
      }).filter((file) => safeTorrentRelativePath(file.path)) : current.files
      const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0) || finiteNumber(torrent.length)
      const downloadedBytes = files.reduce((sum, file) => sum + file.downloadedBytes, 0) || finiteNumber(torrent.downloaded)
      const speed = finiteNumber(torrent.downloadSpeed)
      const ratio = finiteNumber(torrent.ratio) || (downloadedBytes > 0 ? finiteNumber(torrent.uploaded) / downloadedBytes : 0)
      const progress = totalBytes > 0 ? Math.min(1, downloadedBytes / totalBytes) : Math.min(1, finiteNumber(torrent.progress))
      const status: TorrentTaskStatus = current.status === 'paused' ? 'paused' : progress >= 1 ? 'completed' : 'downloading'
      const next = { ...current, name: torrent.name || current.name, files, totalBytes, downloadedBytes, progress, speedBytesPerSecond: speed, peers: Math.round(finiteNumber(torrent.numPeers)), etaSeconds: speed > 0 && totalBytes > downloadedBytes ? Math.ceil((totalBytes - downloadedBytes) / speed) : null, uploadedBytes: finiteNumber(torrent.uploaded), ratio, status, error: null }
      this.emit(next)
      if (status === 'completed') this.applyCompletionSeedPolicy(next)
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
    torrent.on?.('done', update)
    torrent.on?.('error', (error: Error) => {
      const current = this.tasks.get(task.id)
      if (current) this.emit({ ...current, status: 'failed', error: error.message.slice(0, 2000) })
    })
    update()
    if (inspectOnly) torrent.pause?.()
    else if (task.files.length === 0) torrent.pause?.()
    this.emit(this.tasks.get(task.id) ?? task)
  }

  async chooseFiles(taskId: string, selectedPaths: string[]): Promise<TorrentTaskState | null> {
    await this.initPromise
    const task = this.tasks.get(taskId)
    if (!task) return null
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
    return safeTask(this.tasks.get(taskId)!)
  }

  async setDestination(taskId: string, destination: string): Promise<TorrentTaskState | null> {
    await this.initPromise
    const task = this.tasks.get(taskId)
    if (!task || !destination || destination.length > 4096) return null
    const next = { ...task, destination, status: 'metadata' as const, error: null }
    await this.stopHandle(taskId, false)
    this.emit(next)
    const runtime = await this.runtime()
    if (runtime.available && this.client) await this.attach(next, true)
    return safeTask(this.tasks.get(taskId)!)
  }

  async preflight(taskId: string): Promise<TorrentDestinationPreflight> {
    await this.initPromise
    const task = this.tasks.get(taskId)
    const destination = task?.destination ?? ''
    const requiredBytes = task?.files.filter((file) => file.selected).reduce((sum, file) => sum + Math.max(0, file.sizeBytes - file.downloadedBytes), 0) ?? 0
    if (!destination) return { path: destination, exists: false, writable: false, freeBytes: null, requiredBytes, ok: false, reason: 'Choose a destination folder.' }
    if (task?.files.some((file) => file.selected && !targetPath(destination, file.path))) {
      return { path: destination, exists: true, writable: false, freeBytes: null, requiredBytes, ok: false, reason: 'One selected torrent path is unsafe and cannot be written.' }
    }
    try {
      const info = await stat(destination)
      if (!info.isDirectory()) return { path: destination, exists: true, writable: false, freeBytes: null, requiredBytes, ok: false, reason: 'The destination is not a folder.' }
      await access(destination, fsConstants.W_OK)
      let freeBytes: number | null = null
      try {
        const fsInfo = statfsSync(destination)
        freeBytes = Number(fsInfo.bavail) * Number(fsInfo.bsize)
      } catch {
        freeBytes = null
      }
      const enough = freeBytes === null || freeBytes >= requiredBytes
      return { path: destination, exists: true, writable: true, freeBytes, requiredBytes, ok: enough, reason: enough ? null : 'The destination does not have enough free space for the selected files.' }
    } catch {
      return { path: destination, exists: false, writable: false, freeBytes: null, requiredBytes, ok: false, reason: 'The destination folder cannot be read or written.' }
    }
  }

  private async stopHandle(taskId: string, destroyStore: boolean): Promise<void> {
    const handle = this.handles.get(taskId)
    if (!handle?.destroy) return
    await new Promise<void>((resolveDestroy) => handle.destroy?.({ destroyStore }, () => resolveDestroy()))
    this.handles.delete(taskId)
  }

  private clearSeedTimer(taskId: string): void {
    const timer = this.seedTimers.get(taskId)
    if (timer) clearTimeout(timer)
    this.seedTimers.delete(taskId)
  }

  private applyCompletionSeedPolicy(task: TorrentTaskState): void {
    if (task.seedPolicy.kind === 'never') {
      this.clearSeedTimer(task.id)
      void this.stopHandle(task.id, false)
      return
    }
    if (task.seedPolicy.kind === 'ratio') {
      this.clearSeedTimer(task.id)
      if (task.ratio >= task.seedPolicy.ratio) void this.stopHandle(task.id, false)
      return
    }
    if (this.seedTimers.has(task.id)) return
    const minutes = task.seedPolicy.minutes
    if (minutes <= 0) {
      void this.stopHandle(task.id, false)
      return
    }
    const timer = setTimeout(() => {
      this.seedTimers.delete(task.id)
      const current = this.tasks.get(task.id)
      if (current?.status === 'completed' && current.seedPolicy.kind === 'minutes' && current.seedPolicy.minutes === minutes) {
        void this.stopHandle(task.id, false)
      }
    }, minutes * 60_000)
    this.seedTimers.set(task.id, timer)
  }

  async start(taskId: string): Promise<TorrentTaskState | null> {
    const task = this.tasks.get(taskId)
    if (!task) return null
    if (task.files.length > 0 && !task.files.some((file) => file.selected)) {
      this.emit({ ...task, status: 'failed', error: 'Select at least one file before starting the download.' })
      return safeTask(this.tasks.get(taskId)!)
    }
    const preflight = await this.preflight(taskId)
    if (!preflight.ok) {
      this.emit({ ...task, status: 'failed', error: preflight.reason })
      return safeTask(this.tasks.get(taskId)!)
    }
    const handle = this.handles.get(taskId)
    handle?.resume?.()
    this.emit({ ...task, status: 'downloading', error: null })
    return safeTask(this.tasks.get(taskId)!)
  }

  async pause(taskId: string): Promise<TorrentTaskState | null> {
    const task = this.tasks.get(taskId)
    if (!task) return null
    this.handles.get(taskId)?.pause?.()
    this.emit({ ...task, status: 'paused' })
    return safeTask(this.tasks.get(taskId)!)
  }

  async resume(taskId: string): Promise<TorrentTaskState | null> {
    return this.start(taskId)
  }

  async cancel(taskId: string): Promise<TorrentTaskState | null> {
    const task = this.tasks.get(taskId)
    if (!task) return null
    this.clearSeedTimer(taskId)
    await this.stopHandle(taskId, false)
    this.emit({ ...task, status: 'cancelled', speedBytesPerSecond: 0, etaSeconds: null })
    return safeTask(this.tasks.get(taskId)!)
  }

  async retry(taskId: string): Promise<TorrentTaskState | null> {
    const task = this.tasks.get(taskId)
    if (!task) return null
    this.clearSeedTimer(taskId)
    await this.stopHandle(taskId, false)
    this.emit({ ...task, status: 'metadata', error: null, speedBytesPerSecond: 0, etaSeconds: null })
    await this.attach(this.tasks.get(taskId)!, false)
    return safeTask(this.tasks.get(taskId)!)
  }

  async remove(taskId: string): Promise<void> {
    await this.initPromise
    this.clearSeedTimer(taskId)
    await this.stopHandle(taskId, false)
    this.tasks.delete(taskId)
    await this.persist()
  }

  async setSeedPolicy(taskId: string, policy: TorrentSeedPolicy): Promise<TorrentTaskState | null> {
    const task = this.tasks.get(taskId)
    if (!task) return null
    const seedPolicy = normalizeSeedPolicy(policy)
    if (seedPolicy.kind === 'minutes' && seedPolicy.minutes > TORRENT_MAX_SEED_MINUTES) return safeTask(task)
    if (seedPolicy.kind === 'ratio' && seedPolicy.ratio > TORRENT_MAX_SEED_RATIO) return safeTask(task)
    this.clearSeedTimer(taskId)
    const next = { ...task, seedPolicy }
    this.emit(next)
    if (next.status === 'completed') this.applyCompletionSeedPolicy(next)
    return safeTask(this.tasks.get(taskId)!)
  }

  async reconcile(): Promise<TorrentTaskState[]> {
    await this.initPromise
    const runtime = await this.runtime()
    if (!runtime.available || !this.client) return this.list()
    for (const task of [...this.tasks.values()]) {
      if (task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed') continue
      try {
        await this.attach(task, false)
        this.emit({ ...task, status: 'paused', error: null })
      } catch (error) {
        this.emit({ ...task, status: 'failed', error: `Restart reconciliation failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 2000) })
      }
    }
    return this.list()
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

  onTask(listener: (task: TorrentTaskState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

