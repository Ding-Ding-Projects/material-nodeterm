import { describe, expect, it } from 'vitest'
import { buildProvenanceLine, formatBuildTime, readBuildProvenance } from './build-provenance'

const STAMP = { builtAt: '2026-08-25T04:05:06.000Z', commit: 'abc1234def' }

describe('build provenance', () => {
  it('reads a well-formed stamp', () => {
    const p = readBuildProvenance('0.4.98', STAMP)
    expect(p.available).toBe(true)
    if (!p.available) throw new Error('unreachable')
    expect(p.version).toBe('0.4.98')
    expect(p.builtAt.toISOString()).toBe('2026-08-25T04:05:06.000Z')
    expect(p.commit).toBe('abc1234def')
  })

  it('is unavailable, with a reason, when nothing was stamped', () => {
    // The dev-server case, and the honest one: no stamp means no build time, never today's date.
    const p = readBuildProvenance('0.0.0', undefined)
    expect(p.available).toBe(false)
    if (p.available) throw new Error('unreachable')
    expect(p.reason).toContain('no build stamp')
  })

  it('refuses a malformed date as firmly as a missing one', () => {
    // `new Date('nonsense')` renders as the literal text "Invalid Date" in most formatters, which
    // is a worse outcome than saying the build time is unknown.
    const p = readBuildProvenance('1.0.0', { builtAt: 'nonsense', commit: 'x' })
    expect(p.available).toBe(false)
    if (p.available) throw new Error('unreachable')
    expect(p.reason).toContain('not a valid date')
  })

  it('refuses a stamp with no time at all', () => {
    expect(readBuildProvenance('1.0.0', { commit: 'x' }).available).toBe(false)
    expect(readBuildProvenance('1.0.0', { builtAt: '', commit: 'x' }).available).toBe(false)
    expect(readBuildProvenance('1.0.0', 'not-an-object').available).toBe(false)
  })

  it('prefers the STAMPED version over the runtime one', () => {
    // Measured before this existed: an unpackaged run showed "v42.8.1", which is ELECTRON's
    // version, because that is what `app.getVersion()` returns outside a packaged build.
    const p = readBuildProvenance('42.8.1', { ...STAMP, version: '0.4.98' })
    expect(p.version).toBe('0.4.98')
  })

  it('falls back to the runtime version when the stamp carries none', () => {
    const p = readBuildProvenance('0.4.98', STAMP)
    expect(p.version).toBe('0.4.98')
  })

  it('keeps the stamped version even when the build TIME is unusable', () => {
    const p = readBuildProvenance('42.8.1', { builtAt: 'nonsense', version: '0.4.98' })
    expect(p.available).toBe(false)
    expect(p.version).toBe('0.4.98')
  })

  it('accepts a stamp with no commit, because the TIME is the load-bearing half', () => {
    // A tarball with no .git is a legitimate way to build this.
    const p = readBuildProvenance('1.0.0', { builtAt: STAMP.builtAt })
    expect(p.available).toBe(true)
    if (!p.available) throw new Error('unreachable')
    expect(p.commit).toBe('unknown')
  })

  it('names the timezone and shows seconds', () => {
    // Seconds because two builds a minute apart are routine while bisecting; the zone because a
    // bare local time is ambiguous the moment the line is pasted into an issue.
    const text = formatBuildTime(new Date(STAMP.builtAt), { locale: 'en-GB', timeZone: 'UTC' })
    expect(text).toMatch(/04:05:06/)
    expect(text).toMatch(/UTC/)
  })

  it('renders the same instant differently per timezone, which is the point of naming it', () => {
    const utc = formatBuildTime(new Date(STAMP.builtAt), { locale: 'en-GB', timeZone: 'UTC' })
    const tokyo = formatBuildTime(new Date(STAMP.builtAt), { locale: 'en-GB', timeZone: 'Asia/Tokyo' })
    expect(utc).not.toBe(tokyo)
    expect(tokyo).toMatch(/13:05:06/)
  })

  it('keeps the version in the line even when the build time is unknown', () => {
    // Half the answer is available and certain; throwing it away to say only "unavailable" would
    // make the line useless in exactly the case somebody is trying to diagnose.
    const line = buildProvenanceLine(readBuildProvenance('0.4.98', undefined))
    expect(line).toContain('v0.4.98')
    expect(line).toContain('build time')
  })

  it('reads as one short line on a front screen', () => {
    const line = buildProvenanceLine(readBuildProvenance('0.4.98', STAMP), {
      locale: 'en-GB',
      timeZone: 'UTC'
    })
    expect(line.startsWith('v0.4.98 · built ')).toBe(true)
    expect(line).not.toContain('\n')
  })
})
