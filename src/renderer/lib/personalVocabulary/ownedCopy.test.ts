import { describe, expect, it } from 'vitest'
import { applyVocabulary } from './apply'
import { copy, fact, mapOwnedSentence } from './ownedCopy'

describe('typed vocabulary copy and fact boundary', () => {
  const map = (text: string): string => applyVocabulary(text, {
    Download: 'Beam',
    model: 'machine',
    error: 'oops'
  })

  it('maps application copy while preserving an exact fact in a mixed sentence', () => {
    expect(mapOwnedSentence(map, [copy('Download '), fact('model/error'), copy(' now')])).toBe(
      'Beam model/error now'
    )
  })

  it('keeps diagnostics and identifiers byte-identical even when they contain vocabulary terms', () => {
    const diagnostic = 'model: error at C:/Download/model'
    expect(mapOwnedSentence(map, [copy('Diagnostic: '), fact(diagnostic)])).toBe(
      `Diagnostic: ${diagnostic}`
    )
  })

  it('maps a copy segment once and never applies the mapper again to its result', () => {
    let calls = 0
    const once = (text: string): string => {
      calls += 1
      return map(text)
    }
    expect(mapOwnedSentence(once, [copy('model'), fact('/error')])).toBe('machine/error')
    expect(calls).toBe(1)
  })

  it('detects a copy and fact swap by keeping the exact visible query value', () => {
    const query = 'Download/model'
    expect(mapOwnedSentence(map, [copy('Filter: '), fact(query)])).toBe(`Filter: ${query}`)
    expect(mapOwnedSentence(map, [fact('Filter: '), copy(query)])).toBe('Filter: Beam/machine')
  })

  it('keeps diagnostic signatures and numeric values exact', () => {
    const signature = 'application/octet-stream: error at offset 256'
    const count = 256
    expect(mapOwnedSentence(map, [copy('Diagnostic: '), fact(signature)])).toBe(`Diagnostic: ${signature}`)
    expect(mapOwnedSentence(map, [copy('Showing '), fact(String(count)), copy(' records')])).toBe(
      'Showing 256 records'
    )
  })
})
