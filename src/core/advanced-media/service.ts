import { mkdir, readFile, stat, writeFile, access } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, isAbsolute, sep } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import type {
  AdvancedMediaAdapterDescriptor,
  AdvancedMediaCatalogSnapshot,
  AdvancedMediaFormat,
  AdvancedMediaJob,
  AdvancedMediaOperationId,
  AdvancedMediaProgress,
  AdvancedMediaResult
} from '../../shared/advanced-media'
import { ADVANCED_MEDIA_DEFAULT_LIMITS, buildAdvancedMediaCatalog, advancedMediaAdapterById } from '../../shared/advanced-media'
import { removeAtomic, renameAtomic, tempNameFor } from '../fs-atomic'
import { createTar, createZip, extractTar, extractZip, inspectImage, inspectPdf, listTarEntries, listZipEntries, extractPdfText, safeArchivePath, sha256, validateMediaOutput } from './formats'
import { MediaDependencyManager } from './dependencies'
import { runSandboxedCommand } from './sandbox'

const JOB_LIMIT = 2_000

function id(): string {
  return `am_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function formatForPath(path: string): AdvancedMediaFormat | null {
  const ext = extname(path).toLowerCase()
  const formats: Record<string, AdvancedMediaFormat> = {
    '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.gif': 'gif', '.webp': 'webp', '.bmp': 'bmp',
    '.ico': 'ico', '.heic': 'heic', '.tif': 'tiff', '.tiff': 'tiff', '.mp3': 'mp3', '.wav': 'wav',
    '.flac': 'flac', '.m4a': 'm4a', '.ogg': 'ogg', '.mp4': 'mp4', '.mov': 'mov', '.mkv': 'mkv',
    '.webm': 'webm', '.zip': 'zip', '.tar': 'tar', '.7z': 'sevenzip', '.pdf': 'pdf', '.txt': 'text',
    '.json': 'text'
  }
  return formats[ext] ?? null
}

function descriptorFor(operation: AdvancedMediaOperationId, catalog: readonly AdvancedMediaAdapterDescriptor[]): AdvancedMediaAdapterDescriptor {
  const descriptor = advancedMediaAdapterById(operation, catalog as AdvancedMediaAdapterDescriptor[])
  if (!descriptor) throw new Error(`Unknown advanced media operation: ${operation}`)
  if (!descriptor.available) throw new Error(descriptor.unavailableReason ?? `Operation ${operation} is unavailable.`)
  return descriptor
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error)
}

export interface AdvancedMediaServiceOptions {
  userDataDir: string
  dependencies: MediaDependencyManager
  onProgress?: (event: AdvancedMediaProgress) => void
}

/**
 * Queue and execution service for operations that the express converter cannot model. All process
 * execution is through runSandboxedCommand, and every output is validated before atomic publish.
 */
export class AdvancedMediaService {
  private readonly root: string
  private readonly deps: MediaDependencyManager
  private readonly emit: (event: AdvancedMediaProgress) => void
  private readonly jobs: AdvancedMediaJob[] = []
  private readonly controllers = new Map<string, AbortController>()
  private readonly listeners = new Set<(event: AdvancedMediaProgress) => void>()
  private running = false
  private active = 0
  private loaded: Promise<void>

  constructor(opts: AdvancedMediaServiceOptions) {
    this.root = resolve(opts.userDataDir)
    this.deps = opts.dependencies
    this.emit = (event) => {
      opts.onProgress?.(event)
      for (const listener of this.listeners) listener(event)
    }
    this.loaded = this.load()
  }

  private stateFile(): string {
    return join(this.root, 'advanced-media', 'jobs.json')
  }

  private async load(): Promise<void> {
    try {
      const raw = JSON.parse((await readFile(this.stateFile())).toString('utf8')) as unknown
      if (!Array.isArray(raw)) return
      for (const item of raw.slice(-JOB_LIMIT)) {
        if (!item || typeof item !== 'object') continue
        const job = item as AdvancedMediaJob
        if (typeof job.id !== 'string' || typeof job.operation !== 'string' || !Array.isArray(job.inputPaths)) continue
        if (job.status === 'running') job.status = 'queued'
        if (job.status === 'queued' || job.status === 'paused' || job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') this.jobs.push(job)
      }
    } catch {
      // A missing or malformed queue is an empty queue. The source files remain untouched.
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.stateFile()), { recursive: true })
    const tmp = tempNameFor(this.stateFile())
    try {
      await writeFile(tmp, JSON.stringify(this.jobs.slice(-JOB_LIMIT)), { flag: 'wx', mode: 0o600 })
      await renameAtomic(tmp, this.stateFile())
    } finally {
      await removeAtomic(tmp).catch(() => {})
    }
  }

  async catalog(): Promise<AdvancedMediaCatalogSnapshot> {
    await this.loaded
    const verified = new Set<'ffprobe' | 'tesseract' | 'pdf-rasterizer'>()
    for (const dependency of ['ffprobe', 'tesseract', 'pdf-rasterizer'] as const) {
      if ((await this.deps.verify(dependency)).ok) verified.add(dependency)
    }
    return { schemaVersion: 1, generatedAt: new Date().toISOString(), adapters: buildAdvancedMediaCatalog(verified, this.deps.declaredIds()), dependencies: this.deps.catalog(verified) }
  }

  async inspect(path: string): Promise<Record<string, unknown>> {
    await this.loaded
    const st = await stat(path)
    if (!st.isFile()) throw new Error('Advanced media inspection needs a regular file.')
    if (st.size > ADVANCED_MEDIA_DEFAULT_LIMITS.maxInputBytes) throw new Error('The media file exceeds the inspection byte budget.')
    const bytes = await readFile(path)
    const format = formatForPath(path)
    if (format === 'zip') return { kind: 'archive', format, entries: listZipEntries(bytes, ADVANCED_MEDIA_DEFAULT_LIMITS) }
    if (format === 'tar') return { kind: 'archive', format, entries: listTarEntries(bytes, ADVANCED_MEDIA_DEFAULT_LIMITS) }
    if (format === 'pdf') return { kind: 'document', ...inspectPdf(bytes, ADVANCED_MEDIA_DEFAULT_LIMITS) }
    if (['png', 'jpeg', 'gif', 'webp', 'bmp', 'ico'].includes(format ?? '')) return { kind: 'image', ...inspectImage(bytes, ADVANCED_MEDIA_DEFAULT_LIMITS) }
    return { kind: 'binary', format, bytes: bytes.length }
  }

  async enqueue(request: {
    operation: AdvancedMediaOperationId
    inputPaths: string[]
    outputPath?: string
    outputDirectory?: string
    acknowledgedLoss?: boolean
  }): Promise<AdvancedMediaJob> {
    await this.loaded
    const catalog = (await this.catalog()).adapters
    const descriptor = descriptorFor(request.operation, catalog)
    if (this.jobs.length >= JOB_LIMIT) throw new Error('The advanced media queue has reached its bounded history limit.')
    if (!Array.isArray(request.inputPaths) || request.inputPaths.length === 0) throw new Error('Select at least one source file.')
    if (descriptor.lossy && request.acknowledgedLoss !== true) throw new Error('This operation can lose information; acknowledge its loss disclosure before queueing it.')
    if (request.operation === 'archive-extract' && !request.outputDirectory) throw new Error('Choose an output directory for this operation.')
    if (request.operation !== 'archive-extract' && !request.outputPath) throw new Error('Choose an output file for this operation.')
    if (request.operation === 'archive-create' && !['.zip', '.tar'].includes(extname(request.outputPath ?? '').toLowerCase())) throw new Error('Archive creation needs a .zip or .tar destination.')
    let totalBytes = 0
    for (const path of request.inputPaths) {
      const st = await stat(path)
      if (!st.isFile()) throw new Error(`Source is not a regular file: ${basename(path)}`)
      if (st.size > descriptor.limits.maxInputBytes) throw new Error(`Source exceeds the ${descriptor.limits.maxInputBytes}-byte operation limit: ${basename(path)}`)
      const format = formatForPath(path)
      if (request.operation !== 'archive-create' && (!format || !descriptor.sourceFormats.includes(format))) throw new Error(`The selected source format ${format ?? 'unknown'} is not accepted by ${request.operation}.`)
      totalBytes += st.size
      if (totalBytes > descriptor.limits.maxInputBytes) throw new Error('The selected sources exceed the aggregate operation byte limit.')
    }
    const job: AdvancedMediaJob = {
      id: id(), operation: request.operation, inputPaths: [...request.inputPaths], outputPath: request.outputPath,
      outputDirectory: request.outputDirectory, status: 'queued', progress: 0, bytesRead: 0, bytesWritten: 0,
      totalBytes, warnings: []
    }
    this.jobs.push(job)
    await this.save()
    this.emitProgress(job, 'queued', 'Queued for advanced media processing.')
    this.pump()
    return { ...job, warnings: [...job.warnings] }
  }

  async state(offset = 0, limit = 200): Promise<{ jobs: AdvancedMediaJob[]; total: number; running: boolean }> {
    await this.loaded
    return { jobs: this.jobs.slice(offset, offset + limit).map((job) => ({ ...job, inputPaths: [...job.inputPaths], warnings: [...job.warnings] })), total: this.jobs.length, running: this.running }
  }

  start(): void {
    this.running = true
    for (const job of this.jobs) if (job.status === 'paused') job.status = 'queued'
    this.pump()
  }

  pause(): void {
    this.running = false
    for (const job of this.jobs) if (job.status === 'queued') job.status = 'paused'
    void this.save()
  }

  async cancel(jobId: string): Promise<void> {
    await this.loaded
    const job = this.jobs.find((candidate) => candidate.id === jobId)
    if (!job || job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return
    if (job.status === 'running') this.controllers.get(jobId)?.abort()
    else job.status = 'cancelled'
    await this.save()
  }

  async retry(jobId: string): Promise<void> {
    await this.loaded
    const job = this.jobs.find((candidate) => candidate.id === jobId)
    if (!job || (job.status !== 'failed' && job.status !== 'cancelled')) return
    job.status = 'queued'
    job.error = undefined
    job.progress = 0
    job.bytesRead = 0
    job.bytesWritten = 0
    await this.save()
    this.pump()
  }

  async remove(jobId: string): Promise<void> {
    await this.loaded
    const job = this.jobs.find((candidate) => candidate.id === jobId)
    if (!job || job.status === 'running' || job.status === 'queued' || job.status === 'paused') return
    const index = this.jobs.indexOf(job)
    this.jobs.splice(index, 1)
    await this.save()
  }

  onProgress(listener: (event: AdvancedMediaProgress) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emitProgress(job: AdvancedMediaJob, phase: AdvancedMediaProgress['phase'], message: string): void {
    this.emit({ jobId: job.id, operation: job.operation, phase, progress: job.progress, bytesRead: job.bytesRead, bytesWritten: job.bytesWritten, totalBytes: job.totalBytes, message })
  }

  private pump(): void {
    if (!this.running) return
    while (this.active < 2) {
      const job = this.jobs.find((candidate) => candidate.status === 'queued')
      if (!job) return
      this.active++
      void this.run(job).finally(() => { this.active--; this.pump() })
    }
  }

  private async run(job: AdvancedMediaJob): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(job.id, controller)
    job.status = 'running'
    job.startedAt = Date.now()
    await this.save()
    this.emitProgress(job, 'reading', 'Reading bounded source bytes.')
    try {
      const result = await this.execute(job, controller.signal)
      job.status = 'done'
      job.progress = 1
      job.bytesWritten = result.outputs.reduce((sum, output) => sum + output.bytes, 0)
      job.finishedAt = Date.now()
      this.emitProgress(job, 'done', 'Outputs validated and published.')
    } catch (error) {
      job.status = controller.signal.aborted ? 'cancelled' : 'failed'
      job.error = controller.signal.aborted ? 'Cancelled before publication.' : errorText(error)
      job.finishedAt = Date.now()
      const message = job.error
      this.emitProgress(job, controller.signal.aborted ? 'cancelled' : 'failed', message)
    } finally {
      this.controllers.delete(job.id)
      await this.save()
    }
  }

  private async execute(job: AdvancedMediaJob, signal: AbortSignal): Promise<AdvancedMediaResult> {
    const catalog = (await this.catalog()).adapters
    const descriptor = descriptorFor(job.operation, catalog)
    const inputBytes: Buffer[] = []
    for (const path of job.inputPaths) {
      if (signal.aborted) throw new Error('Cancelled before reading the next source.')
      const bytes = await readFile(path)
      if (bytes.length > descriptor.limits.maxInputBytes) throw new Error('Source grew past the operation byte limit.')
      inputBytes.push(bytes)
      job.bytesRead += bytes.length
      job.progress = Math.min(0.3, job.bytesRead / Math.max(1, job.totalBytes) * 0.3)
      this.emitProgress(job, 'reading', `Read ${job.bytesRead} of ${job.totalBytes} bytes.`)
    }
    if (signal.aborted) throw new Error('Cancelled before processing.')
    this.emitProgress(job, 'processing', 'Processing with the selected bounded adapter.')
    const outputEntries: { path: string; data: Buffer; format: AdvancedMediaFormat }[] = []
    let metadata: Record<string, unknown> | undefined
    if (job.operation === 'image-inspect') metadata = { ...inspectImage(inputBytes[0], descriptor.limits) }
    else if (job.operation === 'archive-list') metadata = { format: formatForPath(job.inputPaths[0]), entries: formatForPath(job.inputPaths[0]) === 'zip' ? listZipEntries(inputBytes[0], descriptor.limits) : listTarEntries(inputBytes[0], descriptor.limits) }
    else if (job.operation === 'archive-extract') {
      const format = formatForPath(job.inputPaths[0])
      const entries = format === 'zip' ? extractZip(inputBytes[0], descriptor.limits) : extractTar(inputBytes[0], descriptor.limits)
      for (const [relativePath, data] of entries) outputEntries.push({ path: relativePath, data, format: 'binary' })
    } else if (job.operation === 'archive-create') {
      const entries = job.inputPaths.map((path, index) => ({ path: safeArchivePath(basename(path)) || `file-${index}`, data: inputBytes[index] }))
      const format = extname(job.outputPath ?? '').toLowerCase() === '.tar' ? 'tar' : 'zip'
      outputEntries.push({ path: basename(job.outputPath ?? `archive.${format}`), data: format === 'tar' ? createTar(entries, descriptor.limits) : createZip(entries, descriptor.limits), format })
    } else if (job.operation === 'pdf-inspect') metadata = { ...inspectPdf(inputBytes[0], descriptor.limits) }
    else if (job.operation === 'pdf-extract-text') outputEntries.push({ path: basename(job.outputPath ?? 'document.txt'), data: Buffer.from(extractPdfText(inputBytes[0], descriptor.limits), 'utf8'), format: 'text' })
    else if (job.operation === 'media-probe') metadata = await this.probeMedia(job, signal)
    else if (job.operation === 'ocr-image') outputEntries.push({ path: basename(job.outputPath ?? 'ocr.txt'), data: Buffer.from(await this.ocr(job.inputPaths[0], 'tesseract', signal), 'utf8'), format: 'text' })
    else if (job.operation === 'ocr-pdf') outputEntries.push({ path: basename(job.outputPath ?? 'ocr.txt'), data: Buffer.from(await this.ocr(job.inputPaths[0], 'pdf-rasterizer', signal), 'utf8'), format: 'text' })
    job.progress = 0.65
    this.emitProgress(job, 'writing', 'Validating and atomically publishing outputs.')
    const outputs: AdvancedMediaResult['outputs'] = []
    if (metadata && job.outputPath) outputEntries.push({ path: basename(job.outputPath), data: Buffer.from(JSON.stringify(metadata, null, 2) + '\n', 'utf8'), format: 'text' })
    for (const entry of outputEntries) {
      if (signal.aborted) throw new Error('Cancelled before output publication.')
      const validation = validateMediaOutput(entry.data, entry.format, descriptor.limits)
      if (validation) throw new Error(validation)
      const target = job.outputDirectory && job.operation === 'archive-extract' ? join(job.outputDirectory, entry.path) : job.outputPath!
      if (!job.outputDirectory && target !== job.outputPath) throw new Error('Output path is missing.')
      if (job.outputDirectory) {
        const root = resolve(job.outputDirectory)
        const resolved = resolve(target)
        const escaped = relative(root, resolved)
        if (escaped === '..' || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) throw new Error('Output entry escaped its destination directory.')
      }
      try {
        await access(target)
        throw new Error(`Destination already exists: ${basename(target)}. Choose another destination.`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
      }
      await mkdir(dirname(target), { recursive: true })
      const tmp = tempNameFor(target)
      try {
        await writeFile(tmp, entry.data, { flag: 'wx', mode: 0o600 })
        await renameAtomic(tmp, target)
      } finally {
        await removeAtomic(tmp).catch(() => {})
      }
      outputs.push({ path: job.outputDirectory ? entry.path : target, bytes: entry.data.length, format: entry.format, sha256: sha256(entry.data) })
      job.bytesWritten += entry.data.length
      job.progress = Math.min(0.95, job.progress + 0.3 / Math.max(1, outputEntries.length))
      this.emitProgress(job, 'validating', `Validated ${outputs.length} of ${outputEntries.length} outputs.`)
    }
    return { job: { ...job }, outputs, metadata }
  }

  private async probeMedia(job: AdvancedMediaJob, signal: AbortSignal): Promise<Record<string, unknown>> {
    const verified = await this.deps.ensure('ffprobe', signal)
    const result = await runSandboxedCommand([verified.path, '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', job.inputPaths[0]], { timeoutMs: ADVANCED_MEDIA_DEFAULT_LIMITS.timeoutMs, maxOutputBytes: 4 * 1024 * 1024, signal })
    if (result.cancelled || result.timedOut) throw new Error(result.cancelled ? 'Media probe cancelled.' : 'Media probe timed out.')
    if (result.code !== 0) throw new Error(result.stderr.slice(0, 1_000) || 'Media probe failed.')
    const parsed = JSON.parse(result.stdout) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Media probe returned an invalid JSON object.')
    return parsed as Record<string, unknown>
  }

  private async ocr(inputPath: string, dependency: 'tesseract' | 'pdf-rasterizer', signal: AbortSignal): Promise<string> {
    let source = inputPath
    let temporary = ''
    if (dependency === 'pdf-rasterizer') {
      const rasterizer = await this.deps.ensure('pdf-rasterizer', signal)
      await mkdir(this.root, { recursive: true })
      temporary = await mkdtemp(join(this.root, 'advanced-media-'))
      const imageBase = join(temporary, 'page')
      const result = await runSandboxedCommand([rasterizer.path, '-png', '-singlefile', inputPath, imageBase], { timeoutMs: ADVANCED_MEDIA_DEFAULT_LIMITS.timeoutMs, maxOutputBytes: 2 * 1024 * 1024, signal, cwd: temporary })
      if (result.code !== 0 || result.cancelled || result.timedOut) throw new Error(result.cancelled ? 'PDF rasterization cancelled.' : result.stderr.slice(0, 1_000) || 'PDF rasterization failed.')
      source = `${imageBase}.png`
    }
    try {
      const tesseract = await this.deps.ensure('tesseract', signal)
      const result = await runSandboxedCommand([tesseract.path, source, 'stdout', '--dpi', '300'], { timeoutMs: ADVANCED_MEDIA_DEFAULT_LIMITS.timeoutMs, maxOutputBytes: ADVANCED_MEDIA_DEFAULT_LIMITS.maxTextCharacters, signal, cwd: temporary || undefined })
      if (result.code !== 0 || result.cancelled || result.timedOut) throw new Error(result.cancelled ? 'OCR cancelled.' : result.stderr.slice(0, 1_000) || 'OCR failed.')
      if (result.stdout.length > ADVANCED_MEDIA_DEFAULT_LIMITS.maxTextCharacters) throw new Error('OCR output exceeds the text budget.')
      return result.stdout
    } finally {
      if (temporary) await rm(temporary, { recursive: true, force: true })
    }
  }
}
