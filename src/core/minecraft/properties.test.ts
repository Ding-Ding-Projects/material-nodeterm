import { describe, expect, it } from 'vitest'
import { applyPropertyUpdates, fieldSpec, parseProperties, propertiesToRecord } from './properties'

const RAW = [
  '#Minecraft server properties',
  '#Wed Aug 20 00:00:00 UTC 2026',
  'max-players=20',
  'motd=A Minecraft Server',
  '',
  'pvp=true'
].join('\n')

describe('parseProperties / propertiesToRecord', () => {
  it('reads every key=value pair into a flat map', () => {
    const record = propertiesToRecord(parseProperties(RAW))
    expect(record).toEqual({ 'max-players': '20', motd: 'A Minecraft Server', pvp: 'true' })
  })

  it('parses an empty document without throwing', () => {
    expect(propertiesToRecord(parseProperties(''))).toEqual({})
  })
})

describe('applyPropertyUpdates', () => {
  it('edits an existing key in place, preserving every other line exactly', () => {
    const out = applyPropertyUpdates(RAW, { 'max-players': '8' })
    expect(out.split('\n')).toEqual([
      '#Minecraft server properties',
      '#Wed Aug 20 00:00:00 UTC 2026',
      'max-players=8',
      'motd=A Minecraft Server',
      '',
      'pvp=true'
    ])
  })

  it('appends a key that did not previously exist', () => {
    const out = applyPropertyUpdates(RAW, { difficulty: 'hard' })
    expect(out.endsWith('\ndifficulty=hard')).toBe(true)
    // and nothing existing moved
    expect(out.startsWith(RAW)).toBe(true)
  })

  it('starts a fresh file from nothing when the raw text is empty', () => {
    const out = applyPropertyUpdates('', { motd: 'hi' })
    expect(out).toBe('motd=hi')
  })

  it('never touches a line it was not asked to update', () => {
    const out = applyPropertyUpdates(RAW, { motd: 'Changed' })
    expect(out).toContain('max-players=20')
    expect(out).toContain('pvp=true')
    expect(out).toContain('motd=Changed')
    expect(out).not.toContain('A Minecraft Server')
  })
})

describe('fieldSpec', () => {
  it('finds a known managed field', () => {
    expect(fieldSpec('gamemode')?.kind).toBe('enum')
    expect(fieldSpec('max-players')?.kind).toBe('integer')
  })

  it('returns undefined for a key it does not manage a typed control for', () => {
    expect(fieldSpec('nonexistent-key-nobody-uses')).toBeUndefined()
  })
})
