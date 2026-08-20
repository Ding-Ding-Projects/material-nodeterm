import { describe, expect, it } from 'vitest'
import { parseBannedEntries, parsePlayerEntries } from './players'

describe('parsePlayerEntries', () => {
  it('reads real whitelist.json / ops.json shape', () => {
    const raw = [
      { uuid: 'aaa', name: 'Steve', level: 4, bypassesPlayerLimit: false },
      { uuid: 'bbb', name: 'Alex' }
    ]
    expect(parsePlayerEntries(raw)).toEqual([
      { name: 'Steve', uuid: 'aaa' },
      { name: 'Alex', uuid: 'bbb' }
    ])
  })

  it('degrades to an empty list rather than throwing on anything unexpected', () => {
    expect(parsePlayerEntries(undefined)).toEqual([])
    expect(parsePlayerEntries(null)).toEqual([])
    expect(parsePlayerEntries('not an array')).toEqual([])
    expect(parsePlayerEntries({})).toEqual([])
  })

  it('skips one malformed entry without denying the rest of the list', () => {
    const raw = [{ uuid: 'aaa', name: 'Steve' }, null, { uuid: 'only-uuid' }, { name: 'only-name' }, 42]
    expect(parsePlayerEntries(raw)).toEqual([{ name: 'Steve', uuid: 'aaa' }])
  })
})

describe('parseBannedEntries', () => {
  it('reads real banned-players.json shape including reason/expires', () => {
    const raw = [
      {
        uuid: 'aaa',
        name: 'Griefer',
        created: '2026-08-20 00:00:00 +0000',
        source: 'Server',
        expires: 'forever',
        reason: 'Griefing'
      }
    ]
    expect(parseBannedEntries(raw)).toEqual([
      { name: 'Griefer', uuid: 'aaa', reason: 'Griefing', expires: 'forever' }
    ])
  })

  it('reports a missing reason/expires as null, never an empty string it did not observe', () => {
    const raw = [{ uuid: 'aaa', name: 'Griefer' }]
    expect(parseBannedEntries(raw)).toEqual([{ name: 'Griefer', uuid: 'aaa', reason: null, expires: null }])
  })

  it('degrades to an empty list on malformed input', () => {
    expect(parseBannedEntries(undefined)).toEqual([])
    expect(parseBannedEntries('nope')).toEqual([])
  })
})
