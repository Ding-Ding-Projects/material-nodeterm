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
