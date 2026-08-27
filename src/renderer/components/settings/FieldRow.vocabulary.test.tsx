// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { usePersonalVocabulary } from '../../state/personalVocabulary'
import { useSchoolMode } from '../../state/schoolMode'
import { FieldRow } from './FieldRow'
import { SettingsText } from './SettingsText'
import { SettingsVocabularyContext } from './context'

describe('FieldRow personal vocabulary boundary', () => {
  afterEach(() => {
    cleanup()
    usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
    useSchoolMode.setState({ enabled: false, hydrated: false, name: 'School mode' })
  })

  it('maps labels and templates while preserving interpolated facts', () => {
    usePersonalVocabulary.setState({
      entries: { Label: 'Display name', Hello: 'Howdy', Alice: 'Do-not-rewrite' },
      status: 'loaded',
      entryCount: 3,
      loadedAt: Date.now(),
      lastError: null
    })
    useSchoolMode.setState({ enabled: false, hydrated: true })

    render(
      <FieldRow
        label="Label"
        description="Hello {person}"
        descriptionParams={{ person: 'Alice' }}
        control={<button type="button">Save</button>}
      />
    )

    expect(screen.getByText('Display name')).toBeTruthy()
    expect(screen.getByText('Howdy Alice')).toBeTruthy()
    expect(screen.queryByText('Howdy Do-not-rewrite')).toBeNull()
  })

  it('fails closed while the shared mode record is unknown', () => {
    usePersonalVocabulary.setState({
      entries: { Label: 'Display name' },
      status: 'loaded',
      entryCount: 1,
      loadedAt: Date.now(),
      lastError: null
    })
    useSchoolMode.setState({ enabled: false, hydrated: false })

    render(<FieldRow label="Label" control={<button type="button">Save</button>} />)
    expect(screen.getByText('Label')).toBeTruthy()
    expect(screen.queryByText('Display name')).toBeNull()
  })

  it('keeps row mapping active when only section chrome was resolved upstream', () => {
    usePersonalVocabulary.setState({
      entries: { Label: 'Display name' },
      status: 'loaded',
      entryCount: 1,
      loadedAt: Date.now(),
      lastError: null
    })
    useSchoolMode.setState({ enabled: false, hydrated: true })

    render(
      <SettingsVocabularyContext.Provider value={{ source: 'i18n', fields: 'section' }}>
        <FieldRow label="Label" control={<button type="button">Save</button>} />
      </SettingsVocabularyContext.Provider>
    )

    expect(screen.getByText('Display name')).toBeTruthy()
  })

  it('maps authored segments while preserving fact segments', () => {
    usePersonalVocabulary.setState({
      entries: { 'Working directory': 'Work folder' },
      status: 'loaded',
      entryCount: 1,
      loadedAt: Date.now(),
      lastError: null
    })
    useSchoolMode.setState({ enabled: false, hydrated: true })

    render(
      <SettingsText
        segments={[
          { kind: 'copy', value: 'Working directory: ' },
          { kind: 'fact', value: 'C:/user-project' }
        ]}
      />
    )

    expect(screen.getByText('Work folder: C:/user-project')).toBeTruthy()
  })

  it('interpolates facts while School mode suppresses vocabulary', () => {
    usePersonalVocabulary.setState({
      entries: { Hello: 'Howdy' },
      status: 'loaded',
      entryCount: 1,
      loadedAt: Date.now(),
      lastError: null
    })
    useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' })

    render(
      <FieldRow
        label="Label"
        description="Hello {person}"
        descriptionParams={{ person: 'Alice' }}
        control={<button type="button">Save</button>}
      />
    )

    expect(screen.getByText('Hello Alice')).toBeTruthy()
    expect(screen.queryByText('Howdy Alice')).toBeNull()
  })
})
