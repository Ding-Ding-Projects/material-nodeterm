import { promises as fsPromises, readFileSync } from 'node:fs'
import path from 'node:path'
import { IPC } from '../shared/ipc'
import {
  defaultPlannerFile,
  plannerOccurrenceId,
  plannerOccurrencesBetween,
  validatePlannerFile,
  PLANNER_LIMITS,
  type PlannerFile,
  type PlannerLoadState,
  type PlannerOccurrence
} from '../shared/planner-occurrences'
import { platform } from './platform'
import { renameAtomic, tempNameFor } from './fs-atomic'

export interface PlannerOccurrenceNotifier {
  (occurrence: PlannerOccurrence): void
}

export class PlannerOccurrenceStore {
  private file = defaultPlannerFile()
  private loadError: Extract<PlannerLoadState, { ok: false }> | null = null
  private writeChain: Promise<void> = Promise.resolve()
  private readonly filePath = (): string => path.join(platform().userDataDir, 'planner-schedules.json')

  init(): PlannerLoadState {
    let corrupt = false
    try {
      const raw = readFileSync(this.filePath(), 'utf8')
      const parsed: unknown = JSON.parse(raw)
      const error = validatePlannerFile(parsed)
      if (error) {
        corrupt = true
        throw new Error(error)
      }
      this.file = parsed as PlannerFile
      this.loadError = null
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        this.file = defaultPlannerFile()
        this.loadError = null
        return this.loadState()
      }
      const code = (error as NodeJS.ErrnoException)?.code
      const boundedCode = typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : undefined
      this.file = defaultPlannerFile()
      this.loadError = {
        ok: false,
        file: this.file,
        error: {
          kind: corrupt || error instanceof SyntaxError ? 'corrupt' : 'unreadable',
          ...(boundedCode ? { code: boundedCode } : {}),
          path: this.filePath(),
          message: corrupt || error instanceof SyntaxError ? 'Planner data is not valid planner data.' : 'Planner data could not be read.'
        }
      }
    }
    return this.loadState()
  }

  get(): PlannerFile { return this.file }

  loadState(): PlannerLoadState {
    return this.loadError ? this.loadError : { ok: true, file: this.file, error: null }
  }

  async save(next: PlannerFile): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.loadError) return { ok: false, error: 'Planner data is locked until the damaged file is repaired and the app is restarted.' }
    const error = validatePlannerFile(next)
    if (error) return { ok: false, error }
    const run = this.writeChain.then(async () => {
      const filePath = this.filePath()
      const tmp = tempNameFor(filePath)
      await fsPromises.writeFile(tmp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 })
      try {
        await renameAtomic(tmp, filePath)
      } catch (cause) {
        await fsPromises.rm(tmp, { force: true }).catch(() => undefined)
        throw cause
      }
      this.file = next
    })
    this.writeChain = run.catch(() => undefined)
    try {
      await run
      return { ok: true }
    } catch {
      return { ok: false, error: 'Planner data could not be saved.' }
    }
  }
}

export interface PlannerOccurrenceServiceOptions {
  now?: () => number
  notify?: PlannerOccurrenceNotifier
  tickMs?: number
}

const DEFAULT_TICK_MS = 15_000

export class PlannerOccurrenceService {
  private timer: ReturnType<typeof setInterval> | null = null
  private started = false
  private registered = false
  private lastBroadcastId: string | null = null
  private tickInFlight = false
  private tickPromise: Promise<void> | null = null
  private readonly listeners = new Set<PlannerOccurrenceNotifier>()

  constructor(
    private readonly store: PlannerOccurrenceStore,
    private readonly options: PlannerOccurrenceServiceOptions = {}
  ) {}

  start(): void {
    if (this.started) return
    this.started = true
    if (!this.registered) {
      this.registerIpc()
      this.registered = true
    }
    this.tick()
    this.timer = setInterval(() => this.tick(), this.options.tickMs ?? DEFAULT_TICK_MS)
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const pending = this.tickPromise
    if (pending) await pending.catch(() => undefined)
    this.started = false
  }

  hasEnabledSchedules(): boolean {
    return this.store.get().schedules.some((schedule) => schedule.enabled)
  }

