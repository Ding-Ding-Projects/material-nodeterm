/**
 * Shared, host-owned planner and alarm contract.
 *
 * The renderer keeps only projections. Intent, delivery claims, outcomes, and the wall-clock
 * representation live in this bounded schema so a closed canvas or a second client cannot make an
 * occurrence disappear. The JSON shape is deliberately strict: accepting an unknown property here
 * would let a stale client overwrite a newer field while still looking valid to the host.
 */

export const DURABLE_OCCURRENCES_SCHEMA_VERSION = 1 as const
export const DURABLE_OCCURRENCE_LIMITS = {
  maxSchedules: 256,
  maxAlarms: 256,
  maxOccurrences: 8_192,
  maxTitleLength: 160,
  maxBodyLength: 4_000,
  maxIdLength: 128,
  maxTimezoneLength: 120,
  maxCatchUp: 128,
  maxImportBytes: 2 * 1024 * 1024,
  claimLeaseMs: 60_000,
  maxSnoozeMinutes: 24 * 60
} as const

export type DurableWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type DurableRecurrence =
  | { kind: 'once' }
  | { kind: 'daily' }
  | { kind: 'weekdays' }
  | { kind: 'weekly'; weekdays: DurableWeekday[] }
  | { kind: 'monthly'; day: number }

export interface DurableNotificationIntent {
  title: string
  body: string
  soundEnabled: boolean
  narratorEnabled: boolean
}

export interface DurableSchedule {
  id: string
  title: string
  enabled: boolean
  timeZone: string
  /** Immutable local wall representation. Never replace this with a stored epoch. */
  startLocal: string
  recurrence: DurableRecurrence
  notification: DurableNotificationIntent
}

export interface DurableAlarmNode {
  id: string
  canvasNodeId: string
  title: string
  enabled: boolean
  timeZone: string
  startLocal: string
  recurrence: DurableRecurrence
  snoozeMinutes: number
  soundEnabled: boolean
  narratorEnabled: boolean
  createdAtMs: number
  updatedAtMs: number
}

export type DurableTimerMode = 'countdown' | 'stopwatch' | 'interval'
export type DurableTimerOccurrenceState = 'scheduled' | 'running' | 'paused' | 'completed' | 'missed' | 'cancelled'
export interface DurableTimerSequenceStep { id: string; label: string; durationMs: number }
/** Canonical timer node data. Renderer projections and canvas serializers must keep this exact name. */
export interface DurableTimerNodeData {
  timerMode: DurableTimerMode
  durationMs: number
  remainingMs: number
  elapsedMs: number
  running: boolean
  paused: boolean
  repeatCount: number
  repeatRemaining: number
  sequence: DurableTimerSequenceStep[]
  sequenceIndex: number
  lapsMs: number[]
  nextOccurrenceAt: number | null
  occurrenceState: DurableTimerOccurrenceState
  alarmEnabled: boolean
  alarmTone: 'chime' | 'bell' | 'silent'
  missedCount: number
  wallAnchorMs: number | null
  monotonicAnchorMs: number | null
}
export interface DurableTimerNode {
  id: string
  canvasNodeId: string
  title: string
  data: DurableTimerNodeData
  updatedAtMs: number
}

export type DurableOccurrenceKind = 'planner' | 'alarm' | 'timer' | 'reconciliation'
export type DurableOccurrenceStatus =
  | 'intent'
  | 'claimed'
  | 'delivered'
  | 'pending'
  | 'failed'
  | 'missed'
  | 'snoozed'
  | 'dismissed'
  | 'cancelled'

export interface DurableOccurrence {
  id: string
  kind: DurableOccurrenceKind
  sourceId: string
  scheduledAtMs: number
  observedAtMs: number
  local: { timeZone: string; date: string; time: string }
  status: DurableOccurrenceStatus
  title: string
  body: string
  soundEnabled: boolean
  narratorEnabled: boolean
  delivery: {
    idempotencyKey: string
    generation: number
    acknowledgedAtMs: number | null
    claimId: string | null
    claimedAtMs: number | null
    outcome: 'not-attempted' | 'delivered' | 'pending' | 'failed'
    error: string | null
  }
  reason: 'none' | 'clock-adjusted' | 'catch-up-truncated' | 'power-off-not-supported'
}

