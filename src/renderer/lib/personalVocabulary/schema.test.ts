import { describe, expect, it } from 'vitest'
import { scanJson } from './jsonScan'
import { validateVocabularyPayload, validateVocabularyValue } from './schema'

describe('personal vocabulary object ownership', () => {
  it('parses every JSON key as own data on a null-prototype object', () => {
    const result = scanJson('{"__proto__":{"polluted":true},"constructor":"still data"}', {
      maxDepth: 3,
      maxNodes: 20
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const value = result.value as Record<string, unknown>
    expect(Object.getPrototypeOf(value)).toBeNull()
    expect(Object.hasOwn(value, '__proto__')).toBe(true)
    expect(Object.hasOwn(value, 'constructor')).toBe(true)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it.each([
    '{"version":1,"__proto__":{"entries":{}}}',
    '{"__proto__":{"version":1},"entries":{}}',
    '{"version":1,"entries":{},"constructor":"not schema"}',
    '{"version":1,"entries":{},"prototype":"not schema"}'
  ])('rejects unsafe top-level ownership tricks: %s', (raw) => {
    const result = validateVocabularyPayload(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/top-level key .* is not allowed/)
  })

  it('requires version and entries to be own properties of a decoded value', () => {
    const inheritedBoth = Object.create({ version: 1, entries: {} }) as Record<string, unknown>
    const inheritedEntries = Object.assign(Object.create({ entries: {} }), { version: 1 }) as Record<
      string,
      unknown
    >

    expect(validateVocabularyValue(inheritedBoth).ok).toBe(false)
    expect(validateVocabularyValue(inheritedEntries).ok).toBe(false)
  })

  it.each(['__proto__', 'constructor', 'prototype'])('rejects the %s spelling inside entries', (key) => {
    const result = validateVocabularyPayload(
      `{"version":1,"entries":{${JSON.stringify(key)}:"must not disappear"}}`
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(`"${key}" is not an allowed key`)
  })

  it('returns a null-prototype dictionary containing only validated own entries', () => {
    const result = validateVocabularyPayload(
      '{"version":1,"entries":{"飲茶 🫖":"yum cha","quote\\\"key":"kept"}}'
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.getPrototypeOf(result.entries)).toBeNull()
    expect(Object.keys(result.entries)).toEqual(['飲茶 🫖', 'quote"key'])
    expect(result.entries['飲茶 🫖']).toBe('yum cha')
  })
})
