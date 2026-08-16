import { describe, expect, it } from 'vitest'
import { normalizeLanguageMode, t, type Catalog, type LanguageMode } from '.'

const fixture: Catalog = {
  greeting: {
    en: ['English one', 'English two', 'English three', 'English four', 'English five'],
    yue: ['粵語一', '粵語二', '粵語三', '粵語四', '粵語五']
  }
}

describe('language-mode runtime validation', () => {
  it('normalizes every hand-edited unknown value to the English default', () => {
    expect(normalizeLanguageMode('yue')).toBe('yue')
    expect(normalizeLanguageMode('bilingual')).toBe('bilingual')
    expect(normalizeLanguageMode('pirate')).toBe('en')
    expect(normalizeLanguageMode(false)).toBe('en')
    expect(normalizeLanguageMode(null)).toBe('en')
  })

  it('renders a real English result instead of returning undefined for an invalid runtime mode', () => {
    // The cast models settings.json lying to the TypeScript type. This is the mutation tripwire:
    // removing normalization from the resolver makes the exhaustive switch fall through.
    const invalid = 'not-a-language' as LanguageMode
    expect(t('greeting', 'fallback', invalid, { en: 4, yue: 5 }, fixture)).toEqual({
      primary: 'English four',
      secondary: null
    })
  })
})
