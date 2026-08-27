import { clampTimerDuration, isValidTimerOccurrence, type TimerOccurrence, type TimerNodeData, type TimerOccurrenceState } from '../shared/timer'
import { randomUUID } from 'node:crypto'

export interface TimerStore {
  load(): Promise<TimerOccurrence[]>
  save(occurrences: TimerOccurrence[]): Promise<void>
}

export interface TimerAlarm { timerId: string; occurrenceId: string; at: number; tone: TimerNodeData['alarmTone'] }

/** Persistent occurrence coordinator. It is host-neutral so desktop and browser shells share it. */
export class TimerOccurrenceService {
  private occurrences: TimerOccurrence[] = []
  private readonly alarms = new Map<string, TimerAlarm>()
  private ready: Promise<void>

  constructor(private readonly store: TimerStore, private readonly now: () => number = Date.now) {
    this.ready = store.load().then((items) => { this.occurrences = items.filter((item) => this.valid(item)) })
  }

  async hydrate() { await this.ready; return this.list() }
  list(timerId?: string) { return this.occurrences.filter((item) => !timerId || item.timerId === timerId).map((item) => ({ ...item, lapsMs: [...item.lapsMs] })) }

  async schedule(timerId: string, scheduledAt: number): Promise<TimerOccurrence> {
    await this.ready
    const occurrence: TimerOccurrence = { id: randomUUID(), timerId, scheduledAt, state: 'scheduled', lapsMs: [] }
    this.occurrences.push(occurrence)
    await this.store.save(this.occurrences)
    return { ...occurrence, lapsMs: [] }
  }

  /** Mark overdue scheduled occurrences once, preserving them for history and export. */
  async reconcileMissed(at = this.now()) {
    await this.ready
    let changed = false
    for (const occurrence of this.occurrences) {
      if (occurrence.state === 'scheduled' && occurrence.scheduledAt < at) {
        occurrence.state = 'missed'
        occurrence.endedAt = at
        changed = true
      }
    }
    if (changed) await this.store.save(this.occurrences)
    return this.list()
  }

  async transition(id: string, state: TimerOccurrenceState, at = this.now()) {
    await this.ready
    const occurrence = this.occurrences.find((item) => item.id === id)
    if (!occurrence || !isValidTimerOccurrence(occurrence)) return null
    const allowed: Record<TimerOccurrenceState, readonly TimerOccurrenceState[]> = {
      scheduled: ['running', 'missed'], running: ['paused', 'completed', 'missed'], paused: ['running', 'missed'], completed: [], missed: []
    }
    if (occurrence.state !== state && !allowed[occurrence.state].includes(state)) return null
    occurrence.state = state
    if (state === 'running' && !occurrence.startedAt) occurrence.startedAt = at
    if (state === 'completed' || state === 'missed') occurrence.endedAt = at
    await this.store.save(this.occurrences)
    return { ...occurrence, lapsMs: [...occurrence.lapsMs] }
  }

  async addLap(id: string, elapsedMs: number) {
    await this.ready
    const occurrence = this.occurrences.find((item) => item.id === id)
    if (!occurrence || !isValidTimerOccurrence(occurrence)) return null
    occurrence.lapsMs.push(Math.max(0, Math.round(elapsedMs)))
    await this.store.save(this.occurrences)
    return [...occurrence.lapsMs]
  }

  setAlarm(alarm: TimerAlarm) { this.alarms.set(alarm.occurrenceId, alarm) }
  takeDueAlarms(at = this.now()) { const due = [...this.alarms.values()].filter((alarm) => alarm.at <= at); due.forEach((alarm) => this.alarms.delete(alarm.occurrenceId)); return due }
  validateDuration(value: number) { return clampTimerDuration(value) }

  private valid(item: TimerOccurrence): item is TimerOccurrence {
    return isValidTimerOccurrence(item)
  }
}
