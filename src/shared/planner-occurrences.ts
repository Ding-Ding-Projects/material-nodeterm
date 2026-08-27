/**
 * Portable, machine-local planner schedules. This module is deliberately free of filesystem,
 * network, and shell dependencies so the Desktop and Server Edition use the same recurrence and
 * timezone rules. A schedule may be exported as safe intent, but a fired occurrence and all
 * runtime state remain on the computer that owns the schedule.
 */

export const PLANNER_SCHEMA_VERSION = 1 as const

export type PlannerWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type PlannerRecurrence =
  | { kind: 'once' }
  | { kind: 'daily' }
  | { kind: 'weekdays' }
  | { kind: 'weekly'; days: PlannerWeekday[] }
  | { kind: 'interval'; everyMinutes: number }

export interface PlannerSchedule {
  id: string
  title: string
  enabled: boolean
  /** IANA timezone used to interpret `startLocal`, including DST transitions. */
  timeZone: string
  /** Local wall-clock date and time, `YYYY-MM-DDTHH:mm`. */
  startLocal: string
  /** Optional local end time used to describe a cross-midnight planning window. */
  endTime?: string
  recurrence: PlannerRecurrence
  notification: { title: string; body: string }
}

export type PlannerOccurrenceStatus = 'fired' | 'missed'

export interface PlannerOccurrence {
  id: string
  scheduleId: string
  scheduledAtMs: number
  observedAtMs: number
  status: PlannerOccurrenceStatus
  title: string
  body: string
}

export interface PlannerFile {
  version: 1
  schedules: PlannerSchedule[]
  occurrences: PlannerOccurrence[]
  lastTickMs: number | null
}

export type PlannerLoadState =
  | { ok: true; file: PlannerFile; error: null }
  | { ok: false; file: PlannerFile; error: { kind: 'corrupt' | 'unreadable'; code?: string; path: string; message: string } }

export const PLANNER_LIMITS = {
  maxSchedules: 100,
  maxOccurrences: 2_000,
  maxTitleLength: 160,
  maxBodyLength: 4_000,
  maxTimeZoneLength: 120,
  maxLookaheadDays: 370,
  maxCatchUpOccurrences: 100,
  missedGraceMs: 2 * 60_000
} as const

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/

export function isPlannerLocalDateTime(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = LOCAL_RE.exec(value)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3])
}

export function isPlannerTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value)
}

export function isPlannerTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > PLANNER_LIMITS.maxTimeZoneLength) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

export function crossesPlannerMidnight(startTime: string, endTime: string | undefined): boolean {
  if (!isPlannerTime(startTime) || !isPlannerTime(endTime)) return false
  const minutes = (value: string): number => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
  return minutes(endTime) < minutes(startTime)
}

export function defaultPlannerFile(): PlannerFile {
  return { version: PLANNER_SCHEMA_VERSION, schedules: [], occurrences: [], lastTickMs: null }
}

