// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { formatHostMessage, hostFact, hostText, mapLocalVocabularyText, mapNativeNotification, readLocalVocabularyEntries, setHostVocabularySchoolState } from './hostMessage'
import { useSchoolMode } from '../../state/schoolMode'
import { widgetTerminalMarker } from '../../widget/widgetVocabulary'

describe('host-authored vocabulary boundaries', () => {
  beforeEach(() => {
    localStorage.clear()
    useSchoolMode.setState({ enabled: false, hydrated: false })
    setHostVocabularySchoolState({ enabled: false, hydrated: false })
  })

  it('maps authored template parts while preserving dynamic facts byte-for-byte', () => {
    const out = formatHostMessage(
      [hostText('Could not open '), hostFact('C:/workspace/project'), hostText(' in the browser.')],
      (text) => text.replace('browser', 'shell box')
    )

    expect(out).toBe('Could not open C:/workspace/project in the shell box.')
  })

  it('maps only authored native notification fields and preserves payload metadata', () => {
    const map = (text: string): string => text.replace('terminal', 'shell box')
    const authored = mapNativeNotification({
      title: 'Open terminal',
      body: 'Retry terminal now',
      titleKind: 'authored' as const,
      bodyKind: 'authored' as const,
      nodeId: 'node-7',
      force: true
    }, map)
    expect(authored).toEqual({
      title: 'Open shell box',
      body: 'Retry shell box now',
      titleKind: 'authored',
      bodyKind: 'authored',
      nodeId: 'node-7',
      force: true
    })

    const fact = mapNativeNotification({
      title: 'terminal exited with code 1',
      body: 'C:/workspace/terminal',
      titleKind: 'fact' as const,
      bodyKind: 'fact' as const,
      nodeId: 'node-7'
    }, map)
    expect(fact.title).toBe('terminal exited with code 1')
    expect(fact.body).toBe('C:/workspace/terminal')
    expect(fact.nodeId).toBe('node-7')
  })

  it('reads only a validated, fresh cache for non-React entrypoints', () => {
    localStorage.setItem(
      'nodeterm.personalVocabulary.v1',
      JSON.stringify({ version: 1, entries: { Reconnecting: 'Tea reconnecting' }, entryCount: 1, savedAt: Date.now() })
    )
    useSchoolMode.setState({ enabled: false, hydrated: true })
    expect(readLocalVocabularyEntries().Reconnecting).toBe('Tea reconnecting')
    expect(mapLocalVocabularyText('Reconnecting…')).toBe('Tea reconnecting…')
  })

  it('fails closed for an upload-shaped object with persistence metadata missing', () => {
    localStorage.setItem(
      'nodeterm.personalVocabulary.v1',
      JSON.stringify({ version: 1, entries: { Reconnecting: 'Tea reconnecting' } })
    )
    expect(mapLocalVocabularyText('Reconnecting…')).toBe('Reconnecting…')
  })

  it('fails closed until School state is hydrated and reacts live when it changes', () => {
    localStorage.setItem(
      'nodeterm.personalVocabulary.v1',
      JSON.stringify({ version: 1, entries: { Reconnecting: 'Tea reconnecting' }, entryCount: 1, savedAt: Date.now() })
    )
    expect(mapLocalVocabularyText('Reconnecting…')).toBe('Reconnecting…')

    useSchoolMode.setState({ enabled: true, hydrated: true })
    expect(mapLocalVocabularyText('Reconnecting…')).toBe('Reconnecting…')

    useSchoolMode.setState({ enabled: false, hydrated: true })
    expect(mapLocalVocabularyText('Reconnecting…')).toBe('Tea reconnecting…')

    useSchoolMode.setState({ enabled: true, hydrated: true })
    expect(mapLocalVocabularyText('Reconnecting…')).toBe('Reconnecting…')
  })

  it('rejects stale, future, and boundary-invalid savedAt values', () => {
    const now = Date.now()
    const values = [now - 31 * 24 * 60 * 60 * 1000, now + 24 * 60 * 60 * 1000, 0]
    for (const savedAt of values) {
      localStorage.setItem(
        'nodeterm.personalVocabulary.v1',
        JSON.stringify({ version: 1, entries: { terminal: 'shell box' }, entryCount: 1, savedAt })
      )
      useSchoolMode.setState({ enabled: false, hydrated: true })
      expect(mapLocalVocabularyText('terminal')).toBe('terminal')
    }
  })

  it('carries a cached upload through the widget marker boundary without terminal control bytes', () => {
    const uploaded = JSON.stringify({ version: 1, entries: { 'session ended': 'tea time' }, entryCount: 1, savedAt: Date.now() })
    localStorage.setItem('nodeterm.personalVocabulary.v1', uploaded)
    useSchoolMode.setState({ enabled: false, hydrated: true })
    const marker = widgetTerminalMarker('session ended', mapLocalVocabularyText)
    expect(marker).toBe('tea time')
    expect(marker).not.toContain('\u001b')
  })
})
