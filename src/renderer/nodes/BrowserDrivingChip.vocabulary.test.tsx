// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BrowserDrivingChip } from './BrowserDrivingChip'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
  useSchoolMode.setState({ enabled: false, hydrated: true })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
  useSchoolMode.setState({ enabled: false, hydrated: false })
})

describe('browser driving indicator vocabulary boundary', () => {
  it('maps authored status and action copy while preserving the verified owner title', () => {
    usePersonalVocabulary.setState({
      entries: {
        ' is driving': ' controls this surface',
        Stop: 'End',
        'Stop agent control of this browser node': 'End control'
      },
      status: 'loaded',
      entryCount: 3,
      loadedAt: Date.now(),
      lastError: null
    })
    act(() => root.render(<BrowserDrivingChip ownerTitle="Owner title 7" onStop={() => {}} />))
    expect(host.querySelector('.browser-driving__label')?.textContent).toBe('Owner title 7 controls this surface')
    const button = host.querySelector('button')
    expect(button?.textContent).toBe('End')
    expect(button?.getAttribute('title')).toBe('End control')
  })
})
