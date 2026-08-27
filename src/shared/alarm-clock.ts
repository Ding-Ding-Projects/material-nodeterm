/**
 * Alarm Clock scheduling primitives shared by the desktop renderer and durable host services.
 *
 * Recurrence is expressed as a wall-clock date, time, and IANA timezone. Epoch milliseconds are
 * used only for an individual occurrence. This keeps a recurring 09:00 alarm at 09:00 when the
 * machine crosses a daylight-saving boundary, instead of adding a fixed number of milliseconds.
 */

export type AlarmRecurrence = 'once' | 'daily' | 'weekdays' | 'weekly' | 'monthly'
export type AlarmOccurrenceStatus = 'fired' | 'snoozed' | 'dismissed' | 'missed'

export interface AlarmSchedule {
  recurrence: AlarmRecurrence
  /** Local calendar date in YYYY-MM-DD. Required for once, optional as the recurrence anchor. */
  date?: string
  /** Local wall-clock time in HH:mm, with optional seconds as HH:mm:ss. */
  time: string
  /** ISO weekday numbers, 0 Sunday through 6 Saturday, for weekly recurrence. */
  weekdays?: number[]
  /** Day of month, 1 through 31, for monthly recurrence. */
  monthDay?: number
}

export interface AlarmDefinition {
  id: string
  title: string
  enabled: boolean
  timeZone: string
  schedule: AlarmSchedule
  snoozeMinutes: number
  soundEnabled: boolean
  narratorEnabled: boolean
  nextOccurrenceAt?: number
  createdAt: number
  updatedAt: number
}

export interface AlarmOccurrence {
  id: string
  alarmId: string
  scheduledAt: number
  status: AlarmOccurrenceStatus
  createdAt: number
  resolvedAt?: number
  snoozedUntil?: number
  timeZone: string
}

export interface AlarmPlannerSnapshot {
  version: 1
  alarms: AlarmDefinition[]
  history: AlarmOccurrence[]
}

export interface AlarmValidationResult {
  ok: boolean
  error?: string
}

export interface AlarmPlannerStore {
  load(): Promise<AlarmPlannerSnapshot | null>
  save(snapshot: AlarmPlannerSnapshot): Promise<void>
}

export interface AlarmDueEvent {
  alarm: AlarmDefinition
  occurrence: AlarmOccurrence
  /** `missed` means the planner observed the occurrence after the grace window. */
  kind: 'due' | 'snooze' | 'missed'
}

export interface AlarmPlannerOptions {
  store: AlarmPlannerStore
  now?: () => number
  onDue?: (event: AlarmDueEvent) => void | Promise<void>
  intervalMs?: number
  missedAfterMs?: number
}

const DAY_MS = 86_400_000
const MAX_HISTORY = 1000
const DEFAULT_SNOOZE_MINUTES = 10
const DEFAULT_MISSED_AFTER_MS = 60_000

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function parseDate(value: string | undefined): { year: number; month: number; day: number } | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const check = new Date(Date.UTC(year, month - 1, day))
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
    ? { year, month, day }
    : null
}

function parseTime(value: string): { hour: number; minute: number; second: number } | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] ?? 0)
  return hour < 24 && minute < 60 && second < 60 ? { hour, minute, second } : null
}

function dateKey(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

function dateNumber(parts: { year: number; month: number; day: number }): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day)
}

