import { describe, it, expect } from 'vitest'
import { sanitizeProjectIcon, PROJECT_SYMBOL_IDS } from './project-icon'

describe('sanitizeProjectIcon: kept', () => {
  it('keeps a valid emoji icon', () => {
    expect(sanitizeProjectIcon({ type: 'emoji', emoji: '🚀' })).toEqual({ type: 'emoji', emoji: '🚀' })
  })
  it('keeps a 16-code-unit emoji (boundary)', () => {
    const emoji = 'x'.repeat(16)
    expect(sanitizeProjectIcon({ type: 'emoji', emoji })).toEqual({ type: 'emoji', emoji })
  })
  it('keeps a known material-symbol id', () => {
    expect(sanitizeProjectIcon({ type: 'material-symbol', name: 'terminal' }))
      .toEqual({ type: 'material-symbol', name: 'terminal' })
  })
})

describe('sanitizeProjectIcon: rejected (never throws, degrades to undefined)', () => {
  it('rejects non-object input', () => {
    expect(sanitizeProjectIcon(null)).toBeUndefined()
    expect(sanitizeProjectIcon(undefined)).toBeUndefined()
    expect(sanitizeProjectIcon('rocket')).toBeUndefined()
    expect(sanitizeProjectIcon(42)).toBeUndefined()
    expect(sanitizeProjectIcon([])).toBeUndefined()
  })
  it('rejects an unknown type', () => {
    expect(sanitizeProjectIcon({ type: 'image', src: 'data:image/png;base64,AA==' })).toBeUndefined()
    expect(sanitizeProjectIcon({ type: 'lucide', name: 'folder' })).toBeUndefined()
    expect(sanitizeProjectIcon({})).toBeUndefined()
  })
  it('rejects a 17-code-unit emoji', () => {
    expect(sanitizeProjectIcon({ type: 'emoji', emoji: 'x'.repeat(17) })).toBeUndefined()
  })
  it('rejects an empty emoji', () => {
    expect(sanitizeProjectIcon({ type: 'emoji', emoji: '' })).toBeUndefined()
  })
  it('rejects a non-string emoji', () => {
    expect(sanitizeProjectIcon({ type: 'emoji', emoji: 7 })).toBeUndefined()
  })
  it('rejects an unknown material-symbol id', () => {
    expect(sanitizeProjectIcon({ type: 'material-symbol', name: 'not-a-real-icon' })).toBeUndefined()
  })
  it('rejects a non-string material-symbol name', () => {
    expect(sanitizeProjectIcon({ type: 'material-symbol', name: 123 })).toBeUndefined()
  })
})

describe('PROJECT_SYMBOL_IDS', () => {
  it('is a non-empty curated list with no duplicates', () => {
    expect(PROJECT_SYMBOL_IDS.length).toBeGreaterThan(0)
    expect(new Set(PROJECT_SYMBOL_IDS).size).toBe(PROJECT_SYMBOL_IDS.length)
  })
})
