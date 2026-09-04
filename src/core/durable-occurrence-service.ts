import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { renameAtomic, writeFileAtomic } from './fs-atomic'
import { IPC } from '../shared/ipc'
import { platform } from './platform'
import {
  DURABLE_OCCURRENCE_LIMITS,
  defaultDurableOccurrenceSnapshot,
  durableOccurrenceId,
  durableOccurrenceTimes,
  isDurableTimezone,
  validateDurableOccurrenceSnapshot,
  type DurableAlarmNode,
  type DurableOccurrence,
  type DurableOccurrenceLoadState,
  type DurableOccurrenceSnapshot,
  type DurableSchedule,
  type DurableTimerNode
} from '../shared/durable-occurrences'

export interface DurableOccurrenceStore {
  load(): Promise<DurableOccurrenceSnapshot | null>
  save(snapshot: DurableOccurrenceSnapshot, expectedGeneration: number): Promise<void>
}

export class FileDurableOccurrenceStore implements DurableOccurrenceStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<DurableOccurrenceSnapshot | null> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      const error = validateDurableOccurrenceSnapshot(raw)
      if (error) throw new Error(error)
      return raw as DurableOccurrenceSnapshot
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
      return null
    }
  }

  async save(snapshot: DurableOccurrenceSnapshot, expectedGeneration: number): Promise<void> {
    const existing = await this.load()
    if (existing && existing.generation !== expectedGeneration) throw new Error('Durable occurrence generation changed; retry the command.')
    if (!existing && expectedGeneration !== 0) throw new Error('Durable occurrence base generation is missing.')
    const error = validateDurableOccurrenceSnapshot(snapshot)
    if (error) throw new Error(error)
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFileAtomic(tmp, JSON.stringify(snapshot, null, 2), { mode: 0o600 })
      await renameAtomic(tmp, this.filePath)
    } finally {
      await import('node:fs/promises').then(({ rm }) => rm(tmp, { force: true }).catch(() => undefined))
    }
  }
}

// Imported AND re-exported, not redeclared: `shared/types.ts` declares NodeTerminalApi.claim()
// against the shared copy, so two independent unions here would be two contracts across one
// seam. The plain `export type { X } from` form would re-export without binding the name
// locally, and this file uses it in three places.
import type { DurableDeliveryResult } from '../shared/durable-occurrences'
export type { DurableDeliveryResult }
export interface DurableDeliveryRequest {
  occurrence: DurableOccurrence
  /** Stable occurrence key. Consumers must treat retries as idempotent. */
  idempotencyKey: string
}
export interface DurableOccurrenceServiceOptions {
  nowWallMs?: () => number
  nowMonotonicMs?: () => number
  intervalMs?: number
  deliveryDeadlineMs?: number
  store: DurableOccurrenceStore
  deliver?: (request: DurableDeliveryRequest) => DurableDeliveryResult | Promise<DurableDeliveryResult>
  history?: (label: string, snapshot: DurableOccurrenceSnapshot) => void | Promise<void>
}

const wallNow = (): number => Date.now()
const monotonicNow = (): number => Math.round(Number(process.hrtime.bigint() / 1_000_000n))
const clone = <T>(value: T): T => structuredClone(value)
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

/**
 * One host-owned planner for schedules, alarms, and timer projections. Every command is serialized
 * and every publication carries a generation CAS. This prevents a stale renderer snapshot from
 * erasing an occurrence created by a second client.
 */
export class DurableOccurrenceService {
  private snapshot: DurableOccurrenceSnapshot = defaultDurableOccurrenceSnapshot()
  private loadError: DurableOccurrenceLoadState['error'] | null = null
  private commandTail: Promise<unknown> = Promise.resolve()
  private timer: ReturnType<typeof setInterval> | null = null
  private started = false
  private readonly monotonicClockId = randomUUID()
  private restartDetected = false
  private readonly listeners = new Set<(snapshot: DurableOccurrenceSnapshot) => void>()
  private deliveryClient: ((request: DurableDeliveryRequest) => DurableDeliveryResult | Promise<DurableDeliveryResult>) | undefined

  constructor(private readonly options: DurableOccurrenceServiceOptions) {}