export interface DurableOccurrenceSnapshot {
  version: 1
  generation: number
  schedules: DurableSchedule[]
  alarms: DurableAlarmNode[]
  timers: DurableTimerNode[]
  occurrences: DurableOccurrence[]
  lastWallClockMs: number | null
  lastMonotonicMs: number | null
  monotonicClockId: string | null
}

export type DurableOccurrenceLoadState =
  | { ok: true; snapshot: DurableOccurrenceSnapshot; error: null }
  | { ok: false; snapshot: DurableOccurrenceSnapshot; error: { kind: 'corrupt' | 'unreadable'; message: string } }

export function defaultDurableOccurrenceSnapshot(): DurableOccurrenceSnapshot {
  return { version: 1, generation: 0, schedules: [], alarms: [], timers: [], occurrences: [], lastWallClockMs: null, lastMonotonicMs: null, monotonicClockId: null }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/
const TIMEZONE_CATALOG = new Set(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [])

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys)
  return Object.keys(value).every((key) => expected.has(key)) && keys.every((key) => key in value)
}
function boundedText(value: unknown, max: number, required = true): value is string {
  return typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0)
}
function finiteMs(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}
export function isDurableTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > DURABLE_OCCURRENCE_LIMITS.maxTimezoneLength) return false
  if (TIMEZONE_CATALOG.size > 0 && value !== 'UTC' && !TIMEZONE_CATALOG.has(value)) return false
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format() } catch { return false }
  return true
}
export function isDurableLocalDateTime(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = LOCAL.exec(value)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3])
}

function recurrenceError(value: unknown): string | null {
  if (!object(value) || typeof value.kind !== 'string') return 'Recurrence must be an object with a kind.'
  if (value.kind === 'once' || value.kind === 'daily' || value.kind === 'weekdays') {
    return exact(value, ['kind']) ? null : 'Recurrence contains an unknown property.'
  }
  if (value.kind === 'weekly') {
    if (!exact(value, ['kind', 'weekdays']) || !Array.isArray(value.weekdays) || value.weekdays.length === 0 || value.weekdays.length > 7) return 'Weekly recurrence needs one or more weekdays.'
    const days = value.weekdays as unknown[]
    if (new Set(days).size !== days.length || days.some((day) => !Number.isInteger(day) || (day as number) < 0 || (day as number) > 6)) return 'Weekly recurrence weekdays are invalid.'
    return null
  }
  if (value.kind === 'monthly') return exact(value, ['kind', 'day']) && Number.isInteger(value.day) && (value.day as number) >= 1 && (value.day as number) <= 31 ? null : 'Monthly recurrence day is invalid.'
  return 'Recurrence kind is invalid.'
}

function notificationError(value: unknown): string | null {
  if (!object(value) || !exact(value, ['title', 'body', 'soundEnabled', 'narratorEnabled'])) return 'Notification intent is malformed or has an unknown property.'
  if (!boundedText(value.title, DURABLE_OCCURRENCE_LIMITS.maxTitleLength) || !boundedText(value.body, DURABLE_OCCURRENCE_LIMITS.maxBodyLength, false) || typeof value.soundEnabled !== 'boolean' || typeof value.narratorEnabled !== 'boolean') return 'Notification intent contains an invalid value.'
  return null
}

function scheduleError(value: unknown): string | null {
  if (!object(value) || !exact(value, ['id', 'title', 'enabled', 'timeZone', 'startLocal', 'recurrence', 'notification'])) return 'Schedule is malformed or has an unknown property.'
  if (typeof value.id !== 'string' || !ID.test(value.id) || !boundedText(value.title, DURABLE_OCCURRENCE_LIMITS.maxTitleLength) || typeof value.enabled !== 'boolean' || !isDurableTimezone(value.timeZone) || !isDurableLocalDateTime(value.startLocal)) return 'Schedule contains an invalid id, title, timezone, or local time.'
  return recurrenceError(value.recurrence) ?? notificationError(value.notification)
}

