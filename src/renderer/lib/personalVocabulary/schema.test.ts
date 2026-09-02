import { describe, expect, it } from 'vitest'
import { scanJson } from './jsonScan'
import { validateVocabularyCachePayload, validateVocabularyPayload, validateVocabularyValue } from './schema'

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
    '{"schemaVersion":1,"__proto__":{"entries":{}}}',
    '{"__proto__":{"schemaVersion":1},"entries":{}}',
    '{"schemaVersion":1,"entries":{},"constructor":"not schema"}',
    '{"schemaVersion":1,"entries":{},"prototype":"not schema"}'
  ])('rejects unsafe top-level ownership tricks: %s', (raw) => {
    const result = validateVocabularyPayload(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/top-level key .* is not allowed/)
  })

  it('requires version and entries to be own properties of a decoded value', () => {
    const inheritedBoth = Object.create({ schemaVersion: 1, entries: {} }) as Record<string, unknown>
    const inheritedEntries = Object.assign(Object.create({ entries: {} }), { schemaVersion: 1 }) as Record<
      string,
      unknown
    >

    expect(validateVocabularyValue(inheritedBoth).ok).toBe(false)
    expect(validateVocabularyValue(inheritedEntries).ok).toBe(false)
  })

  it.each(['__proto__', 'constructor', 'prototype'])('rejects the %s spelling inside entries', (key) => {
    const result = validateVocabularyPayload(
      `{"schemaVersion":1,"entries":{${JSON.stringify(key)}:"must not disappear"}}`
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(`"${key}" is not an allowed key`)
  })

  it('returns a null-prototype dictionary containing only validated own entries', () => {
    const result = validateVocabularyPayload(
      '{"schemaVersion":1,"entries":{"飲茶 🫖":"yum cha","quote\\\"key":"kept"}}'
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.getPrototypeOf(result.entries)).toBeNull()
    expect(Object.keys(result.entries)).toEqual(['飲茶 🫖', 'quote"key'])
    expect(result.entries['飲茶 🫖']).toBe('yum cha')
  })

  it('rejects an empty entries object instead of treating the presence of the field as usable data', () => {
    const result = validateVocabularyPayload('{"schemaVersion":1,"entries":{}}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('at least one pair')
  })

  it('rejects escaped control characters so replacements cannot inject terminal sequences', () => {
    expect(validateVocabularyPayload('{"schemaVersion":1,"entries":{"terminal":"line\\u001b[31m"}}').ok).toBe(false)
    expect(validateVocabularyPayload('{"schemaVersion":1,"entries":{"term\\nkey":"safe"}}').ok).toBe(false)
    expect(validateVocabularyPayload('{"schemaVersion":1,"entries":{"term":"line\\u0085"}}').ok).toBe(false)
    expect(validateVocabularyPayload('{"schemaVersion":1,"entries":{"term":"bidi\\u202evalue"}}').ok).toBe(false)
  })

  it('rejects the legacy version field generically while accepting only schemaVersion', () => {
    const legacy = validateVocabularyPayload('{"version":1,"entries":{"terminal":"shell box"}}')
    expect(legacy.ok).toBe(false)
    if (!legacy.ok) expect(legacy.error).toMatch(/schema version/)
    expect(validateVocabularyPayload('{"schemaVersion":1,"entries":{"terminal":"shell box"}}').ok).toBe(true)
  })

  it('enforces exact portable roots, depth, entry, key, and value bounds', () => {
    expect(validateVocabularyPayload('{"schemaVersion":1,"entries":{"k":{"nested":"value"}}}').ok).toBe(false)
    expect(validateVocabularyPayload(`{"schemaVersion":1,"entries":{"${'k'.repeat(160)}":"${'v'.repeat(1000)}"}}`).ok).toBe(true)
    expect(validateVocabularyPayload(`{"schemaVersion":1,"entries":{"${'k'.repeat(161)}":"ok"}}`).ok).toBe(false)
    expect(validateVocabularyPayload(`{"schemaVersion":1,"entries":{"key":"${'v'.repeat(1001)}"}}`).ok).toBe(false)

    const entries = Object.fromEntries(Array.from({ length: 4096 }, (_, i) => [`key-${i}`, 'value']))
    expect(validateVocabularyPayload(JSON.stringify({ schemaVersion: 1, entries })).ok).toBe(true)
    const tooMany = Object.fromEntries(Array.from({ length: 4097 }, (_, i) => [`key-${i}`, 'value']))
    expect(validateVocabularyPayload(JSON.stringify({ schemaVersion: 1, entries: tooMany })).ok).toBe(false)
  })

  it('validates the persisted cache envelope independently from the upload shape', () => {
    const result = validateVocabularyCachePayload(
      '{"version":1,"entries":{"terminal":"shell box"},"entryCount":1,"savedAt":1700000000000}'
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cache.entryCount).toBe(1)
    expect(result.cache.entries.terminal).toBe('shell box')
  })

  it.each([
    '{"version":1,"entries":{"terminal":"shell box"},"entryCount":2,"savedAt":1700000000000}',
    '{"version":1,"entries":{"terminal":"shell box"},"entryCount":1,"savedAt":1700000000000,"extra":true}',
    '{"version":1,"entries":{},"entryCount":0,"savedAt":1700000000000}'
  ])('rejects malformed persisted cache envelopes: %s', (raw) => {
    expect(validateVocabularyCachePayload(raw).ok).toBe(false)
  })
})
