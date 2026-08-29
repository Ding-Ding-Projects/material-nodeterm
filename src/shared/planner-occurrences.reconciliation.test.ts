import { describe, expect, it } from 'vitest'
import {
  defaultPlannerFile,
  plannerOccurrencesBetween,
  resolvePlannerLocalTime,
  validatePlannerFile,
  type PlannerSchedule
} from './planner-occurrences'

const schedule = (overrides: Partial<PlannerSchedule> = {}): PlannerSchedule => ({
  id: 'morning',
  title: 'Morning',
  enabled: true,
  timeZone: 'America/Toronto',
  startLocal: '2026-01-01T09:00',
  recurrence: { kind: 'daily' },
  notification: { title: 'Stand up', body: 'Stretch' },
  ...overrides
})

describe('planner occurrence contracts', () => {
  it('resolves repeated and nonexistent daylight-saving times deterministically', () => {
    const repeated = resolvePlannerLocalTime('2026-11-01T01:30', 'America/Toronto')
    const gap = resolvePlannerLocalTime('2026-03-08T02:30', 'America/Toronto')
    expect(repeated).not.toBeNull()
    expect(gap).not.toBeNull()
    expect(new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', hour12: false, dateStyle: 'short', timeStyle: 'short' }).format(new Date(gap!))).toContain('03:00')
  })

  it('keeps weekly occurrences and caps dense catch-up', () => {
    const weekly = schedule({ recurrence: { kind: 'weekly', days: [1, 3, 5] } })
    const result = plannerOccurrencesBetween(weekly, Date.parse('2026-01-01T00:00:00Z'), Date.parse('2026-03-01T00:00:00Z'))
    expect(result.length).toBeGreaterThan(0)
    const dense = schedule({ startLocal: '2020-01-01T00:00' })
    const capped = plannerOccurrencesBetween(dense, Date.parse('2020-01-01T00:00:00Z'), Date.parse('2026-01-01T00:00:00Z'))
    expect(capped.length).toBe(100)
  })

  it('rejects malformed persisted records and accepts the empty versioned file', () => {
    expect(validatePlannerFile(defaultPlannerFile())).toBeNull()
    expect(validatePlannerFile({ ...defaultPlannerFile(), stale: true })).toContain('unknown')
    expect(validatePlannerFile({ ...defaultPlannerFile(), schedules: [{ ...schedule(), id: 'bad id' }] })).toContain('id')
    expect(validatePlannerFile({ ...defaultPlannerFile(), schedules: [{ ...schedule(), notification: { ...schedule().notification, stale: true } }] })).toContain('unknown')
    expect(validatePlannerFile({ ...defaultPlannerFile(), occurrences: [{ id: 'one', scheduleId: 'morning', scheduledAtMs: 0, observedAtMs: 0, status: 'unknown', title: 'x', body: 'x' }] })).toContain('status')
  })
})
