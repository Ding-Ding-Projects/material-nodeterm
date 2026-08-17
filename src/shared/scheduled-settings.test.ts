import { describe, expect, it } from 'vitest'

import {
  SCHEDULE_LIMITS,
  defaultScheduledSettingsFile,
  newScheduleRule,
  normalizeScheduledSettingsFile,
  validateScheduledSettingsFile,
  type ScheduledSettingsFile
} from './scheduled-settings'

const RULE_ID = '6bb5a710-5d8f-4ca3-8e65-e1ec6088124d'

function validFile(): ScheduledSettingsFile {
  return {
    ...defaultScheduledSettingsFile(),
    timezone: 'UTC',
    rules: [newScheduleRule(RULE_ID)]
  }
}

describe('scheduled-settings persisted input', () => {
  it.each([
    ['a string enabled flag', { enabled: 'false' }],
    ['a malformed API source', { source: { kind: 'api' } }],
    ['an invalid Home Assistant entity', {
      source: { kind: 'home-assistant', baseUrl: 'https://ha.example', entityId: 'light.office' }
    }],
    ['an unknown source kind', { source: { kind: 'surprise' } }]
  ])('fails a rule closed when disk input contains %s', (_label, patch) => {
    const normalized = normalizeScheduledSettingsFile({
      version: 1,
      timezone: 'UTC',
      rules: [{ ...newScheduleRule(RULE_ID), ...patch }]
    })

    expect(normalized.rules).toHaveLength(1)
    expect(normalized.rules[0].enabled).toBe(false)
  })

  it('keeps a missing legacy source local without turning malformed enabled data on', () => {
    const normalized = normalizeScheduledSettingsFile({
      version: 1,
      timezone: 'UTC',
      rules: [{ id: RULE_ID, label: 'legacy', window: { days: 'every-day' }, values: {} }]
    })

    expect(normalized.rules[0]).toMatchObject({ enabled: true, source: { kind: 'local' } })
  })
})

describe('scheduled-settings save validation', () => {
  it('rejects data that tolerant normalization would otherwise truncate or coerce', () => {
    const tooMany = validFile()
    tooMany.rules = Array.from({ length: SCHEDULE_LIMITS.maxRules + 1 }, (_, index) =>
      newScheduleRule(`${RULE_ID}-${index}`)
    )
    expect(validateScheduledSettingsFile(tooMany)).toContain(`at most ${SCHEDULE_LIMITS.maxRules}`)

    const longLabel = validFile()
    longLabel.rules[0].label = 'x'.repeat(SCHEDULE_LIMITS.maxLabelLength + 1)
    expect(validateScheduledSettingsFile(longLabel)).toContain('label is limited')

    const malformed = validFile() as unknown as { rules: Array<Record<string, unknown>> }
    malformed.rules[0].enabled = 'false'
    malformed.rules[0].source = { kind: 'api' }
    expect(validateScheduledSettingsFile(malformed)).toContain('invalid enabled')
  })

  it('rejects an invalid external source instead of accepting its local normalization', () => {
    const malformed = validFile() as unknown as { rules: Array<Record<string, unknown>> }
    malformed.rules[0].source = { kind: 'api' }

    expect(validateScheduledSettingsFile(malformed)).toBe('The API URL is required.')
  })
})
