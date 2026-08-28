/** Persisted timer-node model. All timestamps are epoch milliseconds. */
export type TimerMode = 'countdown' | 'stopwatch' | 'interval'
export type TimerOccurrenceState = 'scheduled' | 'running' | 'paused' | 'completed' | 'missed'

export interface TimerSequenceStep {
  id: string
  label: string
  durationMs: number
}

export interface TimerOccurrence {
  id: string
  timerId: string
  scheduledAt: number
  startedAt?: number
  endedAt?: number
  state: TimerOccurrenceState
  lapsMs: number[]
}

export interface TimerNodeData {
  [key: string]: unknown
  title: string
  color: string
  group: string | null
  timerMode: TimerMode
  durationMs: number
  remainingMs: number
  elapsedMs: number
  running: boolean
  paused: boolean
  repeatCount: number
  repeatRemaining: number
  sequence: TimerSequenceStep[]
  sequenceIndex: number
  lapsMs: number[]
  nextOccurrenceAt?: number
  occurrenceId?: string
  occurrenceState: TimerOccurrenceState
  alarmEnabled: boolean
  alarmTone: 'chime' | 'bell' | 'silent'
  missedCount: number
  wallAnchorMs?: number
  monotonicAnchorMs?: number
}

export const TIMER_MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000
export const TIMER_DEFAULT_DURATION_MS = 5 * 60 * 1000

export function clampTimerDuration(value: number): number {
  if (!Number.isFinite(value)) return TIMER_DEFAULT_DURATION_MS
  return Math.min(TIMER_MAX_DURATION_MS, Math.max(1000, Math.round(value)))
}

export function formatTimerMs(value: number): string {
  const total = Math.max(0, Math.round(value / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function timerNextState(data: Pick<TimerNodeData, 'timerMode' | 'durationMs' | 'remainingMs' | 'elapsedMs' | 'running' | 'paused'>, now: number, lastTick: number) {
  if (!data.running || data.paused) return { remainingMs: data.remainingMs, elapsedMs: data.elapsedMs, completed: false }
  const delta = Math.max(0, now - lastTick)
  if (data.timerMode === 'stopwatch') return { remainingMs: 0, elapsedMs: data.elapsedMs + delta, completed: false }
  const remainingMs = Math.max(0, data.remainingMs - delta)
  return { remainingMs, elapsedMs: data.elapsedMs + delta, completed: remainingMs === 0 }
}

export function timerExportRecord(data: TimerNodeData, occurrences: readonly TimerOccurrence[] = []) {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), timer: data, occurrences }, null, 2)
}

export function isValidTimerOccurrence(value: unknown): value is TimerOccurrence {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  const states: TimerOccurrenceState[] = ['scheduled', 'running', 'paused', 'completed', 'missed']
  return typeof row.id === 'string' && row.id.length <= 160 && typeof row.timerId === 'string' && row.timerId.length <= 160 &&
    Number.isSafeInteger(row.scheduledAt) && (row.startedAt === undefined || Number.isSafeInteger(row.startedAt)) &&
    (row.endedAt === undefined || Number.isSafeInteger(row.endedAt)) && states.includes(row.state as TimerOccurrenceState) &&
    Array.isArray(row.lapsMs) && row.lapsMs.length <= 1000 && row.lapsMs.every((lap) => Number.isSafeInteger(lap) && (lap as number) >= 0)
}
