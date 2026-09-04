import { describe, expect, it } from 'vitest'
import { initPlatform, resetPlatformForTests } from './platform'
import {
  DURABLE_OCCURRENCE_LIMITS,
  defaultDurableOccurrenceSnapshot,
  durableLocalToEpoch,
  durableOccurrenceTimes,
  validateDurableOccurrenceSnapshot,
  type DurableOccurrenceSnapshot,
  type DurableSchedule,
  type DurableTimerNode
} from '../shared/durable-occurrences'
import { DurableOccurrenceService, registerDurableOccurrenceHandlers, type DurableOccurrenceStore } from './durable-occurrence-service'
import { IPC } from '../shared/ipc'

class MemoryStore implements DurableOccurrenceStore {
  value: DurableOccurrenceSnapshot | null = null
  saves = 0
  async load() { return this.value ? structuredClone(this.value) : null }
  async save(snapshot: DurableOccurrenceSnapshot, expectedGeneration: number) {
    if ((this.value?.generation ?? 0) !== expectedGeneration) throw new Error('CAS')
    this.value = structuredClone(snapshot)
    this.saves += 1
  }
}

const schedule = (startLocal = '2026-01-01T09:00'): DurableSchedule => ({
  id: 'morning', title: 'Morning', enabled: true, timeZone: 'America/Toronto', startLocal,
  recurrence: { kind: 'daily' }, notification: { title: 'Stand up', body: 'Stretch', soundEnabled: true, narratorEnabled: true }
})

const timer = (): DurableTimerNode => ({
  id: 'timer-1', canvasNodeId: 'timer-node-1', title: 'Tea', updatedAtMs: 0,
  data: { timerMode: 'countdown', durationMs: 10_000, remainingMs: 10_000, elapsedMs: 0, running: false, paused: false, repeatCount: 0, repeatRemaining: 0, sequence: [], sequenceIndex: 0, lapsMs: [], nextOccurrenceAt: null, occurrenceState: 'scheduled', alarmEnabled: true, alarmTone: 'chime', missedCount: 0, wallAnchorMs: null, monotonicAnchorMs: null }
})

