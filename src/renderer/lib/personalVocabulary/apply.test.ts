import { describe, expect, it } from 'vitest'
import { applyVocabularyToTemplate } from './apply'

describe('applyVocabularyToTemplate', () => {
  it('maps prose segments without rewriting dynamic facts or placeholder keys', () => {
    const entries = {
      Hello: 'Howdy',
      person: 'SHOULD-NOT-APPLY',
      Alice: 'SHOULD-NOT-APPLY-EITHER',
      'docs/personal-vocabulary.md': 'SHOULD-NOT-APPLY-PATH'
    }
    expect(
      applyVocabularyToTemplate('Hello {person}; see {docs}.', entries, {
        person: 'Alice',
        docs: 'docs/personal-vocabulary.md'
      })
    ).toBe('Howdy Alice; see docs/personal-vocabulary.md.')
  })

  it('maps ordinary strings when no dynamic facts are present', () => {
    expect(applyVocabularyToTemplate('Hello Settings', { Hello: 'Howdy', Settings: 'Control Room' })).toBe(
      'Howdy Control Room'
    )
  })
})