export function validatePlannerFile(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'Planner data is malformed.'
  const file = raw as Record<string, unknown>
  if (file.version !== PLANNER_SCHEMA_VERSION) return 'Unsupported planner data version.'
  if (!Array.isArray(file.schedules) || file.schedules.length > PLANNER_LIMITS.maxSchedules) {
    return `Planner supports at most ${PLANNER_LIMITS.maxSchedules} schedules.`
  }
  if (!Array.isArray(file.occurrences) || file.occurrences.length > PLANNER_LIMITS.maxOccurrences) {
    return 'Planner occurrence history is too large.'
  }
  if (file.lastTickMs !== null && file.lastTickMs !== undefined && (!Number.isSafeInteger(file.lastTickMs) || file.lastTickMs < 0)) {
    return 'Planner last-tick time is invalid.'
  }
  const ids = new Set<string>()
  for (const rawSchedule of file.schedules) {
    const error = validatePlannerSchedule(rawSchedule)
    if (error) return error
    const id = (rawSchedule as PlannerSchedule).id
    if (ids.has(id)) return 'Planner schedule ids must be unique.'
    ids.add(id)
  }
  const occurrenceIds = new Set<string>()
  for (const rawOccurrence of file.occurrences) {
    if (!rawOccurrence || typeof rawOccurrence !== 'object' || Array.isArray(rawOccurrence)) return 'Planner occurrence history is malformed.'
    const occurrence = rawOccurrence as Partial<PlannerOccurrence>
    if (typeof occurrence.id !== 'string' || occurrence.id.length > 220 || occurrenceIds.has(occurrence.id)) return 'Planner occurrence ids must be unique.'
    if (typeof occurrence.scheduleId !== 'string' || !Number.isSafeInteger(occurrence.scheduledAtMs) || !Number.isSafeInteger(occurrence.observedAtMs)) return 'Planner occurrence timestamps are invalid.'
    if (occurrence.status !== 'fired' && occurrence.status !== 'missed') return 'Planner occurrence status is invalid.'
    if (typeof occurrence.title !== 'string' || occurrence.title.length > PLANNER_LIMITS.maxTitleLength) return 'Planner occurrence title is too long.'
    if (typeof occurrence.body !== 'string' || occurrence.body.length > PLANNER_LIMITS.maxBodyLength) return 'Planner occurrence body is too long.'
    occurrenceIds.add(occurrence.id)
  }
  return null
}

function validatePlannerSchedule(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'Planner schedule is malformed.'
  const schedule = raw as Partial<PlannerSchedule>
  if (typeof schedule.id !== 'string' || !ID_RE.test(schedule.id)) return 'Planner schedule id is invalid.'
  if (typeof schedule.title !== 'string' || schedule.title.trim().length === 0 || schedule.title.length > PLANNER_LIMITS.maxTitleLength) return 'Planner schedule title is invalid.'
  if (typeof schedule.enabled !== 'boolean') return 'Planner schedule enabled value is invalid.'
  if (!isPlannerTimeZone(schedule.timeZone)) return 'Planner schedule timezone is invalid.'
  if (!isPlannerLocalDateTime(schedule.startLocal)) return 'Planner schedule start must use YYYY-MM-DDTHH:mm.'
  if (schedule.endTime !== undefined && !isPlannerTime(schedule.endTime)) return 'Planner schedule end time is invalid.'
  if (!schedule.recurrence || typeof schedule.recurrence !== 'object') return 'Planner recurrence is missing.'
  const recurrence = schedule.recurrence as PlannerRecurrence
  if (!['once', 'daily', 'weekdays', 'weekly', 'interval'].includes(recurrence.kind)) return 'Planner recurrence kind is invalid.'
  if (recurrence.kind === 'weekly') {
    if (!Array.isArray(recurrence.days) || recurrence.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return 'Planner weekly days are invalid.'
  }
  if (recurrence.kind === 'interval' && (!Number.isSafeInteger(recurrence.everyMinutes) || recurrence.everyMinutes < 1 || recurrence.everyMinutes > 1_000_000)) return 'Planner interval is invalid.'
  if (!schedule.notification || typeof schedule.notification !== 'object') return 'Planner notification is missing.'
  if (typeof schedule.notification.title !== 'string' || schedule.notification.title.length > PLANNER_LIMITS.maxTitleLength) return 'Planner notification title is invalid.'
  if (typeof schedule.notification.body !== 'string' || schedule.notification.body.length > PLANNER_LIMITS.maxBodyLength) return 'Planner notification body is invalid.'
  return null
}

function dateParts(value: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const match = LOCAL_RE.exec(value)
  if (!match) throw new Error('Invalid planner local date')
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]) }
}