function alarmError(value: unknown): string | null {
  const keys = ['id', 'canvasNodeId', 'title', 'enabled', 'timeZone', 'startLocal', 'recurrence', 'snoozeMinutes', 'soundEnabled', 'narratorEnabled', 'createdAtMs', 'updatedAtMs'] as const
  if (!object(value) || !exact(value, keys)) return 'Alarm node is malformed or has an unknown property.'
  if (typeof value.id !== 'string' || !ID.test(value.id) || typeof value.canvasNodeId !== 'string' || !ID.test(value.canvasNodeId) || !boundedText(value.title, DURABLE_OCCURRENCE_LIMITS.maxTitleLength) || typeof value.enabled !== 'boolean' || !isDurableTimezone(value.timeZone) || !isDurableLocalDateTime(value.startLocal) || !Number.isInteger(value.snoozeMinutes) || Number(value.snoozeMinutes) < 1 || Number(value.snoozeMinutes) > DURABLE_OCCURRENCE_LIMITS.maxSnoozeMinutes || typeof value.soundEnabled !== 'boolean' || typeof value.narratorEnabled !== 'boolean' || !finiteMs(value.createdAtMs) || !finiteMs(value.updatedAtMs)) return 'Alarm node contains an invalid value.'
  return recurrenceError(value.recurrence)
}

function timerError(value: unknown): string | null {
  const keys = ['id', 'canvasNodeId', 'title', 'data', 'updatedAtMs'] as const
  if (!object(value) || !exact(value, keys) || typeof value.id !== 'string' || !ID.test(value.id) || typeof value.canvasNodeId !== 'string' || !ID.test(value.canvasNodeId) || !boundedText(value.title, DURABLE_OCCURRENCE_LIMITS.maxTitleLength) || !finiteMs(value.updatedAtMs) || !object(value.data)) return 'Timer node is malformed or has an unknown property.'
  const dataKeys = ['timerMode', 'durationMs', 'remainingMs', 'elapsedMs', 'running', 'paused', 'repeatCount', 'repeatRemaining', 'sequence', 'sequenceIndex', 'lapsMs', 'nextOccurrenceAt', 'occurrenceState', 'alarmEnabled', 'alarmTone', 'missedCount', 'wallAnchorMs', 'monotonicAnchorMs'] as const
  const data = value.data
  if (!exact(data, dataKeys)) return 'Timer node data contains an unknown property.'
  if (!['countdown', 'stopwatch', 'interval'].includes(String(data.timerMode)) || !['scheduled', 'running', 'paused', 'completed', 'missed', 'cancelled'].includes(String(data.occurrenceState)) || !['chime', 'bell', 'silent'].includes(String(data.alarmTone)) || ![data.durationMs, data.remainingMs, data.elapsedMs, data.repeatCount, data.repeatRemaining, data.sequenceIndex, data.missedCount].every((n) => Number.isSafeInteger(n) && Number(n) >= 0) || Number(data.durationMs) < 1 || Number(data.repeatRemaining) > Number(data.repeatCount) || typeof data.running !== 'boolean' || typeof data.paused !== 'boolean' || (data.running && (data.paused || data.occurrenceState !== 'running' || data.monotonicAnchorMs === null)) || (data.paused && (data.running || data.occurrenceState !== 'paused')) || (data.occurrenceState === 'completed' && (data.running || data.remainingMs !== 0)) || typeof data.alarmEnabled !== 'boolean' || !Array.isArray(data.sequence) || data.sequence.length > 256 || Number(data.sequenceIndex) > data.sequence.length || data.sequence.some((step) => !object(step) || !exact(step, ['id', 'label', 'durationMs']) || typeof step.id !== 'string' || !ID.test(step.id) || !boundedText(step.label, DURABLE_OCCURRENCE_LIMITS.maxTitleLength) || !Number.isSafeInteger(step.durationMs) || Number(step.durationMs) < 1) || !Array.isArray(data.lapsMs) || data.lapsMs.length > 1000 || data.lapsMs.some((n) => !Number.isSafeInteger(n) || Number(n) < 0) || (data.nextOccurrenceAt !== null && !finiteMs(data.nextOccurrenceAt)) || (data.wallAnchorMs !== null && !finiteMs(data.wallAnchorMs)) || (data.monotonicAnchorMs !== null && !finiteMs(data.monotonicAnchorMs))) return 'Timer node data contains an invalid value.'
  return null
}

