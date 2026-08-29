import { canonicalTriggerSpec, sanitizeTriggerSpec, type TriggerSchedule, type TriggerSpec, type TriggerRunOutcome, type TriggerRunReceipt, type TriggerStatus } from '../shared/trigger'
import type { CanvasNodeState, Project } from '../shared/types'
import { TriggerArmStore } from './trigger-arm-store'

export interface TriggerDeliveryResult {
  outcome: Exclude<TriggerRunOutcome, 'skipped-previous-run-active' | 'missed' | 'cancelled'>
  error?: string
}

export interface TriggerSchedulerOptions {
  armStore: TriggerArmStore
  now?: () => number
  timeZone?: () => string
  getProject?: (projectId: string) => Project | undefined
  deliver: (input: {
    projectId: string
    nodeId: string
    target: CanvasNodeState
    spec: TriggerSpec
    traceId: string
    manual: boolean
  }) => Promise<TriggerDeliveryResult>
  notify?: (receipt: TriggerRunReceipt) => void
  maxHistory?: number
}

interface TriggerSlot {
  projectId: string
  nodeId: string
  spec: TriggerSpec
  nextOccurrenceAt?: number
  inFlight: boolean
  last?: TriggerRunReceipt
}

const MINUTE = 60_000
const DEFAULT_HISTORY = 200

function traceId(): string {
  return 'trigger-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

function scheduleIdentity(schedule: TriggerSchedule): string {
  return schedule.kind === 'cron'
    ? 'cron:' + schedule.expr
    : schedule.kind === 'interval'
      ? 'interval:' + schedule.everyMinutes
      : 'once:' + schedule.at
}

function fieldsFor(date: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short'
  }).formatToParts(date)
  const values: Record<string, string> = {}
  for (const part of parts) values[part.type] = part.value
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday)
  return {
    minute: Number(values.minute),
    hour: Number(values.hour) % 24,
    day: Number(values.day),
    month: Number(values.month),
    weekday: weekday < 0 ? date.getUTCDay() : weekday
  }
}

function cronFieldMatches(value: number, source: string, min: number, max: number): boolean {
  for (const rawPart of source.split(',')) {
    const [rawRange, rawStep] = rawPart.split('/')
    const step = rawStep === undefined ? 1 : Number(rawStep)
    if (!Number.isInteger(step) || step <= 0) continue
    const range = rawRange === '*' ? [min, max] : rawRange.split('-').map(Number)
    if (range.length === 1 && Number.isInteger(range[0]) && value === range[0]) return true
    if (range.length === 2 && Number.isInteger(range[0]) && Number.isInteger(range[1])) {
      const [from, to] = range
      if (from >= min && to <= max && value >= from && value <= to && (value - from) % step === 0) return true
    }
  }
  return false
}

function cronMatches(date: Date, expr: string, timeZone: string): boolean {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return false
  const value = fieldsFor(date, timeZone)
  return cronFieldMatches(value.minute, fields[0], 0, 59) &&
    cronFieldMatches(value.hour, fields[1], 0, 23) &&
    cronFieldMatches(value.day, fields[2], 1, 31) &&
    cronFieldMatches(value.month, fields[3], 1, 12) &&
    cronFieldMatches(value.weekday, fields[4], 0, 6)
}

export function nextTriggerOccurrence(schedule: TriggerSchedule, after: number, timeZone = 'UTC'): number | undefined {
  if (schedule.kind === 'once') {
    const at = Date.parse(schedule.at)
    return Number.isFinite(at) && at > after ? at : undefined
  }
  if (schedule.kind === 'interval') return after + schedule.everyMinutes * MINUTE
  const start = Math.floor(after / MINUTE) * MINUTE + MINUTE
  const end = start + 366 * 24 * 60 * MINUTE
  for (let candidate = start; candidate <= end; candidate += MINUTE) {
    if (cronMatches(new Date(candidate), schedule.expr, timeZone)) return candidate
  }
  return undefined
}

