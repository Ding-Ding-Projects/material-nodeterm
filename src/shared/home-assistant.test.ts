import { describe, expect, it } from 'vitest'
import {
  classifyHomeAssistantState,
  defaultHomeAssistantSensorConfig,
  homeAssistantGaugeRange,
  homeAssistantTrendRange,
  normalizeHomeAssistantSensorEntity,
  parseHomeAssistantNumericState,
  validateHomeAssistantConnection,
  validateHomeAssistantSensorConfig
} from './home-assistant'
import { MAX_JSON_ARRAY, MAX_JSON_DEPTH, MAX_JSON_KEYS, MAX_JSON_STRING, MAX_WS_FRAME_BYTES, apiUrl, parseBoundedJson } from '../core/home-assistant/sensor-service'

const entity = (overrides: Record<string, unknown> = {}) => ({
  entity_id: 'sensor.office_temperature',
  state: '22.5',
  attributes: { friendly_name: 'Office', unit_of_measurement: '°C', min: 0, max: 50, nested: { ok: true }, forecast: [{ temperature: 22 }] },
  last_updated: new Date(1_700_000_000_000).toISOString(),
  ...overrides
})

describe('Home Assistant sensor contract', () => {
  it('rejects unknown config keys, controls, null prototypes, and out-of-range values instead of clamping', () => {
    expect(validateHomeAssistantSensorConfig({ ...defaultHomeAssistantSensorConfig(), extra: true })).toBeNull()
    expect(validateHomeAssistantSensorConfig({ ...defaultHomeAssistantSensorConfig(), historyLimit: 0 })).toBeNull()
    expect(validateHomeAssistantSensorConfig({ ...defaultHomeAssistantSensorConfig(), unitOverride: 'ok\nno' })).toBeNull()
    const nullProto = Object.create(null) as Record<string, unknown>
    Object.assign(nullProto, defaultHomeAssistantSensorConfig())
    expect(validateHomeAssistantSensorConfig(nullProto)).toBeNull()
  })

  it('keeps structured attributes and refuses unsafe attribute objects', () => {
    const normalized = normalizeHomeAssistantSensorEntity(entity())
    expect(normalized?.attributes.nested).toEqual({ ok: true })
    expect(normalized?.attributes.forecast).toEqual([{ temperature: 22 }])
    expect(normalizeHomeAssistantSensorEntity(entity({ attributes: Object.create(null) }))).toBeNull()
    expect(normalizeHomeAssistantSensorEntity(entity({ attributes: { bad: { deep: { deeper: { too: { far: true } } } } } }))).toBeNull()
  })

  it('classifies unknown, unavailable, stale, and malformed timestamps distinctly', () => {
    const now = 1_700_000_100_000
    expect(classifyHomeAssistantState('unknown', undefined, now)).toBe('unknown')
    expect(classifyHomeAssistantState('unavailable', undefined, now)).toBe('unavailable')
    expect(classifyHomeAssistantState('22', new Date(now - 200_000).toISOString(), now, 120_000)).toBe('stale')
    expect(classifyHomeAssistantState('22', 'not-a-timestamp', now)).toBe('invalid-timestamp')
  })

  it('parses numeric states without accepting whitespace coercion', () => {
    expect(parseHomeAssistantNumericState('22.5')).toBe(22.5)
    expect(parseHomeAssistantNumericState(' 22.5')).toBeNull()
    expect(parseHomeAssistantNumericState('')).toBeNull()
    expect(parseHomeAssistantNumericState('0x10')).toBeNull()
  })

  it('requires a real gauge range and preserves a real trend range', () => {
    const normalized = normalizeHomeAssistantSensorEntity(entity())!
    const config = { ...defaultHomeAssistantSensorConfig(normalized.entityId), mode: 'gauge' as const }
    expect(homeAssistantGaugeRange(normalized, config)).toEqual({ min: 0, max: 50 })
    expect(homeAssistantGaugeRange(normalized, { ...config, unitOverride: '', gaugeMin: 0, gaugeMax: undefined })).toBeNull()
    expect(homeAssistantTrendRange([{ at: 1, value: 20, state: '20' }, { at: 2, value: null, state: 'unknown' }], defaultHomeAssistantSensorConfig())).toEqual({ min: 19, max: 21 })
  })

  it('keeps entity path segments encoded and rejects unsafe endpoints', () => {
    expect(apiUrl('https://ha.example.test/base', '/api/states/sensor.office_temperature')).toBe('https://ha.example.test/base/api/states/sensor.office_temperature')
    expect(validateHomeAssistantConnection({ endpoint: 'http://ha.example.test' })).toBeNull()
    expect(validateHomeAssistantConnection({ endpoint: 'http://127.0.0.1:8123', credentialKey: '123e4567-e89b-42d3-a456-426614174000' })).not.toBeNull()
    expect(validateHomeAssistantConnection({ endpoint: 'https://user:secret@ha.example.test' })).toBeNull()
  })

  it('bounds raw frames and parsed JSON shape', () => {
    expect(() => parseBoundedJson('x'.repeat(MAX_WS_FRAME_BYTES + 1))).toThrow()
    expect(() => parseBoundedJson(JSON.stringify(Array.from({ length: MAX_JSON_ARRAY + 1 }, () => null)))).toThrow()
    expect(() => parseBoundedJson(JSON.stringify(Object.fromEntries(Array.from({ length: MAX_JSON_KEYS + 1 }, (_, i) => [`k${i}`, true]))))).toThrow()
    expect(() => parseBoundedJson(JSON.stringify('x'.repeat(MAX_JSON_STRING + 1)))).toThrow()
    let tooDeep: unknown = true
    for (let i = 0; i <= MAX_JSON_DEPTH + 1; i += 1) tooDeep = { nested: tooDeep }
    expect(() => parseBoundedJson(JSON.stringify(tooDeep))).toThrow()
    expect(parseBoundedJson('{"type":"auth_ok"}')).toEqual({ type: 'auth_ok' })
  })
})
