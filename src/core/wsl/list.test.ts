import { describe, it, expect } from 'vitest'
import { parseWslVerboseList } from './list'
import { VERBOSE_LIST_FIXTURE, utf16leFixture } from './__fixtures__'

describe('parseWslVerboseList', () => {
  it('parses a real UTF-16 fixture into default/state/version rows, docker-desktop included', () => {
    const rows = parseWslVerboseList(VERBOSE_LIST_FIXTURE.stdout)
    expect(rows).toEqual([
      { name: 'Ubuntu', state: 'running', isDefault: true, version: 2 },
      { name: 'docker-desktop', state: 'stopped', isDefault: false, version: 2 },
      { name: 'my-old-distro', state: 'stopped', isDefault: false, version: 1 }
    ])
  })

  it('returns an empty list for empty output', () => {
    expect(parseWslVerboseList(Buffer.alloc(0))).toEqual([])
  })

  it('handles a single distribution with no default marker', () => {
    const raw = utf16leFixture(
      ['  NAME              STATE           VERSION', '  Debian            Running         2'].join('\r\n') + '\r\n'
    )
    expect(parseWslVerboseList(raw)).toEqual([
      { name: 'Debian', state: 'running', isDefault: false, version: 2 }
    ])
  })

  it('reports an unparseable version column as null rather than guessing', () => {
    const raw = utf16leFixture(
      ['  NAME              STATE           VERSION', '  Weird             Running         ???'].join('\r\n') + '\r\n'
    )
    expect(parseWslVerboseList(raw)).toEqual([
      { name: 'Weird', state: 'running', isDefault: false, version: null }
    ])
  })

  it('throws when the header row is missing entirely', () => {
    const raw = utf16leFixture('Ubuntu   Running   2\r\n')
    expect(() => parseWslVerboseList(raw)).toThrow(/header/i)
  })

  it('throws on more than one default marker', () => {
    const raw = utf16leFixture(
      [
        '  NAME              STATE           VERSION',
        '* Ubuntu            Running         2',
        '* Debian            Stopped         1'
      ].join('\r\n') + '\r\n'
    )
    expect(() => parseWslVerboseList(raw)).toThrow(/more than one/i)
  })

  it('throws on a row with an unrecognized state instead of guessing running or stopped', () => {
    const raw = utf16leFixture(
      ['  NAME              STATE           VERSION', '  Ubuntu            Paused          2'].join('\r\n') + '\r\n'
    )
    expect(() => parseWslVerboseList(raw)).toThrow(/unrecognized state/i)
  })

  it('throws on duplicate names differing only by case', () => {
    const raw = utf16leFixture(
      [
        '  NAME              STATE           VERSION',
        '  Ubuntu            Running         2',
        '  ubuntu            Stopped         2'
      ].join('\r\n') + '\r\n'
    )
    expect(() => parseWslVerboseList(raw)).toThrow(/duplicate/i)
  })

  it('treats Installing and Uninstalling as a coarse stopped state without lying that they are running', () => {
    const raw = utf16leFixture(
      ['  NAME              STATE           VERSION', '  Fresh             Installing      2'].join('\r\n') + '\r\n'
    )
    expect(parseWslVerboseList(raw)).toEqual([
      { name: 'Fresh', state: 'stopped', isDefault: false, version: 2 }
    ])
  })
})