  async start(): Promise<DurableOccurrenceLoadState> {
    if (this.started) return this.loadState()
    let loaded: DurableOccurrenceSnapshot | null = null
    try {
      loaded = await this.options.store.load()
    } catch {
      this.snapshot = defaultDurableOccurrenceSnapshot()
      this.loadError = { kind: 'corrupt', message: 'Durable occurrence data is unavailable until the damaged file is repaired.' }
    }
    if (loaded) {
      this.snapshot = clone(loaded)
      this.loadError = null
      this.restartDetected = this.snapshot.monotonicClockId !== null && this.snapshot.monotonicClockId !== this.monotonicClockId
    } else if (!this.loadError) {
      this.snapshot = defaultDurableOccurrenceSnapshot()
      this.loadError = null
    }
    if (this.loadError) return this.loadState()
    const before = clone(this.snapshot)
    try {
      this.snapshot.monotonicClockId = this.monotonicClockId
      await this.persist('monotonic clock identity')
      this.started = true
      await this.reconcile()
      this.timer = setInterval(() => { void Promise.all([this.reconcile(), this.timerTick()]) }, this.options.intervalMs ?? 15_000)
      this.timer.unref?.()
      return this.loadState()
    } catch (error) {
      this.snapshot = before
      this.started = false
      throw error
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.enqueue(async () => { await this.persist('shutdown flush') })
    this.started = false
  }

  loadState(): DurableOccurrenceLoadState {
    return this.loadError
      ? { ok: false, snapshot: clone(this.snapshot), error: this.loadError }
      : { ok: true, snapshot: clone(this.snapshot), error: null }
  }
  getState(): DurableOccurrenceSnapshot { return clone(this.snapshot) }
  onChanged(listener: (snapshot: DurableOccurrenceSnapshot) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  registerDeliveryClient(listener: (request: DurableDeliveryRequest) => DurableDeliveryResult | Promise<DurableDeliveryResult>): () => void {
    const previous = this.deliveryClient
    this.deliveryClient = listener
    void this.reconcilePending()
    return () => { if (this.deliveryClient === listener) this.deliveryClient = previous }
  }

  async save(next: DurableOccurrenceSnapshot, expectedGeneration: number): Promise<{ ok: true; generation: number } | { ok: false; error: string }> {
    return this.enqueue(async () => {
      if (this.loadError) return { ok: false as const, error: this.loadError.message }
      if (expectedGeneration !== this.snapshot.generation) return { ok: false as const, error: 'The schedule changed in another client. Reload before saving.' }
      const shapeError = validateDurableOccurrenceSnapshot(next)
      if (shapeError) return { ok: false as const, error: shapeError }
      const candidate = clone(next)
      const scheduleIds = new Set(candidate.schedules.map((item) => item.id))
      const alarmIds = new Set(candidate.alarms.map((item) => item.id))
      const timerIds = new Set(candidate.timers.map((item) => item.id))
      // Source deletion is not history deletion. Keep every old occurrence, but turn an
      // in-flight delivery into an explicit cancelled record so it cannot fire after its source
      // was removed and the relational validator can still prove the snapshot is coherent.
      for (const row of candidate.occurrences) {
        const missing = (row.kind === 'planner' && !scheduleIds.has(row.sourceId)) || (row.kind === 'alarm' && !alarmIds.has(row.sourceId)) || (row.kind === 'timer' && !timerIds.has(row.sourceId))
        if (missing && !['delivered', 'missed', 'dismissed'].includes(row.status)) { row.status = 'cancelled'; row.delivery.claimId = null; row.delivery.claimedAtMs = null; row.delivery.outcome = 'not-attempted'; row.delivery.error = null }
      }
      const error = validateDurableOccurrenceSnapshot(candidate)
      if (error) return { ok: false as const, error }
      candidate.generation = this.snapshot.generation + 1
      await this.options.store.save(candidate, this.snapshot.generation)
      this.snapshot = candidate
      await this.recordHistory('schedules changed')
      this.emit()
      return { ok: true as const, generation: candidate.generation }
    })
  }

  async importSchedules(raw: unknown): Promise<{ ok: true; generation: number } | { ok: false; error: string }> {
    return this.enqueue(async () => {
      let bytes = 0
      try { bytes = Buffer.byteLength(JSON.stringify(raw), 'utf8') } catch { return { ok: false as const, error: 'The schedule import is not valid JSON.' } }
      if (bytes > DURABLE_OCCURRENCE_LIMITS.maxImportBytes) return { ok: false as const, error: 'The schedule import is too large.' }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false as const, error: 'The schedule import is malformed.' }
      const value = raw as Record<string, unknown>
      const keys = Object.keys(value).sort().join(',')
      if (keys !== 'alarms,occurrences,schedules,timers,version' || value.version !== 1 || !Array.isArray(value.schedules) || !Array.isArray(value.alarms) || !Array.isArray(value.timers) || !Array.isArray(value.occurrences)) return { ok: false as const, error: 'The schedule and history import version or fields are unsupported.' }
      const candidate = clone(this.snapshot)
      candidate.schedules = value.schedules as DurableSchedule[]
      candidate.alarms = value.alarms as DurableAlarmNode[]
      candidate.timers = value.timers as DurableTimerNode[]
      candidate.occurrences = value.occurrences as DurableOccurrence[]
      const error = validateDurableOccurrenceSnapshot(candidate)
      if (error) return { ok: false as const, error }
      candidate.generation += 1
      await this.options.store.save(candidate, this.snapshot.generation)
      this.snapshot = candidate
      await this.recordHistory('schedules imported')
      this.emit()
      return { ok: true as const, generation: candidate.generation }
    })
  }

  async upsertAlarm(alarm: DurableAlarmNode): Promise<{ ok: true; generation: number } | { ok: false; error: string }> {
    return this.mutateSource('alarm', alarm)
  }
  async upsertTimer(timer: DurableTimerNode): Promise<{ ok: true; generation: number } | { ok: false; error: string }> {
    return this.mutateSource('timer', timer)
  }
  async removeSource(kind: 'planner' | 'alarm' | 'timer', id: string): Promise<{ ok: true; generation: number } | { ok: false; error: string }> {
    if (!['planner', 'alarm', 'timer'].includes(kind) || typeof id !== 'string' || !SAFE_ID.test(id)) return { ok: false, error: 'The source kind or id is invalid.' }
    return this.enqueue(async () => {
      const next = clone(this.snapshot)
      if (kind === 'planner') next.schedules = next.schedules.filter((item) => item.id !== id)
      if (kind === 'alarm') next.alarms = next.alarms.filter((item) => item.id !== id)
      if (kind === 'timer') next.timers = next.timers.filter((item) => item.id !== id)
      next.occurrences = next.occurrences.map((row) => row.kind === kind && row.sourceId === id && !['delivered', 'missed', 'dismissed'].includes(row.status) ? { ...row, status: 'cancelled' as const, delivery: { ...row.delivery, claimId: null, claimedAtMs: null, outcome: 'not-attempted' as const, error: null } } : row)
      next.generation += 1
      const error = validateDurableOccurrenceSnapshot(next); if (error) return { ok: false as const, error }
      await this.options.store.save(next, this.snapshot.generation); this.snapshot = next; await this.recordHistory(`${kind} removed`); this.emit(); return { ok: true as const, generation: next.generation }
    })
  }

  exportSchedules(): { filename: string; content: string } {
    return { filename: 'planner-alarm-schedules-and-history.json', content: JSON.stringify({ version: 1, schedules: this.snapshot.schedules, alarms: this.snapshot.alarms, timers: this.snapshot.timers, occurrences: this.snapshot.occurrences }, null, 2) }
  }

  async reconcile(wallMs = this.options.nowWallMs?.() ?? wallNow(), monotonicMs = this.options.nowMonotonicMs?.() ?? monotonicNow()): Promise<void> {
    await this.enqueue(async () => {
      if (this.loadError) return
      const previousWall = this.snapshot.lastWallClockMs
      const previousMono = this.snapshot.lastMonotonicMs
      const backward = previousWall !== null && wallMs < previousWall
      const slept = previousMono !== null && monotonicMs - previousMono > (this.options.intervalMs ?? 15_000) * 3
      if (this.restartDetected || backward || slept) {
        await this.appendReconciliation(backward ? 'clock-adjusted' : 'power-off-not-supported', wallMs)
        this.restartDetected = false
      }
      const from = previousWall ?? wallMs
      const additions: DurableOccurrence[] = []
      const known = new Set(this.snapshot.occurrences.map((row) => row.id))
      for (const row of this.snapshot.occurrences) {
        if (row.status === 'snoozed' && row.scheduledAtMs <= wallMs) {
          row.status = 'intent'
          row.delivery.claimId = null
          row.delivery.claimedAtMs = null
          row.delivery.outcome = 'not-attempted'
          row.delivery.error = null
        }
      }
      for (const source of [...this.snapshot.schedules.map((item) => ({ kind: 'planner' as const, item })), ...this.snapshot.alarms.map((item) => ({ kind: 'alarm' as const, item }))]) {
        const result = durableOccurrenceTimes(source.item, Math.min(from, wallMs), wallMs)
        for (const scheduledAtMs of result.times) {
          const id = durableOccurrenceId(source.kind, source.item.id, scheduledAtMs)
          if (known.has(id)) continue
          const notification = 'notification' in source.item ? source.item.notification : { title: source.item.title, body: '', soundEnabled: source.item.soundEnabled, narratorEnabled: source.item.narratorEnabled }
          const local = this.localFor(scheduledAtMs, source.item.timeZone)
          const missed = wallMs - scheduledAtMs > 120_000
          additions.push({ id, kind: source.kind, sourceId: source.item.id, scheduledAtMs, observedAtMs: wallMs, local, status: missed ? 'missed' : 'intent', title: notification.title, body: notification.body, soundEnabled: notification.soundEnabled, narratorEnabled: notification.narratorEnabled, delivery: { idempotencyKey: id, generation: 0, acknowledgedAtMs: null, claimId: null, claimedAtMs: null, outcome: 'not-attempted', error: null }, reason: 'none' })
          known.add(id)
        }
        if (result.truncated) additions.push(this.truncation(source.kind, source.item.id, wallMs, source.item.timeZone))
      }
      // Timers may be scheduled while no canvas is open. Their next occurrence is a single
      // host-owned intent, not renderer state, so a closed project still gets one delivery.
      for (const timer of this.snapshot.timers) {
        const scheduledAtMs = timer.data.nextOccurrenceAt
        if (scheduledAtMs === null || scheduledAtMs > wallMs) continue
        const id = durableOccurrenceId('timer', timer.id, scheduledAtMs)
        if (known.has(id)) continue
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
        const timeZone = isDurableTimezone(zone) ? zone : 'UTC'
        const local = this.localFor(scheduledAtMs, timeZone)
        const missed = wallMs - scheduledAtMs > 120_000
        additions.push({ id, kind: 'timer', sourceId: timer.id, scheduledAtMs, observedAtMs: wallMs, local, status: missed ? 'missed' : 'intent', title: timer.title, body: 'Timer scheduled.', soundEnabled: timer.data.alarmEnabled && timer.data.alarmTone !== 'silent', narratorEnabled: false, delivery: { idempotencyKey: id, generation: 0, acknowledgedAtMs: null, claimId: null, claimedAtMs: null, outcome: 'not-attempted', error: null }, reason: 'none' })
        known.add(id)
        timer.data.nextOccurrenceAt = null
      }
      if (additions.length || previousWall !== wallMs || previousMono !== monotonicMs) {
        this.snapshot.occurrences = retainOccurrenceHistory([...this.snapshot.occurrences, ...additions])
        this.snapshot.lastWallClockMs = wallMs
        this.snapshot.lastMonotonicMs = monotonicMs
        await this.persist('occurrences reconciled')
        this.emit()
      }
      await this.deliverPending()
    })
  }

  async claimAndDeliver(id: string): Promise<DurableDeliveryResult> {
    if (typeof id !== 'string' || !SAFE_ID.test(id)) return 'failed'
    return this.enqueue(() => this.claimAndDeliverNow(id))
  }

  /** Host-owned timer transitions. The renderer may render a live projection, but only this
   *  monotonic clock advances elapsed/remaining time and only this service consumes the tone. */
  async timerTransition(id: string, action: 'start' | 'pause' | 'resume' | 'cancel' | 'reset', wallMs = this.options.nowWallMs?.() ?? wallNow(), monotonicMs = this.options.nowMonotonicMs?.() ?? monotonicNow()): Promise<DurableTimerNode | null> {
    if (typeof id !== 'string' || !SAFE_ID.test(id) || !['start', 'pause', 'resume', 'cancel', 'reset'].includes(action) || !Number.isSafeInteger(wallMs) || !Number.isSafeInteger(monotonicMs)) return null
    return this.enqueue(async () => {
      const timer = this.snapshot.timers.find((item) => item.id === id)
      if (!timer) return null
      const data = timer.data
      if (action === 'start' || action === 'resume') {
        if (data.occurrenceState === 'completed' || data.occurrenceState === 'cancelled') return null
        data.running = true; data.paused = false; data.occurrenceState = 'running'; data.wallAnchorMs = wallMs; data.monotonicAnchorMs = monotonicMs
      } else if (action === 'pause') {
        if (!data.running || data.paused) return clone(timer)
        this.advanceTimer(timer, monotonicMs)
        data.running = false; data.paused = true; data.occurrenceState = 'paused'; data.wallAnchorMs = null; data.monotonicAnchorMs = null
      } else if (action === 'cancel') {
        data.running = false; data.paused = false; data.occurrenceState = 'cancelled'; data.wallAnchorMs = null; data.monotonicAnchorMs = null
      } else {
        data.running = false; data.paused = false; data.remainingMs = data.durationMs; data.elapsedMs = 0; data.repeatRemaining = data.repeatCount; data.sequenceIndex = 0; data.lapsMs = []; data.occurrenceState = 'scheduled'; data.wallAnchorMs = null; data.monotonicAnchorMs = null
      }
      timer.updatedAtMs = wallMs
      await this.persist(`timer ${action}`)
      this.emit()
      return clone(timer)
    })
  }

  async timerLap(id: string, wallMs = this.options.nowWallMs?.() ?? wallNow(), monotonicMs = this.options.nowMonotonicMs?.() ?? monotonicNow()): Promise<number[] | null> {
    if (typeof id !== 'string' || !SAFE_ID.test(id) || !Number.isSafeInteger(wallMs) || !Number.isSafeInteger(monotonicMs)) return null
    return this.enqueue(async () => {
      const timer = this.snapshot.timers.find((item) => item.id === id)
      if (!timer || !timer.data.running || timer.data.paused) return null
      this.advanceTimer(timer, monotonicMs)
      timer.data.monotonicAnchorMs = monotonicMs
      timer.data.wallAnchorMs = wallMs
      timer.data.lapsMs.push(Math.max(0, timer.data.elapsedMs))
      timer.updatedAtMs = wallMs
      await this.persist('timer lap')
      this.emit()
      return [...timer.data.lapsMs]
    })
  }

  async timerTick(wallMs = this.options.nowWallMs?.() ?? wallNow(), monotonicMs = this.options.nowMonotonicMs?.() ?? monotonicNow()): Promise<void> {
    if (!Number.isSafeInteger(wallMs) || !Number.isSafeInteger(monotonicMs)) return
    await this.enqueue(async () => {
      let changed = false
      for (const timer of this.snapshot.timers) {
        if (!timer.data.running || timer.data.paused || timer.data.monotonicAnchorMs === null) continue
        this.advanceTimer(timer, monotonicMs)
        timer.data.monotonicAnchorMs = monotonicMs; timer.data.wallAnchorMs = wallMs; timer.updatedAtMs = wallMs; changed = true
        if (timer.data.occurrenceState === 'completed' && timer.data.alarmEnabled) await this.appendTimerCompletion(timer, wallMs)
      }
      if (changed) { await this.persist('timer tick'); this.emit(); await this.deliverPending() }
    })
  }

  async snooze(id: string, minutes: number): Promise<boolean> {
    if (typeof id !== 'string' || !SAFE_ID.test(id)) return false
    return this.enqueue(async () => { const row = this.snapshot.occurrences.find((item) => item.id === id); if (!row || (row.status !== 'delivered' && row.status !== 'pending' && row.status !== 'failed') || !Number.isFinite(minutes) || !Number.isSafeInteger(Math.round(minutes))) return false; row.status = 'snoozed'; row.delivery.generation += 1; row.delivery.idempotencyKey = `${row.id}:${row.delivery.generation}`; row.delivery.outcome = 'not-attempted'; row.delivery.claimId = null; row.delivery.claimedAtMs = null; row.delivery.error = null; row.scheduledAtMs = (this.options.nowWallMs?.() ?? wallNow()) + Math.max(1, Math.min(DURABLE_OCCURRENCE_LIMITS.maxSnoozeMinutes, Math.round(minutes))) * 60_000; await this.persist('occurrence snoozed'); this.emit(); return true })
  }
  async dismiss(id: string): Promise<boolean> { if (typeof id !== 'string' || !SAFE_ID.test(id)) return false; return this.enqueue(async () => { const row = this.snapshot.occurrences.find((item) => item.id === id); if (!row || row.status === 'dismissed') return false; row.status = 'dismissed'; row.delivery.outcome = 'not-attempted'; await this.persist('occurrence dismissed'); this.emit(); return true }) }
  async acknowledge(id: string, deliveryGeneration: number): Promise<boolean> {
    if (typeof id !== 'string' || !SAFE_ID.test(id) || !Number.isSafeInteger(deliveryGeneration) || deliveryGeneration < 0) return false
    return this.enqueue(async () => {
      const row = this.snapshot.occurrences.find((item) => item.id === id)
      if (!row || row.status !== 'delivered' || row.delivery.generation !== deliveryGeneration || row.delivery.acknowledgedAtMs !== null) return false
      row.delivery.acknowledgedAtMs = this.options.nowWallMs?.() ?? wallNow()
      await this.persist('occurrence acknowledged')
      this.emit()
      return true
    })
  }

  private async deliverPending(): Promise<void> { for (const row of [...this.snapshot.occurrences]) if (row.status === 'intent' || row.status === 'pending' || row.status === 'failed' || (row.status === 'claimed' && row.delivery.claimedAtMs !== null && (this.options.nowWallMs?.() ?? wallNow()) - row.delivery.claimedAtMs >= DURABLE_OCCURRENCE_LIMITS.claimLeaseMs)) { try { await this.claimAndDeliverNow(row.id) } catch { /* a crash or consumer failure leaves the durable claim for bounded recovery */ } } }
  private async reconcilePending(): Promise<void> { await this.enqueue(() => this.deliverPending()) }
  private localFor(epochMs: number, timeZone: string): DurableOccurrence['local'] { const date = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(epochMs)); const time = new Intl.DateTimeFormat('sv-SE', { timeZone, hour12: false, hour: '2-digit', minute: '2-digit' }).format(new Date(epochMs)); return { timeZone, date, time } }
  private truncation(kind: 'planner' | 'alarm', sourceId: string, now: number, timeZone: string): DurableOccurrence { return { id: durableOccurrenceId('reconciliation', sourceId, now), kind: 'reconciliation', sourceId, scheduledAtMs: now, observedAtMs: now, local: this.localFor(now, timeZone), status: 'missed', title: 'Missed occurrences', body: 'Catch-up was truncated at the host safety limit.', soundEnabled: false, narratorEnabled: false, delivery: { idempotencyKey: durableOccurrenceId('reconciliation', sourceId, now), generation: 0, acknowledgedAtMs: null, claimId: null, claimedAtMs: null, outcome: 'not-attempted', error: null }, reason: 'catch-up-truncated' } }
  private async appendReconciliation(reason: 'clock-adjusted' | 'power-off-not-supported', now: number): Promise<void> { const zone = Intl.DateTimeFormat().resolvedOptions().timeZone; const local = this.localFor(now, isDurableTimezone(zone) ? zone : 'UTC'); const id = durableOccurrenceId('reconciliation', reason, now); if (this.snapshot.occurrences.some((row) => row.id === id)) return; this.snapshot.occurrences.push({ id, kind: 'reconciliation', sourceId: reason, scheduledAtMs: now, observedAtMs: now, local, status: 'missed', title: reason === 'clock-adjusted' ? 'Clock adjusted' : 'Power-off wake unavailable', body: reason === 'clock-adjusted' ? 'The host clock moved; wall-clock schedules were reconciled conservatively.' : 'A powered-off host cannot deliver an occurrence until it is running again.', soundEnabled: false, narratorEnabled: false, delivery: { idempotencyKey: id, generation: 0, acknowledgedAtMs: null, claimId: null, claimedAtMs: null, outcome: 'not-attempted', error: null }, reason }) }
  private async persist(label: string): Promise<void> { const next = clone(this.snapshot); next.generation += 1; await this.options.store.save(next, this.snapshot.generation); this.snapshot = next; await this.recordHistory(label) }
  private async recordHistory(label: string): Promise<void> { try { await this.options.history?.(label, clone(this.snapshot)) } catch { /* history failure never loses the requested mutation */ } }
  private async mutateSource(kind: 'alarm' | 'timer', item: DurableAlarmNode | DurableTimerNode): Promise<{ ok: true; generation: number } | { ok: false; error: string }> {
    return this.enqueue(async () => {
      const next = clone(this.snapshot)
      if (kind === 'alarm') { const value = item as DurableAlarmNode; next.alarms = [...next.alarms.filter((entry) => entry.id !== value.id), value] }
      else { const value = item as DurableTimerNode; next.timers = [...next.timers.filter((entry) => entry.id !== value.id), value] }
      next.generation += 1
      const error = validateDurableOccurrenceSnapshot(next); if (error) return { ok: false as const, error }
      await this.options.store.save(next, this.snapshot.generation); this.snapshot = next; await this.recordHistory(`${kind} changed`); this.emit(); return { ok: true as const, generation: next.generation }
    })
  }
  private emit(): void { const value = clone(this.snapshot); for (const listener of this.listeners) { try { listener(value) } catch { /* one UI cannot stop another client receiving state */ } } try { platform().broadcast(IPC.durableOccurrencesChanged, value) } catch { /* pure source tests may not install a host */ } }
  private enqueue<T>(command: () => Promise<T>): Promise<T> {
    const run = this.commandTail.then(async () => {
      const before = clone(this.snapshot)
      try { return await command() } catch (error) {
        // A failed CAS, disk write, or validation must not leave optimistic renderer state in the
        // live host object. The persisted file remains the previous generation, so restore that
        // exact snapshot before allowing the next serialized command to run.
        this.snapshot = before
        throw error
      }
    })
    this.commandTail = run.catch(() => undefined)
    return run
  }
  private async claimAndDeliverNow(id: string): Promise<DurableDeliveryResult> {
    const row = this.snapshot.occurrences.find((item) => item.id === id)
    if (!row || row.status === 'missed' || row.status === 'delivered' || row.status === 'dismissed' || row.status === 'cancelled') return row?.delivery.outcome === 'delivered' ? 'delivered' : 'failed'
    const now = this.options.nowWallMs?.() ?? wallNow()
    if (row.status === 'claimed' && row.delivery.claimedAtMs !== null && now - row.delivery.claimedAtMs < DURABLE_OCCURRENCE_LIMITS.claimLeaseMs) return 'pending'
    row.status = 'claimed'
    row.delivery.claimId = randomUUID()
    row.delivery.claimedAtMs = now
    await this.persist('delivery claim')
    // persist() replaces the snapshot with its cloned generation, so never keep mutating the
    // pre-publication object. Re-read the claimed row or the outcome silently remains `claimed`.
    const claimed = this.snapshot.occurrences.find((item) => item.id === id)
    if (!claimed) return 'failed'
    let result: DurableDeliveryResult = 'pending'
    try { result = await this.deliverWithDeadline({ occurrence: clone(claimed), idempotencyKey: claimed.delivery.idempotencyKey }) } catch { result = 'failed' }
    claimed.delivery.outcome = result
    claimed.delivery.error = result === 'failed' ? 'The host notification consumer rejected the delivery.' : null
    claimed.status = result === 'delivered' ? 'delivered' : result === 'failed' ? 'failed' : 'pending'
    await this.persist('delivery outcome')
    this.emit()
    return result
  }