function fromDateNumber(value: number): { year: number; month: number; day: number } {
  const date = new Date(value)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

function weekday(parts: { year: number; month: number; day: number }): number {
  return new Date(dateNumber(parts)).getUTCDay()
}

function wallParts(epochMs: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(epochMs))
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

/** Convert a local wall-clock tuple to an instant, handling DST gaps and folds predictably. */
export function localDateTimeToEpoch(
  date: string,
  time: string,
  timeZone: string,
  disambiguation: 'earlier' | 'later' | 'compatible' = 'compatible'
): number | null {
  const d = parseDate(date)
  const t = parseTime(time)
  if (!d || !t) return null
  try {
    // Start with the UTC interpretation, then correct by the timezone offset at that guess.
    const desiredUtc = Date.UTC(d.year, d.month - 1, d.day, t.hour, t.minute, t.second)
    const sample = wallParts(desiredUtc, timeZone)
    const sampleUtc = Date.UTC(sample.year, sample.month - 1, sample.day, sample.hour, sample.minute, sample.second)
    const first = desiredUtc - (sampleUtc - desiredUtc)
    const candidates: number[] = []
    // A timezone offset can change at a DST transition. Searching a bounded six-hour window also
    // handles historical zones with a non-hour transition without turning malformed input into a
    // long-running search.
    for (let offset = -6 * 60; offset <= 6 * 60; offset++) {
      const candidate = first + offset * 60_000
      const actual = wallParts(candidate, timeZone)
      if (actual.year === d.year && actual.month === d.month && actual.day === d.day && actual.hour === t.hour && actual.minute === t.minute && actual.second === t.second) {
        candidates.push(candidate)
      }
    }
    if (candidates.length) return Math.min(...candidates) + (disambiguation === 'later' ? Math.max(...candidates) - Math.min(...candidates) : 0)
    if (disambiguation === 'earlier' || disambiguation === 'later') return null
    // A skipped wall time has no exact instant. Compatible semantics choose the first instant after
    // the requested wall time, which is what users expect when scheduling in a spring-forward gap.
    for (let delta = 1; delta <= 6 * 60; delta++) {
      const candidate = first + delta * 60_000
      const actual = wallParts(candidate, timeZone)
      const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
      if (actualUtc >= desiredUtc) return candidate
    }
    return null
  } catch {
    return null
  }
}

export function validateAlarm(alarm: Pick<AlarmDefinition, 'title' | 'timeZone' | 'schedule' | 'snoozeMinutes'>): AlarmValidationResult {
  if (!String(alarm.title ?? '').trim()) return { ok: false, error: 'Alarm title is required.' }
  if (String(alarm.title).length > 160) return { ok: false, error: 'Alarm title must be 160 characters or fewer.' }
  try {
    new Intl.DateTimeFormat('en', { timeZone: alarm.timeZone }).format()
  } catch {
    return { ok: false, error: 'Choose a valid IANA timezone.' }
  }
  const schedule = alarm.schedule
  if (!parseTime(schedule.time)) return { ok: false, error: 'Choose a valid local time.' }
  if (schedule.recurrence === 'once' && !parseDate(schedule.date)) return { ok: false, error: 'Choose a date for a one-shot alarm.' }
  if (schedule.date && !parseDate(schedule.date)) return { ok: false, error: 'Use a calendar date in YYYY-MM-DD format.' }
  if (schedule.recurrence === 'weekly') {
    const days = schedule.weekdays ?? []
    if (!days.length || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return { ok: false, error: 'Choose at least one weekday for a weekly alarm.' }
  }
  if (schedule.recurrence === 'monthly' && (!Number.isInteger(schedule.monthDay) || (schedule.monthDay ?? 0) < 1 || (schedule.monthDay ?? 0) > 31)) return { ok: false, error: 'Choose a day from 1 to 31 for a monthly alarm.' }
  if (!finite(alarm.snoozeMinutes) || alarm.snoozeMinutes < 1 || alarm.snoozeMinutes > 120) return { ok: false, error: 'Snooze must be between 1 and 120 minutes.' }
  return { ok: true }
}

function nextForDate(alarm: Pick<AlarmDefinition, 'timeZone' | 'schedule'>, date: { year: number; month: number; day: number }): number | null {
  // Compatible semantics preserve the earlier side of a fall-back fold and advance through a
  // spring-forward gap to its first valid instant, so a recurring alarm is never silently lost.
  return localDateTimeToEpoch(dateKey(date), alarm.schedule.time, alarm.timeZone, 'compatible')
}

/** Find the next wall-clock occurrence strictly after `afterMs`. */
export function nextAlarmOccurrence(alarm: Pick<AlarmDefinition, 'timeZone' | 'schedule'>, afterMs: number): number | null {
  if (!finite(afterMs)) return null
  const start = parseDate(alarm.schedule.date)
  if (alarm.schedule.recurrence === 'once') {
    const one = start ? nextForDate(alarm, start) : null
    return one !== null && one > afterMs ? one : null
  }
  const current = wallParts(afterMs + 1000, alarm.timeZone)
  let cursor = start && dateNumber(start) > dateNumber(current) ? start : { year: current.year, month: current.month, day: current.day }
  for (let days = 0; days < 3700; days++) {
    const day = weekday(cursor)
    const rec = alarm.schedule.recurrence
    const matches = rec === 'daily' || (rec === 'weekdays' && day >= 1 && day <= 5) || (rec === 'weekly' && (alarm.schedule.weekdays ?? []).includes(day)) || (rec === 'monthly' && cursor.day === alarm.schedule.monthDay)
    if (matches) {
      const candidate = nextForDate(alarm, cursor)
      if (candidate !== null && candidate > afterMs) return candidate
    }
    cursor = fromDateNumber(dateNumber(cursor) + DAY_MS)
  }
  return null
}

export function alarmOccurrenceId(alarmId: string, scheduledAt: number): string {
  return `alarm-occurrence-${alarmId}-${Math.floor(scheduledAt)}`
}

export function emptyAlarmPlannerSnapshot(): AlarmPlannerSnapshot {
  return { version: 1, alarms: [], history: [] }
}

/** A persistence-backed planner. It owns no OS wake primitive, so it never claims powered-off wake. */
export class DurableAlarmPlanner {
  private snapshot = emptyAlarmPlannerSnapshot()
  private timer: ReturnType<typeof setInterval> | null = null
  private saving: Promise<void> = Promise.resolve()
  private readonly now: () => number
  private readonly intervalMs: number
  private readonly missedAfterMs: number

  constructor(private readonly options: AlarmPlannerOptions) {
    this.now = options.now ?? (() => Date.now())
    this.intervalMs = Math.max(1000, options.intervalMs ?? 15_000)
    this.missedAfterMs = Math.max(0, options.missedAfterMs ?? DEFAULT_MISSED_AFTER_MS)
  }

  get state(): AlarmPlannerSnapshot {
    return { alarms: this.snapshot.alarms.map((alarm) => ({ ...alarm, schedule: { ...alarm.schedule } })), history: [...this.snapshot.history], version: 1 }
  }

  async start(): Promise<void> {
    this.snapshot = (await this.options.store.load()) ?? emptyAlarmPlannerSnapshot()
    if (this.snapshot.version !== 1 || !Array.isArray(this.snapshot.alarms) || !Array.isArray(this.snapshot.history)) this.snapshot = emptyAlarmPlannerSnapshot()
    const now = this.now()
    this.snapshot.alarms = this.snapshot.alarms.map((alarm) => {
      const nextOccurrenceAt = alarm.enabled
        ? alarm.nextOccurrenceAt ?? nextAlarmOccurrence(alarm, now - 1) ?? undefined
        : undefined
      return { ...alarm, enabled: alarm.enabled && nextOccurrenceAt !== undefined, nextOccurrenceAt }
    })
    await this.persist()
    await this.tick(now)
    this.timer = setInterval(() => void this.tick(), this.intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async upsert(input: Omit<AlarmDefinition, 'createdAt' | 'updatedAt'> & { id?: string }): Promise<AlarmDefinition> {
    const now = this.now()
    const id = input.id ?? `alarm-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const existing = this.snapshot.alarms.find((alarm) => alarm.id === id)
    const nextOccurrenceAt = input.enabled ? nextAlarmOccurrence(input, now - 1) ?? undefined : undefined
    const alarm: AlarmDefinition = {
      ...input,
      id,
      enabled: input.enabled && nextOccurrenceAt !== undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      nextOccurrenceAt
    }
    const check = validateAlarm(alarm)
    if (!check.ok) throw new Error(check.error)
    this.snapshot.alarms = existing ? this.snapshot.alarms.map((item) => item.id === id ? alarm : item) : [...this.snapshot.alarms, alarm]
    await this.persist()
    return alarm
  }

  async remove(alarmId: string): Promise<boolean> {
    const before = this.snapshot.alarms.length
    this.snapshot.alarms = this.snapshot.alarms.filter((alarm) => alarm.id !== alarmId)
    if (before === this.snapshot.alarms.length) return false
    await this.persist()
    return true
  }

  async setEnabled(alarmId: string, enabled: boolean): Promise<AlarmDefinition | null> {
    const alarm = this.snapshot.alarms.find((item) => item.id === alarmId)
    if (!alarm) return null
    const nextOccurrenceAt = enabled ? nextAlarmOccurrence(alarm, this.now() - 1) ?? undefined : undefined
    alarm.enabled = enabled && nextOccurrenceAt !== undefined
    alarm.updatedAt = this.now()
    alarm.nextOccurrenceAt = nextOccurrenceAt
    await this.persist()
    return alarm
  }

  async snooze(occurrenceId: string, minutes: number, now = this.now()): Promise<AlarmOccurrence | null> {
    const occurrence = this.snapshot.history.find((item) => item.id === occurrenceId)
    if (!occurrence || (occurrence.status !== 'fired' && occurrence.status !== 'snoozed')) return null
    const alarm = this.snapshot.alarms.find((item) => item.id === occurrence.alarmId)
    const duration = finite(minutes) ? Math.max(1, Math.min(120, Math.round(minutes))) : alarm?.snoozeMinutes ?? DEFAULT_SNOOZE_MINUTES
    occurrence.status = 'snoozed'
    occurrence.snoozedUntil = now + duration * 60_000
    occurrence.resolvedAt = undefined
    await this.persist()
    return occurrence
  }

  async dismiss(occurrenceId: string, now = this.now()): Promise<AlarmOccurrence | null> {
    const occurrence = this.snapshot.history.find((item) => item.id === occurrenceId)
    if (!occurrence || (occurrence.status !== 'fired' && occurrence.status !== 'snoozed')) return null
    occurrence.status = 'dismissed'
    occurrence.resolvedAt = now
    occurrence.snoozedUntil = undefined
    await this.persist()
    return occurrence
  }

  async tick(now = this.now()): Promise<AlarmDueEvent[]> {
    const emitted: AlarmDueEvent[] = []
    for (const alarm of this.snapshot.alarms) {
      if (!alarm.enabled || !finite(alarm.nextOccurrenceAt) || alarm.nextOccurrenceAt > now) continue
      let next = alarm.nextOccurrenceAt
      let loops = 0
      while (finite(next) && next <= now && loops++ < 32) {
        const id = alarmOccurrenceId(alarm.id, next)
        if (!this.snapshot.history.some((item) => item.id === id)) {
          const missed = now - next > this.missedAfterMs
          const occurrence: AlarmOccurrence = { id, alarmId: alarm.id, scheduledAt: next, status: missed ? 'missed' : 'fired', createdAt: now, timeZone: alarm.timeZone }
          this.snapshot.history = [...this.snapshot.history, occurrence].slice(-MAX_HISTORY)
          const event: AlarmDueEvent = { alarm, occurrence, kind: missed ? 'missed' : 'due' }
          emitted.push(event)
          await this.options.onDue?.(event)
        }
        if (alarm.schedule.recurrence === 'once') {
          alarm.enabled = false
          alarm.nextOccurrenceAt = undefined
          break
        }
        next = nextAlarmOccurrence(alarm, next)
        alarm.nextOccurrenceAt = next ?? undefined
      }
    }
    const snoozed = this.snapshot.history.filter((item) => item.status === 'snoozed' && finite(item.snoozedUntil) && item.snoozedUntil <= now)
    for (const occurrence of snoozed) {
      occurrence.status = 'fired'
      occurrence.snoozedUntil = undefined
      const alarm = this.snapshot.alarms.find((item) => item.id === occurrence.alarmId)
      if (!alarm) continue
      const event: AlarmDueEvent = { alarm, occurrence, kind: 'snooze' }
      emitted.push(event)
      await this.options.onDue?.(event)
    }
    if (emitted.length) await this.persist()
    return emitted
  }

  private persist(): Promise<void> {
    const snapshot = this.state
    const run = this.saving.then(() => this.options.store.save(snapshot))
    this.saving = run.catch(() => {})
    return run
  }
}