describe('durable planner/alarm/timer source Chuts', () => {
  it('rejects unknown keys and malformed imported state, including timer data', () => {
    const state = defaultDurableOccurrenceSnapshot()
    expect(validateDurableOccurrenceSnapshot({ ...state, stale: true })).toContain('malformed')
    expect(validateDurableOccurrenceSnapshot({ ...state, timers: [{ ...timer(), data: { ...timer().data, mystery: true } }] })).toContain('unknown')
    expect(validateDurableOccurrenceSnapshot({ ...state, alarms: [{ id: 'a', canvasNodeId: 'n' }] })).toContain('malformed')
  })

  it('resolves IANA wall time and gives repeated and nonexistent DST times documented behavior', () => {
    const repeated = durableLocalToEpoch('2026-11-01T01:30', 'America/Toronto')
    const gap = durableLocalToEpoch('2026-03-08T02:30', 'America/Toronto')
    expect(repeated).not.toBeNull()
    expect(gap).not.toBeNull()
    expect(new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', hour12: false, dateStyle: 'short', timeStyle: 'short' }).format(new Date(gap!))).toContain('03:00')
  })

  it('does not silently discard a nonempty weekly schedule and caps catch-up explicitly', () => {
    const weekly = { ...schedule(), recurrence: { kind: 'weekly' as const, weekdays: [1, 3, 5] as const } }
    const result = durableOccurrenceTimes(weekly, Date.parse('2026-01-01T00:00:00Z'), Date.parse('2026-03-01T00:00:00Z'))
    expect(result.times.length).toBeGreaterThan(0)
    const dense = { ...schedule('2020-01-01T00:00'), recurrence: { kind: 'daily' as const } }
    const capped = durableOccurrenceTimes(dense, Date.parse('2020-01-01T00:00:00Z'), Date.parse('2026-01-01T00:00:00Z'))
    expect(capped.times).toHaveLength(DURABLE_OCCURRENCE_LIMITS.maxCatchUp)
    expect(capped.truncated).toBe(true)
  })

  it('uses generation CAS so an old client cannot overwrite a newer snapshot', async () => {
    const store = new MemoryStore()
    const service = new DurableOccurrenceService({ store, nowWallMs: () => 1_000, nowMonotonicMs: () => 1_000 })
    await service.start()
    const first = service.getState()
    const saved = await service.save({ ...first, schedules: [schedule()] }, first.generation)
    expect(saved.ok).toBe(true)
    const stale = await service.save(first, first.generation)
    expect(stale).toEqual({ ok: false, error: 'The schedule changed in another client. Reload before saving.' })
    await service.stop()
  })

  it('persists intent before delivery and recovers a crash after claim', async () => {
    const store = new MemoryStore()
    let wall = Date.parse('2026-01-01T13:00:30Z')
    let crashes = true
    const service = new DurableOccurrenceService({ store, nowWallMs: () => wall, nowMonotonicMs: () => wall, deliver: () => { if (crashes) throw new Error('consumer oofed'); return 'delivered' } })
    await service.start()
    const base = service.getState()
    base.schedules = [schedule('2026-01-01T08:00')]
    base.lastWallClockMs = wall - 86_400_000
    base.lastMonotonicMs = wall - 86_400_000
    await service.save(base, base.generation)
    await expect(service.reconcile(wall, wall)).resolves.toBeUndefined()
    const claimed = service.getState().occurrences.find((row) => row.kind === 'planner')
    expect(claimed?.status).toBe('failed')
    // Model the process dying after the claim publication, before its outcome publication. This
    // is an on-disk crash stage, not a consumer rejection, so the restarted owner must reclaim it.
    const persisted = store.value!
    const persistedRow = persisted.occurrences.find((row) => row.id === claimed!.id)!
    persistedRow.status = 'claimed'; persistedRow.delivery.outcome = 'not-attempted'; persistedRow.delivery.claimedAtMs = wall - DURABLE_OCCURRENCE_LIMITS.claimLeaseMs - 1; persistedRow.delivery.claimId = 'claim-recovery'
    store.value = persisted
    expect(store.value?.occurrences.some((row) => row.status === 'claimed')).toBe(true)
    crashes = false
    wall += DURABLE_OCCURRENCE_LIMITS.claimLeaseMs + 1
    const recovered = new DurableOccurrenceService({ store, nowWallMs: () => wall, nowMonotonicMs: () => wall, deliver: () => 'delivered' })
    await recovered.start()
    expect(recovered.getState().occurrences.find((row) => row.id === claimed!.id)?.status).toBe('delivered')
    // The original host is intentionally left in its claimed crash state. A restarted owner may
    // recover and publish the outcome; asking the old owner to flush after that would be a stale
    // CAS writer, exactly the race this test is proving.
    await recovered.stop()
  })

  it('leaves pending delivery for a closed server client and drains once one returns', async () => {
    const store = new MemoryStore()
    let wall = Date.parse('2026-01-01T13:00:30Z')
    const service = new DurableOccurrenceService({ store, nowWallMs: () => wall, nowMonotonicMs: () => wall })
    await service.start()
    const base = service.getState(); base.schedules = [schedule('2026-01-01T08:00')]; base.lastWallClockMs = wall - 86_400_000; base.lastMonotonicMs = wall - 86_400_000
    await service.save(base, base.generation); await service.reconcile(wall, wall)
    expect(service.getState().occurrences.some((row) => row.status === 'pending')).toBe(true)
    let deliveries = 0
    const off = service.registerDeliveryClient(() => { deliveries += 1; return 'delivered' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(deliveries).toBe(1)
    expect(service.getState().occurrences.some((row) => row.status === 'delivered')).toBe(true)
    off(); await service.stop()
  })

  it('records clock jumps, power-off limitation, history mutations and complete schedule export', async () => {
    const store = new MemoryStore(); const labels: string[] = []
    let wall = 10_000
    const service = new DurableOccurrenceService({ store, nowWallMs: () => wall, nowMonotonicMs: () => wall, history: (label) => { labels.push(label) } })
    await service.start(); const base = service.getState(); base.schedules = [schedule()]; await service.save(base, base.generation)
    wall = 5_000; await service.reconcile(wall, 5_000)
    expect(service.getState().occurrences.some((row) => row.reason === 'clock-adjusted')).toBe(true)
    const exported = service.exportSchedules(); expect(exported.content).toContain('schedules'); expect(exported.content).toContain('alarms'); expect(exported.content).toContain('timers'); expect(exported.content).toContain('occurrences')
    expect(labels).toEqual(expect.arrayContaining(['schedules changed', 'occurrences reconciled']))
    await service.stop()
  })

  it('advances timers from monotonic time, pauses without wall-clock drift, and consumes tone once', async () => {
    const store = new MemoryStore(); let mono = 0; let wall = 0; let deliveries = 0
    const service = new DurableOccurrenceService({ store, nowWallMs: () => wall, nowMonotonicMs: () => mono, deliver: () => { deliveries += 1; return 'delivered' } })
    await service.start(); const base = service.getState(); base.timers = [timer()]; await service.save(base, base.generation)
    await service.timerTransition('timer-1', 'start', wall, mono); mono = 4_000; wall = 100_000; await service.timerTick(wall, mono)
    expect(service.getState().timers[0].data.remainingMs).toBe(6_000)
    await service.timerTransition('timer-1', 'pause', wall, mono); mono = 9_000; wall = 200_000; await service.timerTick(wall, mono)
    expect(service.getState().timers[0].data.remainingMs).toBe(6_000)
    await service.timerTransition('timer-1', 'resume', wall, mono); mono = 15_000; wall = 300_000; await service.timerTick(wall, mono)
    expect(service.getState().timers[0].data.occurrenceState).toBe('completed')
    expect(deliveries).toBe(1)
    await service.timerTick(wall, mono); expect(deliveries).toBe(1)
    await service.stop()
  })

  it('does not claim a powered-off wake guarantee', async () => {
    const store = new MemoryStore(); let wall = 10_000
    const service = new DurableOccurrenceService({ store, nowWallMs: () => wall, nowMonotonicMs: () => wall })
    await service.start(); wall = 20_000; await service.reconcile(wall, wall + 100_000)
    expect(service.getState().occurrences.some((row) => row.reason === 'power-off-not-supported')).toBe(true)
    await service.stop()
  })

  it('registers the complete typed host handler surface rather than a viewer-local placeholder', () => {
    const channels: string[] = []
    initPlatform({ userDataDir: 'test', appVersion: 'test', isPackaged: false, handle: (channel) => channels.push(channel), on: () => {}, handleWithSender: () => {}, onWithSender: () => {}, sendTo: () => {}, broadcast: () => {}, clientIds: () => [], openExternal: async () => {} })
    registerDurableOccurrenceHandlers(new DurableOccurrenceService({ store: new MemoryStore() }))
    expect(channels).toEqual(expect.arrayContaining([IPC.durableOccurrencesLoad, IPC.durableOccurrencesSave, IPC.durableOccurrencesReconcile, IPC.durableOccurrencesClaim, IPC.durableOccurrencesSnooze, IPC.durableOccurrencesDismiss, IPC.durableOccurrencesExport, IPC.durableOccurrencesImport, IPC.durableOccurrencesTimerTransition, IPC.durableOccurrencesTimerLap, IPC.durableOccurrencesTimerTick, IPC.durableOccurrencesUpsertAlarm, IPC.durableOccurrencesUpsertTimer, IPC.durableOccurrencesRemoveSource]))
    resetPlatformForTests()
  })
})