  /** Integration seam for future Calendar, Timer, and Alarm nodes. The callback receives only a
   * durable occurrence record, never a credential, process handle, or machine path. */
  onOccurrence(listener: PlannerOccurrenceNotifier): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private registerIpc(): void {
    platform().handle(IPC.plannerLoad, () => this.store.loadState())
    platform().handle(IPC.plannerSave, (file: PlannerFile) => this.store.save(file))
    platform().handle(IPC.plannerHistory, () => this.store.get().occurrences)
    platform().handle(IPC.plannerExport, (format: 'json' | 'csv') => this.exportData(format))
  }

  private exportData(format: 'json' | 'csv'): { filename: string; content: string } {
    const occurrences = this.store.get().occurrences
    if (format === 'json') return { filename: 'planner-occurrences.json', content: JSON.stringify({ version: 1, occurrences }, null, 2) }
    const quote = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`
    const rows = occurrences.map((occurrence) => [occurrence.id, occurrence.scheduleId, occurrence.scheduledAtMs, occurrence.observedAtMs, occurrence.status, occurrence.title, occurrence.body].map(quote).join(','))
    return { filename: 'planner-occurrences.csv', content: ['id,scheduleId,scheduledAtMs,observedAtMs,status,title,body', ...rows].join('\n') + '\n' }
  }

  private tick(): void {
    if (this.tickInFlight) return
    this.tickInFlight = true
    const pending = this.tickNow().finally(() => {
      this.tickInFlight = false
      if (this.tickPromise === pending) this.tickPromise = null
    })
    this.tickPromise = pending
  }

  private async tickNow(): Promise<void> {
    const file = this.store.get()
    const now = this.options.now?.() ?? Date.now()
    const from = file.lastTickMs ?? now - DEFAULT_TICK_MS
    if (now < from) {
      await this.store.save({ ...file, lastTickMs: now })
      return
    }
    const known = new Set(file.occurrences.map((occurrence) => occurrence.id))
    const additions: PlannerOccurrence[] = []
    for (const schedule of file.schedules) {
      const due = plannerOccurrencesBetween(schedule, from, now)
      for (const scheduledAtMs of due.slice(0, PLANNER_LIMITS.maxCatchUpOccurrences)) {
        const id = plannerOccurrenceId(schedule.id, scheduledAtMs)
        if (known.has(id)) continue
        const missed = scheduledAtMs < now - PLANNER_LIMITS.missedGraceMs
        const occurrence: PlannerOccurrence = {
          id,
          scheduleId: schedule.id,
          scheduledAtMs,
          observedAtMs: now,
          status: missed ? 'missed' : 'fired',
          title: schedule.notification.title,
          body: schedule.notification.body
        }
        known.add(id)
        additions.push(occurrence)
        if (!missed) this.deliver(occurrence)
      }
    }
    if (additions.length === 0 && file.lastTickMs === now) return
    const next: PlannerFile = {
      ...file,
      lastTickMs: now,
      occurrences: [...file.occurrences, ...additions].slice(-PLANNER_LIMITS.maxOccurrences)
    }
    await this.store.save(next)
  }

  private deliver(occurrence: PlannerOccurrence): void {
    if (this.lastBroadcastId === occurrence.id) return
    this.lastBroadcastId = occurrence.id
    platform().broadcast(IPC.plannerOccurrence, occurrence)
    this.listeners.forEach((listener) => {
      try {
        listener(occurrence)
      } catch {
        // One future consumer must not prevent notification delivery to the other consumers.
      }
    })
    this.options.notify?.(occurrence)
  }
}

export class PlannerOccurrenceRuntime {
  readonly store: PlannerOccurrenceStore
  readonly service: PlannerOccurrenceService
  private started = false

  constructor(options: PlannerOccurrenceServiceOptions = {}, store = new PlannerOccurrenceStore()) {
    this.store = store
    this.service = new PlannerOccurrenceService(store, options)
  }

  start(): PlannerLoadState {
    const state = this.store.init()
    if (!this.started) {
      this.service.start()
      this.started = true
    }
    return state
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    await this.service.stop()
  }

  hasEnabledSchedules(): boolean {
    return this.service.hasEnabledSchedules()
  }

  onOccurrence(listener: PlannerOccurrenceNotifier): () => void {
    return this.service.onOccurrence(listener)
  }
}