  private advanceTimer(timer: DurableTimerNode, monotonicMs: number): void {
    const anchor = timer.data.monotonicAnchorMs
    if (!timer.data.running || timer.data.paused || anchor === null) return
    const delta = Math.max(0, monotonicMs - anchor)
    timer.data.elapsedMs += delta
    if (timer.data.timerMode === 'stopwatch') return
    timer.data.remainingMs = Math.max(0, timer.data.remainingMs - delta)
    if (timer.data.remainingMs > 0) return
    if (timer.data.repeatRemaining > 0) {
      timer.data.repeatRemaining -= 1
      timer.data.remainingMs = timer.data.durationMs
      timer.data.occurrenceState = 'running'
      return
    }
    timer.data.running = false; timer.data.occurrenceState = 'completed'; timer.data.monotonicAnchorMs = null; timer.data.wallAnchorMs = null
  }
  private async appendTimerCompletion(timer: DurableTimerNode, now: number): Promise<void> {
    const id = durableOccurrenceId('timer', timer.id, now)
    if (this.snapshot.occurrences.some((row) => row.id === id)) return
    const local = this.localFor(now, isDurableTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone) ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC')
    this.snapshot.occurrences.push({ id, kind: 'timer', sourceId: timer.id, scheduledAtMs: now, observedAtMs: now, local, status: 'intent', title: timer.title, body: timer.data.alarmTone === 'silent' ? 'Timer completed.' : `Timer completed: ${timer.data.alarmTone}.`, soundEnabled: timer.data.alarmTone !== 'silent', narratorEnabled: false, delivery: { idempotencyKey: id, generation: 0, acknowledgedAtMs: null, claimId: null, claimedAtMs: null, outcome: 'not-attempted', error: null }, reason: 'none' })
  }
  private async deliverWithDeadline(request: DurableDeliveryRequest): Promise<DurableDeliveryResult> {
    const deliver = this.deliveryClient ?? this.options.deliver
    if (!deliver) return 'pending'
    const deadlineMs = Math.max(100, Math.min(30_000, this.options.deliveryDeadlineMs ?? 5_000))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        Promise.resolve(deliver(request)),
        new Promise<DurableDeliveryResult>((resolve) => { timer = setTimeout(() => resolve('failed'), deadlineMs); timer.unref?.() })
      ])
    } finally { if (timer) clearTimeout(timer) }
  }
}