export class TriggerScheduler {
  private readonly slots = new Map<string, TriggerSlot>()
  private readonly history: TriggerRunReceipt[] = []
  private readonly now: () => number
  private readonly timeZone: () => string
  private readonly maxHistory: number
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly options: TriggerSchedulerOptions) {
    this.now = options.now ?? Date.now
    this.timeZone = options.timeZone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
    this.maxHistory = Math.max(1, Math.floor(options.maxHistory ?? DEFAULT_HISTORY))
  }

  private key(projectId: string, nodeId: string): string {
    return projectId + '\u0000' + nodeId
  }

  updateProject(projectId: string, nodes: CanvasNodeState[]): void {
    const seen = new Set<string>()
    for (const node of nodes) {
      if (node.kind !== 'trigger' || !node.trigger) continue
      const spec = sanitizeTriggerSpec(node.trigger)
      if (!spec) continue
      const key = this.key(projectId, node.id)
      seen.add(key)
      const current = this.slots.get(key)
      if (!current || canonicalTriggerSpec(current.spec) !== canonicalTriggerSpec(spec)) {
        const slot: TriggerSlot = { projectId, nodeId: node.id, spec, inFlight: current?.inFlight ?? false }
        if (this.options.armStore.isArmed(projectId, node.id, spec)) {
          slot.nextOccurrenceAt = nextTriggerOccurrence(spec.schedule, this.now() - MINUTE, this.timeZone())
        }
        this.slots.set(key, slot)
      } else {
        current.spec = spec
        if (current.nextOccurrenceAt === undefined && this.options.armStore.isArmed(projectId, node.id, spec)) {
          current.nextOccurrenceAt = nextTriggerOccurrence(spec.schedule, this.now() - MINUTE, this.timeZone())
        }
      }
    }
    for (const [key, slot] of this.slots) {
      if (slot.projectId === projectId && !seen.has(key)) this.slots.delete(key)
    }
  }

  closeProject(projectId: string): void {
    for (const [key, slot] of this.slots) {
      if (slot.projectId === projectId) {
        slot.nextOccurrenceAt = undefined
        this.slots.delete(key)
      }
    }
  }

  start(intervalMs = 1_000): void {
    if (this.timer) return
    const delay = Number.isFinite(intervalMs) && intervalMs >= 100 ? Math.floor(intervalMs) : 1_000
    this.timer = setInterval(() => { void this.tick() }, delay)
    this.timer.unref?.()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  async arm(projectId: string, nodeId: string, spec: TriggerSpec): Promise<boolean> {
    const safe = sanitizeTriggerSpec(spec)
    if (!safe || !(await this.options.armStore.arm(projectId, nodeId, safe))) return false
    const slot = this.slots.get(this.key(projectId, nodeId))
    if (slot) {
      const now = this.now()
      slot.nextOccurrenceAt = safe.schedule.kind === 'once' && Date.parse(safe.schedule.at) <= now
        ? Date.parse(safe.schedule.at)
        : nextTriggerOccurrence(safe.schedule, now - MINUTE, this.timeZone())
    }
    return true
  }

  async disarm(projectId: string, nodeId: string): Promise<void> {
    await this.options.armStore.disarm(projectId, nodeId)
    const slot = this.slots.get(this.key(projectId, nodeId))
    if (slot) slot.nextOccurrenceAt = undefined
  }

  status(projectId: string, nodeId: string): TriggerStatus {
    const slot = this.slots.get(this.key(projectId, nodeId))
    if (!slot) return { armed: false, changedSinceArmed: false, inFlight: false }
    const record = this.options.armStore.armedRecord(projectId, nodeId)
    const armed = this.options.armStore.isArmed(projectId, nodeId, slot.spec)
    return { armed, changedSinceArmed: !!record && !armed, nextOccurrenceAt: slot.nextOccurrenceAt, inFlight: slot.inFlight, last: slot.last }
  }

  async runNow(projectId: string, nodeId: string): Promise<TriggerRunReceipt> {
    return this.run(projectId, nodeId, true)
  }

  async tick(at = this.now()): Promise<void> {
    const due = [...this.slots.values()].filter((slot) => slot.nextOccurrenceAt !== undefined && slot.nextOccurrenceAt <= at)
    await Promise.all(due.map(async (slot) => {
      const dueAt = slot.nextOccurrenceAt!
      if (slot.spec.schedule.kind === 'once' && at >= dueAt) {
        slot.nextOccurrenceAt = undefined
        if (at > dueAt) {
          this.record(this.baseReceipt(slot.projectId, slot.nodeId, slot.spec.target, 'missed', at))
          return
        }
      } else {
        slot.nextOccurrenceAt = nextTriggerOccurrence(slot.spec.schedule, at, this.timeZone())
      }
      await this.run(slot.projectId, slot.nodeId, false)
    }))
  }

  listHistory(projectId?: string, nodeId?: string): TriggerRunReceipt[] {
    return this.history.filter((item) =>
      (projectId === undefined || item.projectId === projectId) &&
      (nodeId === undefined || item.nodeId === nodeId)
    )
  }

  private async run(projectId: string, nodeId: string, manual: boolean): Promise<TriggerRunReceipt> {
    const slot = this.slots.get(this.key(projectId, nodeId))
    const at = this.now()
    if (!slot) return this.record(this.baseReceipt(projectId, nodeId, '', 'failed', at, 'trigger-not-found'))
    if (slot.inFlight) return this.record(this.baseReceipt(projectId, nodeId, slot.spec.target, 'skipped-previous-run-active', at))
    const project = this.options.getProject?.(projectId)
    const target = project?.nodes.find((node) => node.id === slot.spec.target)
    if (!target || (target.kind !== 'terminal' && target.kind !== 'subagent')) {
      return this.record(this.baseReceipt(projectId, nodeId, slot.spec.target, 'target-missing', at))
    }
    if (!manual && !this.options.armStore.isArmed(projectId, nodeId, slot.spec)) {
      return this.record(this.baseReceipt(projectId, nodeId, slot.spec.target, 'cancelled', at))
    }
    slot.inFlight = true
    const id = traceId()
    let result: TriggerDeliveryResult
    try {
      result = await this.options.deliver({ projectId, nodeId, target, spec: slot.spec, traceId: id, manual })
    } catch (error) {
      result = { outcome: 'failed', error: error instanceof Error ? error.message : 'delivery failed' }
    } finally {
      slot.inFlight = false
    }
    return this.record({ id, projectId, nodeId, target: slot.spec.target, schedule: scheduleIdentity(slot.spec.schedule), outcome: result.outcome, at, traceId: id, ...(result.error ? { error: result.error } : {}) })
  }

  private baseReceipt(projectId: string, nodeId: string, target: string, outcome: TriggerRunOutcome, at: number, error?: string): TriggerRunReceipt {
    const id = traceId()
    return { id, projectId, nodeId, target, schedule: '', outcome, at, traceId: id, ...(error ? { error } : {}) }
  }

  private record(receipt: TriggerRunReceipt): TriggerRunReceipt {
    this.history.push(receipt)
    while (this.history.length > this.maxHistory) this.history.shift()
    const slot = this.slots.get(this.key(receipt.projectId, receipt.nodeId))
    if (slot) slot.last = receipt
    this.options.notify?.(receipt)
    return receipt
  }
}
