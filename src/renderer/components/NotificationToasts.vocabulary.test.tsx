// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { NotificationToasts } from './NotificationToasts'
import { useNotifications } from '../state/notifications'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  useNotifications.setState({ items: [] })
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0 })
  useSchoolMode.setState({ enabled: false, hydrated: false })
})

function render(): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(<NotificationToasts />))
}

describe('NotificationToasts personal vocabulary', () => {
  it('replaces the app’s own prose but never the machine text in `body`', () => {
    usePersonalVocabulary.setState({
      status: 'loaded',
      // "terminal" is the app's own word; "fatal:" is how git starts an error line.
      entries: { terminal: 'shell box', 'fatal:': 'oh no:', Retry: 'Go again' },
      entryCount: 3
    })
    useSchoolMode.setState({ enabled: false, hydrated: true })
    act(() => {
      useNotifications.getState().push({
        kind: 'error',
        title: 'terminal failed',
        // Canvas pushes `error.message` / `assessment.reason` / a clipped agent line here.
        body: 'fatal: could not read from remote terminal repository',
        actions: [{ label: 'Retry', onClick: () => {} }],
        autoDismissMs: null
      })
    })
    render()

    expect(document.body.querySelector('.toast__title')?.textContent).toBe('shell box failed')
    expect(document.body.querySelector('.toast__text')?.textContent).toBe(
      'fatal: could not read from remote terminal repository'
    )
    expect(document.body.querySelector('.toast__action')?.textContent).toBe('Go again')
    // The accessible name is built from the SAME translated title, so a screen reader and the
    // screen never name the toast two different ways.
    expect(
      document.body.querySelector('.toast__dismiss')?.getAttribute('aria-label')
    ).toBe('Dismiss: shell box failed')
  })

  it('shows the shipped wording while School mode is unknown or on', () => {
    usePersonalVocabulary.setState({
      status: 'loaded',
      entries: { terminal: 'shell box' },
      entryCount: 1
    })
    // hydrated:false — the default `enabled:false` is a placeholder, not a confirmed-off record.
    useSchoolMode.setState({ enabled: false, hydrated: false })
    act(() => {
      useNotifications.getState().push({ kind: 'error', title: 'terminal failed', autoDismissMs: null })
    })
    render()
    expect(document.body.querySelector('.toast__title')?.textContent).toBe('terminal failed')
  })
})
