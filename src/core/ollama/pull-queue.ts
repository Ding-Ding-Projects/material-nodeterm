// The batch-pull "cart" — see docs/ollama-manager.md for why this is a download queue and never a
// purchase: no price, no checkout, no account. Durable per-item state (crash-recoverable via
// AtomicJsonArrayStore), bounded configurable parallelism, byte-accurate progress straight from
// Ollama's own pull stream, cancellation, retry, and honest partial outcomes — a failed item never
// turns the batch green or deletes an already-valid installed model.

import { join } from 'node:path'
import {
  OLLAMA_PULL_DEFAULT_CONCURRENCY,
  OLLAMA_PULL_MAX_CONCURRENCY,
  isValidModelRef,
  type PullItemStatus,
  type PullQueueItem,
  type PullQueueState
} from '../../shared/ollama'
import { AtomicJsonArrayStore } from '../atomic-json-store'
import type { OllamaClient } from './client'

let nextId = 1
function freshId(): string {
  return `pl_${Date.now().toString(36)}_${(nextId++).toString(36)}`
}

export interface PullQueueDeps {
  userDataDir: string
  client: OllamaClient
  onItemChange?: (item: PullQueueItem) => void
  onSummaryChange?: (summary: Pick<PullQueueState, 'running' | 'concurrency'>) => void
}

export class OllamaPullQueue {
  private readonly store: AtomicJsonArrayStore<PullQueueItem>
  private items: PullQueueItem[] = []
  private byId = new Map<string, PullQueueItem>()
  private concurrency = OLLAMA_PULL_DEFAULT_CONCURRENCY
  private running = false
  private activeRunners = 0
  private controllers = new Map<string, AbortController>()
  private loaded: Promise<void>

  constructor(private readonly deps: PullQueueDeps) {
    this.store = new AtomicJsonArrayStore(join(deps.userDataDir, 'ollama', 'pulls.json'))
    this.loaded = this.store.load().then((items) => {
      this.items = items.map((i) =>
        i.status === 'running' ? { ...i, status: 'queued' as PullItemStatus, updatedAt: Date.now() } : i
      )
      for (const i of this.items) this.byId.set(i.id, i)
    })
  }

  private async ready(): Promise<void> {
    await this.loaded
  }

  private touch(item: PullQueueItem): void {
    item.updatedAt = Date.now()
    this.deps.onItemChange?.(item)
    void this.store.save(this.items)
  }

  private emitSummary(): void {
    this.deps.onSummaryChange?.({ running: this.running, concurrency: this.concurrency })
  }

  async state(): Promise<PullQueueState> {
    await this.ready()
    return { items: this.items, concurrency: this.concurrency, running: this.running }
  }

  async enqueue(refs: string[]): Promise<{ added: PullQueueItem[]; rejected: { ref: string; error: string }[] }> {
    await this.ready()
    const added: PullQueueItem[] = []
    const rejected: { ref: string; error: string }[] = []
    for (const ref of refs) {
      const trimmed = ref.trim()
      if (!isValidModelRef(trimmed)) {
        rejected.push({ ref, error: 'Not a valid "name" or "name:tag" model reference' })
        continue
      }
      if (this.items.some((i) => i.ref === trimmed && (i.status === 'queued' || i.status === 'running'))) {
        rejected.push({ ref, error: 'Already queued or pulling' })
        continue
      }
      const now = Date.now()
      const item: PullQueueItem = {
        id: freshId(),
        ref: trimmed,
        status: 'queued',
        completedBytes: null,
        totalBytes: null,
        digestPhase: null,
        createdAt: now,
        updatedAt: now
      }
      this.items.push(item)
      this.byId.set(item.id, item)
      added.push(item)
      this.deps.onItemChange?.(item)
    }
    await this.store.save(this.items)
    this.pump()
    return { added, rejected }
  }

  setConcurrency(n: number): number {
    this.concurrency = Math.max(1, Math.min(OLLAMA_PULL_MAX_CONCURRENCY, Math.floor(n) || 1))
    this.emitSummary()
    this.pump()
    return this.concurrency
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.emitSummary()
    this.pump()
  }

  pause(): void {
    if (!this.running) return
    this.running = false
    this.emitSummary()
  }

  cancelItem(id: string): void {
    const item = this.byId.get(id)
    if (!item) return
    if (item.status === 'running') {
      this.controllers.get(id)?.abort()
      return
    }
    if (item.status === 'done') return
    item.status = 'cancelled'
    this.touch(item)
  }

  retryItem(id: string): void {
    const item = this.byId.get(id)
    if (!item || (item.status !== 'failed' && item.status !== 'cancelled')) return
    item.status = 'queued'
    item.error = undefined
    this.touch(item)
    this.pump()
  }

  removeItem(id: string): void {
    const item = this.byId.get(id)
    if (!item || item.status === 'running' || item.status === 'queued') return
    this.items = this.items.filter((i) => i.id !== id)
    this.byId.delete(id)
    void this.store.save(this.items)
  }

  private pump(): void {
    if (!this.running) return
    while (this.activeRunners < this.concurrency) {
      const next = this.items.find((i) => i.status === 'queued')
      if (!next) break
      this.activeRunners++
      void this.runItem(next).finally(() => {
        this.activeRunners--
        this.pump()
      })
    }
  }

  private async runItem(item: PullQueueItem): Promise<void> {
    item.status = 'running'
    this.touch(item)
    const ctrl = new AbortController()
    this.controllers.set(item.id, ctrl)
    try {
      await this.deps.client.pull(
        item.ref,
        (evt) => {
          item.digestPhase = evt.status
          if (typeof evt.total === 'number') item.totalBytes = evt.total
          if (typeof evt.completed === 'number') item.completedBytes = evt.completed
          this.touch(item)
        },
        ctrl.signal
      )
      item.status = 'done'
      item.digestPhase = 'success'
      this.touch(item)
    } catch (e) {
      if (ctrl.signal.aborted) {
        item.status = 'cancelled'
      } else {
        item.status = 'failed'
        item.error = (e as Error).message
      }
      this.touch(item)
    } finally {
      this.controllers.delete(item.id)
    }
  }
}
