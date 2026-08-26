// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'
import { BrowserStartPage } from './BrowserStartPage'
import { DiscardedPlate } from './DiscardedPlate'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  useSchoolMode.setState({ enabled: false, hydrated: true })
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('node renderer personal vocabulary boundaries', () => {
  it('maps BrowserStartPage prose while preserving the navigated URL', () => {
    usePersonalVocabulary.setState({
      entries: { 'Search Google or type a URL': 'Find something or enter a URL' },
      status: 'loaded',
      entryCount: 1,
      loadedAt: Date.now(),
      lastError: null
    })
    act(() => root.render(<BrowserStartPage onNavigate={() => {}} />))
    expect(host.querySelector('input')?.getAttribute('placeholder')).toBe('Find something or enter a URL')
  })

  it('maps the released and reopening status plate', () => {
    usePersonalVocabulary.setState({
      entries: { 'Reopening…': 'Opening again…' },
      status: 'loaded',
      entryCount: 1,
      loadedAt: Date.now(),
      lastError: null
    })
    act(() => root.render(<DiscardedPlate restoring />))
    expect(host.textContent).toContain('Opening again…')
  })

  it('suppresses the mapper while School mode is enabled', () => {
    usePersonalVocabulary.setState({
      entries: { 'Reopening…': 'Opening again…' },
      status: 'loaded',
      entryCount: 1,
      loadedAt: Date.now(),
      lastError: null
    })
    act(() => useSchoolMode.setState({ enabled: true, hydrated: true }))
    act(() => root.render(<DiscardedPlate restoring />))
    expect(host.textContent).toContain('Reopening…')
    expect(host.textContent).not.toContain('Opening again…')
  })
})
