// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'
import { Button } from './Button'
import { Select } from './Select'

describe('shared control vocabulary intent', () => {
  afterEach(() => {
    cleanup()
    usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
    useSchoolMode.setState({ enabled: false, hydrated: false, name: 'School mode' })
  })

  it('maps authored button prose while allowing factual control text to remain exact', () => {
    usePersonalVocabulary.setState({
      entries: { Save: 'Store', 'account-7': 'WRONG' },
      status: 'loaded',
      entryCount: 2,
      loadedAt: Date.now(),
      lastError: null
    })
    useSchoolMode.setState({ enabled: false, hydrated: true })
    render(
      <>
        <Button>Save</Button>
        <Button vocabularyMode="factual">account-7</Button>
      </>
    )
    expect(screen.getByRole('button', { name: 'Store' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'account-7' })).toBeTruthy()
  })

  it('maps option prose without changing persisted option values', () => {
    usePersonalVocabulary.setState({
      entries: { Dark: 'Night mode' },
      status: 'loaded',
      entryCount: 1,
      loadedAt: Date.now(),
      lastError: null
    })
    useSchoolMode.setState({ enabled: false, hydrated: true })
    render(
      <Select aria-label="Theme">
        <option value="dark">Dark</option>
      </Select>
    )
    const option = screen.getByRole('option', { name: 'Night mode' }) as HTMLOptionElement
    expect(option.value).toBe('dark')
  })
})
