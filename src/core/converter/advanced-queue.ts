/** Durable queue for advanced pipelines that can yield several output files. */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { renameAtomic } from '../fs-atomic'
import { ADVANCED_PIPELINE_LIMITS, runAdvancedPipeline, type AdvancedPipelineProgress, type AdvancedPipelineResult } from './advanced-pipelines'

export type AdvancedQueueStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'

export interface AdvancedQueueItem {
  id: string
  pipelineId: string
  inputPath: string
  outputDirectory: string
  options?: Record<string, unknown>
  status: AdvancedQueueStatus
  progress?: AdvancedPipelineProgress
  result?: AdvancedPipelineResult
  error?: string
  createdAt: number
  updatedAt: number
}

export interface AdvancedQueueSnapshot {
  schemaVersion: 1
  items: AdvancedQueueItem[]
  concurrency: number
  running: boolean
}

export interface AdvancedQueueDeps {
  userDataDirectory: string
  onItem?: (item: AdvancedQueueItem) => void
  onSummary?: (summary: { running: boolean; active: number; queued: number; total: number }) => void
}

const MAX_ITEMS = 10_000

function clampConcurrency(value: number): number {
  return Math.max(1, Math.min(4, Number.isFinite(value) ? Math.floor(value) : 1))
}

export class AdvancedPipelineQueue {
  private readonly deps: AdvancedQueueDeps
  private readonly file: string
  private items: AdvancedQueueItem[] = []
  private active = 0
  private running = false
  private concurrency = 2
  private readonly cancellations = new Map<string, AbortController>()
  private saveSequence: Promise<void> = Promise.resolve()
  private readonly loaded: Promise<void>

  constructor(deps: AdvancedQueueDeps) {
    this.deps = deps
    this.file = join(deps.userDataDirectory, 'converter', 'advanced-queue.json')
    this.loaded = this.load()
  }

  private async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<AdvancedQueueSnapshot>
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.items) || parsed.items.length > MAX_ITEMS) throw new Error('invalid advanced queue')
      this.items = parsed.items.filter((item): item is AdvancedQueueItem => Boolean(item && typeof item.id === 'string' && typeof item.pipelineId === 'string' && typeof item.inputPath === 'string' && typeof item.outputDirectory === 'string'))
        .map((item) => item.status === 'running' ? { ...item, status: 'queued', updatedAt: Date.now() } : item)
      this.concurrency = clampConcurrency(parsed.concurrency ?? 2)
    } catch {
      // A corrupt snapshot is quarantined, never allowed to prevent the app starting.  The old
      // bytes remain available to support recovery inspection.
      try { await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`) } catch { /* absent is normal */ }
      this.items = []
    }
  }

  private async save(): Promise<void> {
    await fs.mkdir(join(this.deps.userDataDirectory, 'converter'), { recursive: true })
    const temporary = `${this.file}.tmp-${process.pid}-${randomUUID()}`
    await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, items: this.items, concurrency: this.concurrency, running: this.running }), { encoding: 'utf8', flag: 'wx' })
    await renameAtomic(temporary, this.file).catch(async (error) => { await fs.rm(temporary, { force: true }).catch(() => {}); throw error })
  }

  private saveOrdered(): Promise<void> {
    const next = this.saveSequence.then(() => this.save())
    this.saveSequence = next.catch(() => {})
    return next
  }

  private touch(item: AdvancedQueueItem): void {
    item.updatedAt = Date.now()
    this.deps.onItem?.(item)
    void this.saveOrdered().catch((error) => console.warn('[converter] advanced queue persistence failed', error))
    this.emitSummary()
  }

  private emitSummary(): void {
    this.deps.onSummary?.({ running: this.running, active: this.active, queued: this.items.filter((item) => item.status === 'queued').length, total: this.items.length })
  }

  async state(): Promise<AdvancedQueueSnapshot> {
    await this.loaded
    return { schemaVersion: 1, items: this.items.map((item) => ({ ...item })), concurrency: this.concurrency, running: this.running }
  }

  setConcurrency(value: number): number { this.concurrency = clampConcurrency(value); this.emitSummary(); this.pump(); return this.concurrency }

  async add(request: Omit<AdvancedQueueItem, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<AdvancedQueueItem> {
    await this.loaded
    if (this.items.length >= MAX_ITEMS) throw new Error(`Advanced conversion queue is limited to ${MAX_ITEMS.toLocaleString()} pending records`)
    const now = Date.now()
    const item: AdvancedQueueItem = { ...request, id: `adv_${now.toString(36)}_${randomUUID()}`, status: 'queued', createdAt: now, updatedAt: now }
    this.items.push(item)
    await this.saveOrdered()
    this.deps.onItem?.(item)
    this.emitSummary()
    this.pump()
    return item
  }

  async start(): Promise<void> { await this.loaded; this.running = true; this.emitSummary(); this.pump() }
  async pause(): Promise<void> { await this.loaded; this.running = false; this.emitSummary() }

  cancel(id: string): void {
    const item = this.items.find((candidate) => candidate.id === id)
    if (!item || item.status === 'done' || item.status === 'failed' || item.status === 'cancelled') return
    if (item.status === 'running') this.cancellations.get(id)?.abort()
    else { item.status = 'cancelled'; this.touch(item) }
  }

  retry(id: string): void {
    const item = this.items.find((candidate) => candidate.id === id)
    if (!item || (item.status !== 'failed' && item.status !== 'cancelled')) return
    item.status = 'queued'; item.error = undefined; item.result = undefined; item.progress = undefined; this.touch(item); this.pump()
  }

  private pump(): void {
    if (!this.running) return
    while (this.active < this.concurrency) {
      const item = this.items.find((candidate) => candidate.status === 'queued')
      if (!item) break
      this.active++
      void this.run(item).finally(() => { this.active--; this.emitSummary(); this.pump() })
    }
  }

  private async run(item: AdvancedQueueItem): Promise<void> {
    const controller = new AbortController()
    this.cancellations.set(item.id, controller)
    item.status = 'running'; this.touch(item)
    try {
      item.result = await runAdvancedPipeline({ id: item.pipelineId, inputPath: item.inputPath, outputDirectory: item.outputDirectory, options: item.options, signal: controller.signal }, (progress) => { item.progress = progress; this.touch(item) })
      item.status = 'done'; item.progress = { stage: 'complete', completedBytes: item.result.outputs.reduce((sum, output) => sum + output.bytes, 0), totalBytes: item.result.outputs.reduce((sum, output) => sum + output.bytes, 0), message: 'Advanced pipeline complete' }
    } catch (error) {
      item.status = controller.signal.aborted ? 'cancelled' : 'failed'
      item.error = error instanceof Error ? error.message : 'Advanced pipeline failed'
    } finally {
      this.cancellations.delete(item.id); this.touch(item)
    }
  }
}
