import { describe, expect, it } from 'vitest'
import { schoolModeAllowsOptionalFeatures } from './schoolModePolicy'

describe('School-mode optional-feature policy', () => {
  it('allows features only after a real OFF record has hydrated', () => {
    expect(schoolModeAllowsOptionalFeatures({ hydrated: false, enabled: false })).toBe(false)
    expect(schoolModeAllowsOptionalFeatures({ hydrated: false, enabled: true })).toBe(false)
    expect(schoolModeAllowsOptionalFeatures({ hydrated: true, enabled: true })).toBe(false)
    expect(schoolModeAllowsOptionalFeatures({ hydrated: true, enabled: false })).toBe(true)
  })
})
