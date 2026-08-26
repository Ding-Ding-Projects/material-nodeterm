import { describe, it, expect } from 'vitest'
import { validateWslDistributionName } from './name'

describe('validateWslDistributionName', () => {
  it('accepts an ordinary name', () => {
    expect(validateWslDistributionName('my-project', [])).toEqual({ ok: true })
  })

  it('refuses an empty name', () => {
    const result = validateWslDistributionName('', [])
    expect(result).toEqual({ ok: false, reason: 'empty', message: expect.any(String) })
  })

  it('refuses a name over the length limit', () => {
    const result = validateWslDistributionName('a'.repeat(65), [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('too-long')
  })

  it('accepts a name exactly at the length limit', () => {
    expect(validateWslDistributionName('a'.repeat(64), []).ok).toBe(true)
  })

  it('refuses a name starting with a hyphen (could be misread as a flag)', () => {
    const result = validateWslDistributionName('-d', [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid-characters')
  })

  it('refuses a name containing a space', () => {
    const result = validateWslDistributionName('my project', [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid-characters')
  })

  it('refuses a name containing a slash', () => {
    const result = validateWslDistributionName('my/project', [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid-characters')
  })

  it('refuses a name containing a control character', () => {
    const result = validateWslDistributionName('bad\x00name', [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid-characters')
  })

  it('accepts letters, digits, dots, hyphens, and underscores', () => {
    expect(validateWslDistributionName('Ubuntu-22.04_test', []).ok).toBe(true)
  })

  it('refuses a Windows reserved device name, case-insensitively', () => {
    const result = validateWslDistributionName('con', [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('reserved-name')
  })

  it('refuses a name colliding with an existing distribution, case-insensitively', () => {
    const result = validateWslDistributionName('ubuntu', ['Ubuntu', 'docker-desktop'])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('name-taken')
  })

  it('does not refuse a name that only looks similar to an existing one', () => {
    expect(validateWslDistributionName('Ubuntu2', ['Ubuntu']).ok).toBe(true)
  })
})