function dateOnly(epochMs: number, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const parts = dtf.formatToParts(new Date(epochMs))
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function shiftDate(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatLocal(date: string, hour: number, minute: number): string {
  return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function weekday(date: string): PlannerWeekday {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() as PlannerWeekday
}

/**
 * Resolve a local wall-clock time. Repeated DST times use the earliest instant. A nonexistent
 * spring-forward time is shifted forward to the first valid local minute, bounded to three hours.
 */
export function resolvePlannerLocalTime(local: string, timeZone: string): number | null {
  const parts = dateParts(local)
  const nominal = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  const matches: number[] = []
  const wanted = local
  for (let offset = -36 * 60; offset <= 36 * 60; offset += 1) {
    const candidate = nominal + offset * 60_000
    const formatted = new Intl.DateTimeFormat('sv-SE', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(candidate)).replace(' ', 'T')
    if (formatted === wanted) matches.push(candidate)
  }
  if (matches.length > 0) return Math.min(...matches)
  for (let delta = 1; delta <= 180; delta += 1) {
    const shiftedMinute = parts.hour * 60 + parts.minute + delta
    const dayOffset = Math.floor(shiftedMinute / 1440)
    const minuteOfDay = shiftedMinute % 1440
    const shiftedDate = shiftDate(local.slice(0, 10), dayOffset)
    const shifted = formatLocal(shiftedDate, Math.floor(minuteOfDay / 60), minuteOfDay % 60)
    const result = resolvePlannerLocalTimeExact(shifted, timeZone)
    if (result !== null) return result
  }
  return null
}

function resolvePlannerLocalTimeExact(local: string, timeZone: string): number | null {
  const parts = dateParts(local)
  const nominal = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  const wanted = local
  let earliest: number | null = null
  for (let offset = -36 * 60; offset <= 36 * 60; offset += 1) {
    const candidate = nominal + offset * 60_000
    const formatted = new Intl.DateTimeFormat('sv-SE', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(candidate)).replace(' ', 'T')
    if (formatted === wanted && (earliest === null || candidate < earliest)) earliest = candidate
  }
  return earliest
}

function recurrenceMatches(schedule: PlannerSchedule, date: string): boolean {
  const startDate = schedule.startLocal.slice(0, 10)
  if (date < startDate) return false
  switch (schedule.recurrence.kind) {
    case 'once': return date === startDate
    case 'daily': return true
    case 'weekdays': return weekday(date) >= 1 && weekday(date) <= 5
    case 'weekly': return schedule.recurrence.days.includes(weekday(date))
    case 'interval': return true
  }
}

/** Return deterministic occurrence instants in `(fromMs, toMs]`, capped for safe catch-up. */
export function plannerOccurrencesBetween(schedule: PlannerSchedule, fromMs: number, toMs: number): number[] {
  if (!schedule.enabled || toMs <= fromMs) return []
  if (schedule.recurrence.kind === 'interval') {
    const first = resolvePlannerLocalTime(schedule.startLocal, schedule.timeZone)
    if (first === null) return []
    const step = schedule.recurrence.everyMinutes * 60_000
    const index = Math.max(0, Math.floor((fromMs - first) / step) + 1)
    const result: number[] = []
    for (let i = index; i < index + PLANNER_LIMITS.maxCatchUpOccurrences; i += 1) {
      const next = first + i * step
      if (next > toMs) break
      result.push(next)
    }
    return result
  }
  const startDate = dateOnly(fromMs, schedule.timeZone)
  const endDate = dateOnly(toMs, schedule.timeZone)
  const result: number[] = []
  let date = shiftDate(startDate, -1)
  for (let count = 0; count <= PLANNER_LIMITS.maxLookaheadDays && date <= endDate; count += 1, date = shiftDate(date, 1)) {
    if (!recurrenceMatches(schedule, date)) continue
    const candidate = resolvePlannerLocalTime(formatLocal(date, dateParts(schedule.startLocal).hour, dateParts(schedule.startLocal).minute), schedule.timeZone)
    if (candidate !== null && candidate > fromMs && candidate <= toMs) result.push(candidate)
    if (result.length >= PLANNER_LIMITS.maxCatchUpOccurrences) break
  }
  return result.sort((a, b) => a - b)
}

export function plannerOccurrenceId(scheduleId: string, scheduledAtMs: number): string {
  return `${scheduleId}:${scheduledAtMs}`
}
