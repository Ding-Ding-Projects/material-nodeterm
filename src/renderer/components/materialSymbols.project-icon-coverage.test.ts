import { describe, it, expect } from 'vitest'
import { PROJECT_SYMBOL_IDS } from '@shared/project-icon'
import { MATERIAL_SYMBOLS } from './materialSymbols.generated'

/**
 * `ProjectGlyph.tsx` carries a compile-time assertion that every id in `PROJECT_SYMBOL_IDS` is a
 * real key of the generated codepoint map. This is the runtime companion: it catches the same
 * drift even if that type-level check is ever weakened or worked around, and it prints the exact
 * offending name (a compile error names a type, not a value).
 */
describe('PROJECT_SYMBOL_IDS is a real subset of the bundled Material Symbols font', () => {
  it('every curated project-icon id has a glyph in the subsetted font', () => {
    const missing = PROJECT_SYMBOL_IDS.filter(
      (id) => !Object.prototype.hasOwnProperty.call(MATERIAL_SYMBOLS, id)
    )
    expect(missing).toEqual([])
  })
})
