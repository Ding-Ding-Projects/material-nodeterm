import { describe, it, expect } from 'vitest'
import { decodeWslText, wslLines, hasControlCharacter, printableWslText } from './text'
import { utf16leFixture, utf8Fixture } from './__fixtures__'

describe('decodeWslText', () => {
  it('decodes real UTF-16LE output with a BOM, NUL bytes and all', () => {
    const raw = utf16leFixture('Ubuntu\r\ndocker-desktop\r\n')
    expect(decodeWslText(raw)).toBe('Ubuntu\r\ndocker-desktop\r\n')
  })

  it('decodes UTF-16LE without a BOM by sniffing the NUL density', () => {
    const raw = Buffer.from('Ubuntu\r\n', 'utf16le')
    expect(decodeWslText(raw)).toBe('Ubuntu\r\n')
  })

  it('decodes plain UTF-8 output with no BOM', () => {
    const raw = utf8Fixture('MemTotal:       16384000 kB\n')
    expect(decodeWslText(raw)).toBe('MemTotal:       16384000 kB\n')
  })

  it('decodes a UTF-8 BOM-prefixed buffer', () => {
    const raw = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hello', 'utf8')])
    expect(decodeWslText(raw)).toBe('hello')
  })

  it('returns an empty string for an empty buffer', () => {
    expect(decodeWslText(Buffer.alloc(0))).toBe('')
  })

  it('throws on truncated UTF-16 (odd byte count after the BOM)', () => {
    const raw = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from([0x41, 0x00, 0x42])])
    expect(() => decodeWslText(raw)).toThrow(/truncated/i)
  })

  it('throws when the decoded text contains the Unicode replacement character', () => {
    const raw = Buffer.from([0xff, 0xfd])
    expect(() => decodeWslText(raw)).toThrow(/could not be decoded/i)
  })

  it('throws when decoded text still contains a NUL character', () => {
    // A real embedded NUL byte inside otherwise-plain UTF-8 text: the sniff correctly picks UTF-8
    // here (no BOM, no UTF-16-shaped NUL density), and the NUL survives decoding, so it must be
    // caught explicitly rather than silently dropped.
    const raw = Buffer.from('abc\0def', 'utf8')
    expect(() => decodeWslText(raw)).toThrow(/NUL character/i)
  })
})

describe('wslLines', () => {
  it('splits on CRLF, LF, and bare CR, dropping empty lines', () => {
    expect(wslLines('a\r\nb\nc\rd\r\n\r\ne')).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('returns an empty array for an empty string', () => {
    expect(wslLines('')).toEqual([])
  })
})

describe('hasControlCharacter', () => {
  it('detects a NUL, an ESC, and DEL', () => {
    expect(hasControlCharacter('abc\x00')).toBe(true)
    expect(hasControlCharacter('abc\x1bdef')).toBe(true)
    expect(hasControlCharacter('abc\x7f')).toBe(true)
  })

  it('is false for ordinary printable text', () => {
    expect(hasControlCharacter('Ubuntu-22.04')).toBe(false)
  })
})

describe('printableWslText', () => {
  it('replaces control characters with a space and collapses whitespace', () => {
    expect(printableWslText('a\x00b\x1b\x1bc')).toBe('a b c')
  })

  it('truncates long values with an ellipsis marker', () => {
    const long = 'x'.repeat(300)
    const result = printableWslText(long, 20)
    expect(result.length).toBe(20)
    expect(result.endsWith('...')).toBe(true)
  })

  it('leaves short, clean text untouched', () => {
    expect(printableWslText('Ubuntu')).toBe('Ubuntu')
  })
})
