// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PersonalVocabularySection } from './PersonalVocabularySection'
import { usePersonalVocabulary } from '../../../state/personalVocabulary'
import { useSchoolMode } from '../../../state/schoolMode'

afterEach(() => {
  cleanup()
  usePersonalVocabulary.setState({
    entries: {},
    status: 'no-file',
    entryCount: 0,
    loadedAt: null,
    lastError: null
  })
  useSchoolMode.setState({ enabled: false, hydrated: false, name: 'School mode' })
})

describe('PersonalVocabularySection native upload boundary', () => {
  it('maps the upload input accessible name after a confirmed School-mode-off state', () => {
    useSchoolMode.setState({ enabled: false, hydrated: true })
    usePersonalVocabulary.setState({
      status: 'loaded',
      entries: { Choose: 'Pick' },
      entryCount: 1,
      loadedAt: Date.now(),
      lastError: null
    })

    render(<PersonalVocabularySection isActive />)

    expect(screen.getByLabelText('Pick a personal vocabulary JSON file')).toBeTruthy()
    expect(screen.queryByLabelText('Choose a personal vocabulary JSON file')).toBeNull()
    expect(screen.getByLabelText('Pick a personal vocabulary JSON file').getAttribute('accept')).toBe(
      'application/json,.json'
    )
  })

  it('maps app-authored upload copy while preserving numeric limits and documentation paths', () => {
    useSchoolMode.setState({ enabled: false, hydrated: true })
    usePersonalVocabulary.setState({
      status: 'loaded',
      entries: {
        Personal: 'Private',
        Local: 'Machine',
        Upload: 'Bring',
        Choose: 'Pick',
        Replace: 'Bring again',
        Clear: 'Erase',
        '256': 'MUST-NOT-REPLACE',
        '4,096': 'MUST-NOT-REPLACE'
      },
      entryCount: 7,
      loadedAt: Date.now(),
      lastError: null
    })

    render(<PersonalVocabularySection isActive />)

    expect(screen.getByRole('heading', { name: 'Private vocabulary' })).toBeTruthy()
    expect(screen.getByText('Machine vocabulary file')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bring again file' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Erase' })).toBeTruthy()
    expect(screen.getByText(/Bring a small JSON file/)).toBeTruthy()
    expect(screen.getByText(/4,096 entries/)).toBeTruthy()
    expect(screen.getByText(/256 KB file size/)).toBeTruthy()
    expect(screen.getByText(/docs\/personal-vocabulary\.md/)).toBeTruthy()
  })

  it('maps the rejection prefix without rewriting an exact validator fact', () => {
    useSchoolMode.setState({ enabled: false, hydrated: true })
    usePersonalVocabulary.setState({
      status: 'invalid',
      entries: { Rejected: 'Declined', path: 'MUST-NOT-REPLACE' },
      entryCount: 0,
      loadedAt: null,
      lastError: 'path C:\\work\\input.json did not match the expected format'
    })

    render(<PersonalVocabularySection isActive />)

    expect(screen.getByRole('alert').textContent).toBe(
      'Declined: path C:\\work\\input.json did not match the expected format'
    )
  })

  it('omits the complete section while School mode is on or unresolved', () => {
    usePersonalVocabulary.setState({
      status: 'loaded',
      entries: { Personal: 'Private' },
      entryCount: 1,
      loadedAt: Date.now(),
      lastError: null
    })
    useSchoolMode.setState({ enabled: true, hydrated: true })
    const { rerender } = render(<PersonalVocabularySection isActive />)
    expect(screen.queryByLabelText(/vocabulary JSON file/i)).toBeNull()

    useSchoolMode.setState({ enabled: false, hydrated: false })
    rerender(<PersonalVocabularySection isActive />)
    expect(screen.queryByLabelText(/vocabulary JSON file/i)).toBeNull()
  })
})
