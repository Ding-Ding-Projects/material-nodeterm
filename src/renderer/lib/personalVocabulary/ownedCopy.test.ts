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
})