function occurrenceError(value: unknown): string | null {
  const keys = ['id', 'kind', 'sourceId', 'scheduledAtMs', 'observedAtMs', 'local', 'status', 'title', 'body', 'soundEnabled', 'narratorEnabled', 'delivery', 'reason'] as const
  if (!object(value) || !exact(value, keys)) return 'Occurrence is malformed or has an unknown property.'
  if (typeof value.id !== 'string' || !ID.test(value.id) || !['planner', 'alarm', 'timer', 'reconciliation'].includes(String(value.kind)) || typeof value.sourceId !== 'string' || !ID.test(value.sourceId) || !finiteMs(value.scheduledAtMs) || !finiteMs(value.observedAtMs) || !boundedText(value.title, DURABLE_OCCURRENCE_LIMITS.maxTitleLength) || !boundedText(value.body, DURABLE_OCCURRENCE_LIMITS.maxBodyLength, false) || typeof value.soundEnabled !== 'boolean' || typeof value.narratorEnabled !== 'boolean' || !['none', 'clock-adjusted', 'catch-up-truncated', 'power-off-not-supported'].includes(String(value.reason)) || !object(value.local) || !exact(value.local, ['timeZone', 'date', 'time']) || !isDurableTimezone(value.local.timeZone) || !isDurableLocalDateTime(`${value.local.date}T${value.local.time}`)) return 'Occurrence contains an invalid value.'
  if (!['intent', 'claimed', 'delivered', 'pending', 'failed', 'missed', 'snoozed', 'dismissed', 'cancelled'].includes(String(value.status))) return 'Occurrence status is invalid.'
  if (!object(value.delivery) || !exact(value.delivery, ['idempotencyKey', 'generation', 'acknowledgedAtMs', 'claimId', 'claimedAtMs', 'outcome', 'error']) || typeof value.delivery.idempotencyKey !== 'string' || !ID.test(value.delivery.idempotencyKey) || !Number.isSafeInteger(value.delivery.generation) || (value.delivery.generation as number) < 0 || (value.delivery.acknowledgedAtMs !== null && !finiteMs(value.delivery.acknowledgedAtMs)) || (value.delivery.claimId !== null && (typeof value.delivery.claimId !== 'string' || !ID.test(value.delivery.claimId))) || (value.delivery.claimedAtMs !== null && !finiteMs(value.delivery.claimedAtMs)) || !['not-attempted', 'delivered', 'pending', 'failed'].includes(String(value.delivery.outcome)) || (value.delivery.error !== null && !boundedText(value.delivery.error, 500, false))) return 'Occurrence delivery record is invalid.'
  return null
}