function retainOccurrenceHistory(rows: DurableOccurrence[]): DurableOccurrence[] {
  if (rows.length <= DURABLE_OCCURRENCE_LIMITS.maxOccurrences) return rows
  const terminal = new Set(['delivered', 'missed', 'dismissed', 'cancelled'])
  const live = rows.filter((row) => !terminal.has(row.status))
  const finished = rows.filter((row) => terminal.has(row.status))
  const keepFinished = Math.max(0, DURABLE_OCCURRENCE_LIMITS.maxOccurrences - live.length)
  // Nonterminal intent, claim, pending, failed, and snoozed records are never silently pruned.
  return [...live, ...finished.slice(-keepFinished)]
}

export function registerDurableOccurrenceHandlers(service: DurableOccurrenceService): void {
  platform().handle(IPC.durableOccurrencesLoad, () => service.loadState())
  platform().handle(IPC.durableOccurrencesSave, (snapshot: DurableOccurrenceSnapshot, generation: number) => service.save(snapshot, generation))
  platform().handle(IPC.durableOccurrencesReconcile, (wallMs?: number, monotonicMs?: number) => service.reconcile(wallMs, monotonicMs))
  platform().handle(IPC.durableOccurrencesClaim, (id: string) => service.claimAndDeliver(id))
  platform().handle(IPC.durableOccurrencesSnooze, (id: string, minutes: number) => service.snooze(id, minutes))
  platform().handle(IPC.durableOccurrencesDismiss, (id: string) => service.dismiss(id))
  platform().handle(IPC.durableOccurrencesExport, () => service.exportSchedules())
  platform().handle(IPC.durableOccurrencesImport, (raw: unknown) => service.importSchedules(raw))
  platform().handle(IPC.durableOccurrencesTimerTransition, (id: string, action: 'start' | 'pause' | 'resume' | 'cancel' | 'reset', wallMs?: number, monotonicMs?: number) => service.timerTransition(id, action, wallMs, monotonicMs))
  platform().handle(IPC.durableOccurrencesTimerLap, (id: string, wallMs?: number, monotonicMs?: number) => service.timerLap(id, wallMs, monotonicMs))
  platform().handle(IPC.durableOccurrencesTimerTick, (wallMs?: number, monotonicMs?: number) => service.timerTick(wallMs, monotonicMs))
  platform().handle(IPC.durableOccurrencesUpsertAlarm, (alarm: DurableAlarmNode) => service.upsertAlarm(alarm))
  platform().handle(IPC.durableOccurrencesUpsertTimer, (timer: DurableTimerNode) => service.upsertTimer(timer))
  platform().handle(IPC.durableOccurrencesRemoveSource, (kind: 'planner' | 'alarm' | 'timer', id: string) => service.removeSource(kind, id))
  platform().handle(IPC.durableOccurrencesAcknowledge, (id: string, deliveryGeneration: number) => service.acknowledge(id, deliveryGeneration))
}

export function durableOccurrenceFile(userDataDir: string): string { return path.join(userDataDir, 'durable-occurrences.json') }
