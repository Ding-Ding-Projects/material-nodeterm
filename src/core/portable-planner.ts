/** Safe schema 3 planner intent and its explicit destination Configure seam.
 *
 * Occurrence history, last-tick state, and the host's application-data location remain local.
 * Only user-authored schedule definitions travel in a portable project projection.
 */

import {
  PLANNER_SCHEMA_VERSION,
  PLANNER_LIMITS,
  defaultPlannerFile,
  validatePlannerFile,
  type PlannerSchedule
} from '../shared/planner-occurrences'

export const PORTABLE_PLANNER_SCHEMA_VERSION = 1 as const
export const PORTABLE_PLANNER_FEATURE_ID = 'planner' as const

export interface PortablePlannerDefinitions {
  schemaVersion: typeof PORTABLE_PLANNER_SCHEMA_VERSION
  featureId: typeof PORTABLE_PLANNER_FEATURE_ID
  displayLabel: string
  schedules: PlannerSchedule[]
}

const SCHEDULE_KEYS = new Set(['id', 'title', 'enabled', 'timeZone', 'startLocal', 'endTime', 'recurrence', 'notification'])
const RECURRENCE_KEYS = new Set(['kind', 'days', 'everyMinutes'])
const NOTIFICATION_KEYS = new Set(['title', 'body'])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Portable ${label} contains an unknown field: ${key}`)
}

function cloneSchedule(value: unknown): PlannerSchedule {
  if (!record(value)) throw new Error('Portable planner schedule is malformed.')
  rejectUnknownKeys(value, SCHEDULE_KEYS, 'planner schedule')
  if (!record(value.recurrence)) throw new Error('Portable planner recurrence is malformed.')
  rejectUnknownKeys(value.recurrence, RECURRENCE_KEYS, 'planner recurrence')
  if (!record(value.notification)) throw new Error('Portable planner notification is malformed.')
  rejectUnknownKeys(value.notification, NOTIFICATION_KEYS, 'planner notification')
  const schedule = {
    ...value,
    recurrence: { ...value.recurrence },
    notification: { ...value.notification }
  } as PlannerSchedule
  const error = validatePlannerFile({ ...defaultPlannerFile(), schedules: [schedule] })
  if (error) throw new Error(error)
  return schedule
}

export function plannerDefinitionsToPortable(schedules: readonly PlannerSchedule[]): PortablePlannerDefinitions | undefined {
  if (schedules.length === 0) return undefined
  if (schedules.length > PLANNER_LIMITS.maxSchedules) throw new Error(`Planner supports at most ${PLANNER_LIMITS.maxSchedules} schedules.`)
  const cloned = schedules.map(cloneSchedule)
  const error = validatePlannerFile({ ...defaultPlannerFile(), schedules: cloned })
  if (error) throw new Error(error)
  return {
    schemaVersion: PORTABLE_PLANNER_SCHEMA_VERSION,
    featureId: PORTABLE_PLANNER_FEATURE_ID,
    displayLabel: 'Planner',
    schedules: cloned
  }
}

export function validatePortablePlannerDefinitions(value: unknown): PortablePlannerDefinitions {
  if (!record(value) || value.schemaVersion !== PORTABLE_PLANNER_SCHEMA_VERSION || value.featureId !== PORTABLE_PLANNER_FEATURE_ID) {
    throw new Error('Portable planner definition version is unsupported.')
  }
  rejectUnknownKeys(value, new Set(['schemaVersion', 'featureId', 'displayLabel', 'schedules']), 'planner definitions')
  if (typeof value.displayLabel !== 'string' || value.displayLabel !== 'Planner') throw new Error('Portable planner definition label is invalid.')
  if (!Array.isArray(value.schedules) || value.schedules.length > PLANNER_LIMITS.maxSchedules) throw new Error('Portable planner schedule count is invalid.')
  const schedules = value.schedules.map(cloneSchedule)
  const error = validatePlannerFile({ ...defaultPlannerFile(), schedules })
  if (error) throw new Error(error)
  return { schemaVersion: 1, featureId: 'planner', displayLabel: 'Planner', schedules }
}

/** Merge imported definitions without overwriting a destination schedule or its history. */
export function mergePortablePlannerSchedules(existing: readonly PlannerSchedule[], imported: readonly PlannerSchedule[]): PlannerSchedule[] {
  const result = existing.map((schedule) => cloneSchedule(schedule))
  const ids = new Set(result.map((schedule) => schedule.id))
  for (const source of imported) {
    const schedule = cloneSchedule(source)
    if (!ids.has(schedule.id)) {
      result.push(schedule)
      ids.add(schedule.id)
      continue
    }
    const same = JSON.stringify(result.find((candidate) => candidate.id === schedule.id)) === JSON.stringify(schedule)
    if (same) continue
    let suffix = 1
    const suffixText = () => `:import-${suffix}`
    let id = `${schedule.id.slice(0, Math.max(1, 128 - suffixText().length))}${suffixText()}`
    while (ids.has(id)) {
      suffix += 1
      id = `${schedule.id.slice(0, Math.max(1, 128 - suffixText().length))}${suffixText()}`
    }
    result.push({ ...schedule, id })
    ids.add(id)
  }
  if (result.length > PLANNER_LIMITS.maxSchedules) throw new Error(`Planner supports at most ${PLANNER_LIMITS.maxSchedules} schedules.`)
  return result
}