/** Returns a user-facing error, or null for a valid complete snapshot. */
export function validateDurableOccurrenceSnapshot(raw: unknown): string | null {
  if (!object(raw) || !exact(raw, ['version', 'generation', 'schedules', 'alarms', 'timers', 'occurrences', 'lastWallClockMs', 'lastMonotonicMs', 'monotonicClockId']) || raw.version !== 1 || !Number.isSafeInteger(raw.generation) || (raw.generation as number) < 0 || !Array.isArray(raw.schedules) || !Array.isArray(raw.alarms) || !Array.isArray(raw.timers) || !Array.isArray(raw.occurrences) || raw.schedules.length > DURABLE_OCCURRENCE_LIMITS.maxSchedules || raw.alarms.length > DURABLE_OCCURRENCE_LIMITS.maxAlarms || raw.timers.length > DURABLE_OCCURRENCE_LIMITS.maxAlarms || raw.occurrences.length > DURABLE_OCCURRENCE_LIMITS.maxOccurrences || (raw.lastWallClockMs !== null && !finiteMs(raw.lastWallClockMs)) || (raw.lastMonotonicMs !== null && !finiteMs(raw.lastMonotonicMs)) || (raw.monotonicClockId !== null && (typeof raw.monotonicClockId !== 'string' || !ID.test(raw.monotonicClockId)))) return 'Durable occurrence data is malformed, unsupported, or exceeds its bounds.'
  const ids = new Set<string>()
  for (const schedule of raw.schedules) { const error = scheduleError(schedule); if (error) return error; if (ids.has((schedule as DurableSchedule).id)) return 'Schedule ids must be unique.'; ids.add((schedule as DurableSchedule).id) }
  for (const alarm of raw.alarms) { const error = alarmError(alarm); if (error) return error; if (ids.has((alarm as DurableAlarmNode).id)) return 'Alarm ids must be unique.'; ids.add((alarm as DurableAlarmNode).id) }
  for (const timer of raw.timers) { const error = timerError(timer); if (error) return error; if (ids.has((timer as DurableTimerNode).id)) return 'Timer ids must be unique.'; ids.add((timer as DurableTimerNode).id) }
  const occurrenceIds = new Set<string>()
  const scheduleIds = new Set(raw.schedules.map((item) => (item as DurableSchedule).id))
  const alarmIds = new Set(raw.alarms.map((item) => (item as DurableAlarmNode).id))
  const timerIds = new Set(raw.timers.map((item) => (item as DurableTimerNode).id))
  for (const occurrence of raw.occurrences) {
    const error = occurrenceError(occurrence); if (error) return error
    const row = occurrence as DurableOccurrence
    if (occurrenceIds.has(row.id)) return 'Occurrence ids must be unique.'
    if (row.status !== 'cancelled' && row.kind === 'planner' && !scheduleIds.has(row.sourceId)) return 'Planner occurrence references a missing schedule.'
    if (row.status !== 'cancelled' && row.kind === 'alarm' && !alarmIds.has(row.sourceId)) return 'Alarm occurrence references a missing alarm.'
    if (row.status !== 'cancelled' && row.kind === 'timer' && !timerIds.has(row.sourceId)) return 'Timer occurrence references a missing timer.'
    if (row.status === 'claimed' && (row.delivery.claimId === null || row.delivery.claimedAtMs === null)) return 'Claimed occurrence is missing its claim lease.'
    if (row.status === 'delivered' && row.delivery.outcome !== 'delivered') return 'Delivered occurrence has no delivered outcome.'
    if ((row.status === 'intent' || row.status === 'missed' || row.status === 'cancelled') && row.delivery.outcome !== 'not-attempted') return 'Unclaimed occurrence has an invalid delivery outcome.'
    occurrenceIds.add(row.id)
  }
  return null
}

export function durableOccurrenceId(kind: DurableOccurrenceKind, sourceId: string, scheduledAtMs: number): string {
  return `${kind}:${sourceId}:${scheduledAtMs}`
}

function wallParts(epochMs: number, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(epochMs))
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

