import { describe, expect, it } from 'vitest'
import {
  featureEnabled,
  masterEnabled,
  proFeatureSettingsKey,
  PRO_FEATURES,
  resolveProFeatures,
  type ProFeatureSettings
} from './proFeatureAccess'

function settings(overrides: Partial<ProFeatureSettings> = {}): ProFeatureSettings {
  return {
    proFeaturesEnabled: true,
    proFeatureRemoteAccessEnabled: true,
    proFeatureTeamSeatsEnabled: true,
    ...overrides
  }
}

describe('masterEnabled', () => {
  it('is on by default', () => {
    expect(masterEnabled(settings())).toBe(true)
  })

  it('is off only when explicitly false', () => {
    expect(masterEnabled(settings({ proFeaturesEnabled: false }))).toBe(false)
  })

  it('defensively reads as on when the field is missing (unhydrated settings)', () => {
    expect(masterEnabled({} as ProFeatureSettings)).toBe(true)
  })
})

describe('featureEnabled', () => {
  it('every feature is on by default, matching the pre-toggle fully-unlocked behavior', () => {
    const s = settings()
    expect(featureEnabled(s, 'remoteAccess')).toBe(true)
    expect(featureEnabled(s, 'teamSeats')).toBe(true)
  })

  it('the master switch forces every feature off, whatever each one is set to', () => {
    const s = settings({
      proFeaturesEnabled: false,
      proFeatureRemoteAccessEnabled: true,
      proFeatureTeamSeatsEnabled: true
    })
    expect(featureEnabled(s, 'remoteAccess')).toBe(false)
    expect(featureEnabled(s, 'teamSeats')).toBe(false)
  })

  it('turning the master back on restores a feature to its own stored choice, unmodified', () => {
    const off = settings({ proFeaturesEnabled: false, proFeatureRemoteAccessEnabled: false })
    expect(featureEnabled(off, 'remoteAccess')).toBe(false)

    // The master being off never rewrote the stored per-feature choice — flipping only the master
    // back on must resolve the SAME stored value, never silently reset it to the default.
    const backOn = { ...off, proFeaturesEnabled: true }
    expect(off.proFeatureRemoteAccessEnabled).toBe(false) // untouched by computing featureEnabled above
    expect(featureEnabled(backOn, 'remoteAccess')).toBe(false)
  })

  it('remoteAccess off drags teamSeats off too, without touching teamSeats own stored choice', () => {
    const s = settings({ proFeatureRemoteAccessEnabled: false, proFeatureTeamSeatsEnabled: true })
    expect(featureEnabled(s, 'remoteAccess')).toBe(false)
    expect(featureEnabled(s, 'teamSeats')).toBe(false) // riding a disabled feature
    expect(s.proFeatureTeamSeatsEnabled).toBe(true) // its own choice, never rewritten
  })

  it('teamSeats can be turned off independently while remoteAccess stays on', () => {
    const s = settings({ proFeatureTeamSeatsEnabled: false })
    expect(featureEnabled(s, 'remoteAccess')).toBe(true)
    expect(featureEnabled(s, 'teamSeats')).toBe(false)
  })

  it('a feature missing from settings entirely reads as on (backward compatible default)', () => {
    const s = { proFeaturesEnabled: true } as ProFeatureSettings
    expect(featureEnabled(s, 'remoteAccess')).toBe(true)
    expect(featureEnabled(s, 'teamSeats')).toBe(true)
  })
})

describe('resolveProFeatures', () => {
  it('resolves every declared feature id, and only declared ids', () => {
    const resolved = resolveProFeatures(settings())
    expect(Object.keys(resolved).sort()).toEqual(PRO_FEATURES.map((f) => f.id).sort())
  })

  it('matches featureEnabled for each id', () => {
    const s = settings({ proFeatureTeamSeatsEnabled: false })
    const resolved = resolveProFeatures(s)
    for (const { id } of PRO_FEATURES) {
      expect(resolved[id]).toBe(featureEnabled(s, id))
    }
  })
})

describe('proFeatureSettingsKey', () => {
  it('names a real settings key present on every settings object for every declared feature', () => {
    const s = settings()
    for (const { id } of PRO_FEATURES) {
      const key = proFeatureSettingsKey(id)
      expect(key in s).toBe(true)
    }
  })

  it('is distinct per feature (no two features silently share one stored choice)', () => {
    const keys = PRO_FEATURES.map((f) => proFeatureSettingsKey(f.id))
    expect(new Set(keys).size).toBe(keys.length)
  })
})