/** Resolve a wall time, choosing the earliest repeated DST instant and advancing through a gap. */
export function durableLocalToEpoch(local: string, timeZone: string): number | null {
  if (!isDurableLocalDateTime(local) || !isDurableTimezone(timeZone)) return null
  const [date, time] = local.split('T')
  const nominal = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), Number(time.slice(0, 2)), Number(time.slice(3, 5)))
  const sample = wallParts(nominal, timeZone)
  const sampleUtc = Date.UTC(Number(sample.date.slice(0, 4)), Number(sample.date.slice(5, 7)) - 1, Number(sample.date.slice(8, 10)), Number(sample.time.slice(0, 2)), Number(sample.time.slice(3, 5)))
  const first = nominal - (sampleUtc - nominal)
  const matches: number[] = []
  // The offset correction above lands on the normal instant directly. Only a bounded six-hour
  // neighbourhood is needed for a repeated fold or a local transition, avoiding thousands of
  // formatter calls for every day during catch-up while retaining all modern IANA transitions.
  for (let offset = -6 * 60; offset <= 6 * 60; offset += 1) { const candidate = first + offset * 60_000; const actual = wallParts(candidate, timeZone); if (actual.date === date && actual.time === time) matches.push(candidate) }
  if (matches.length) return Math.min(...matches)
  let firstValid: number | null = null
  for (let offset = -6 * 60; offset <= 6 * 60; offset += 1) {
    const candidate = first + offset * 60_000
    const actual = wallParts(candidate, timeZone)
    if (actual.date > date || (actual.date === date && actual.time > time)) firstValid = firstValid === null ? candidate : Math.min(firstValid, candidate)
  }
  if (firstValid !== null) return firstValid
  return null
}

function shiftDate(date: string, days: number): string { const parts = date.split('-').map(Number); const value = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days)); return value.toISOString().slice(0, 10) }
function dayOfWeek(date: string): DurableWeekday { const parts = date.split('-').map(Number); return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay() as DurableWeekday }

/** Generate wall-clock occurrences and say when the bounded catch-up cap cut some off. */
export function durableOccurrenceTimes(source: Pick<DurableSchedule | DurableAlarmNode, 'enabled' | 'timeZone' | 'startLocal' | 'recurrence'>, fromMs: number, toMs: number, limit = DURABLE_OCCURRENCE_LIMITS.maxCatchUp): { times: number[]; truncated: boolean } {
  if (!source.enabled || toMs <= fromMs) return { times: [], truncated: false }
  const startDate = source.startLocal.slice(0, 10)
  const from = wallParts(fromMs, source.timeZone).date
  const to = wallParts(toMs, source.timeZone).date
  const times: number[] = []
  for (let date = shiftDate(from, -1), count = 0; date <= to && count < 3700; date = shiftDate(date, 1), count += 1) {
    if (date < startDate) continue
    const weekday = dayOfWeek(date)
    const rec = source.recurrence
    const matches = rec.kind === 'once' ? date === startDate : rec.kind === 'daily' ? true : rec.kind === 'weekdays' ? weekday >= 1 && weekday <= 5 : rec.kind === 'weekly' ? rec.weekdays.includes(weekday) : date.slice(8, 10) === String(rec.day).padStart(2, '0')
    if (!matches) continue
    const candidate = durableLocalToEpoch(`${date}T${source.startLocal.slice(11)}`, source.timeZone)
    if (candidate !== null && candidate > fromMs && candidate <= toMs) { times.push(candidate); if (times.length > limit) return { times: times.slice(0, limit), truncated: true } }
    if (rec.kind === 'once' && date >= startDate) break
  }
  return { times, truncated: false }
}

export function durableOccurrenceLocal(occurrence: Pick<DurableOccurrence, 'scheduledAtMs' | 'local'>): { timeZone: string; date: string; time: string } {
  return { timeZone: occurrence.local.timeZone, ...wallParts(occurrence.scheduledAtMs, occurrence.local.timeZone) }
}

/**
 * The outcome of claiming one occurrence for delivery.
 *
 * It lives HERE rather than beside the service because `NodeTerminalApi.claim()` in
 * `shared/types.ts` is declared as returning it, and that declaration crosses the CorePlatform
 * seam — the renderer and both shells have to agree on the union. The service re-exports it so
 * its existing importers keep working; shared must never import from core, so the definition
 * goes in this direction and not the other.
 */
export type DurableDeliveryResult = 'delivered' | 'pending' | 'failed'
