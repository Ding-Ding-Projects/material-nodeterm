// @vitest-environment jsdom
//
// The dismiss-control half of issue #128 ("New project blocks existing ones"): a user who opened
// the start screen over their four existing projects, then backed out mid-picker (cancelled the
// folder dialog), had no OBVIOUS way back to them — only a faint corner "×" plus Escape and
// click-outside, both invisible affordances. This covers the pure "may this screen be dismissed"
// decision (canDismissWelcomeScreen) and the always-visible controls it gates.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { useSchoolMode } from '../state/schoolMode'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSettings } from '../state/settings'
import { WelcomeScreen, canDismissWelcomeScreen } from './WelcomeScreen'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('canDismissWelcomeScreen', () => {
  it('allows dismissal only when at least one project is open', () => {
    expect(canDismissWelcomeScreen(true)).toBe(true)
  })

  it('refuses dismissal with zero open projects, even if closed ones exist to reopen', () => {
    // Deliberate: dismissing here would reveal an empty canvas with no active tab, and this
    // screen is the ONLY place "Recently closed" is browsable — hiding the dismiss control keeps
    // the one useful action (reopen) in view instead of one click behind a blank canvas.
    expect(canDismissWelcomeScreen(false)).toBe(false)
  })
})

describe('WelcomeScreen dismiss control', () => {
  let root: Root
  let host: HTMLElement

  beforeEach(() => {
    useSettings.setState({ settings: DEFAULT_SETTINGS, base: DEFAULT_SETTINGS, hydrated: true })
    useSchoolMode.setState({ enabled: false, hydrated: true, name: 'School mode' })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.restoreAllMocks()
    usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
  })

  const noop = () => {}

  function renderScreen(onClose?: () => void): void {
    act(() => {
      root.render(
        <WelcomeScreen
          onNewProject={noop}
          onOpenFolder={noop}
          onCloneRepo={noop}
          onOpenProjectFile={() => {}}
      onConnectSsh={noop}
          onClose={onClose}
        />
      )
    })
  }

  const click = (el: Element): void => {
    act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  }

  it('renders a labeled, always-visible "back" button that dismisses the screen', () => {
    const onClose = vi.fn()
    renderScreen(onClose)

    const back = host.querySelector('button[title="Back to your projects"]')
    expect(back).not.toBeNull()
    // Labeled with real text, not just a glyph a worried user could miss.
    expect(back?.textContent).toContain('Back to your projects')

    click(back!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the familiar corner close as a secondary dismiss, not the only one', () => {
    const onClose = vi.fn()
    renderScreen(onClose)

    const corner = host.querySelector('button[aria-label="Close"]')
    expect(corner).not.toBeNull()
    click(corner!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reassures the user that dismissing does not touch their other projects', () => {
    renderScreen(vi.fn())
    expect(host.textContent).toContain("They're untouched")
  })

  it('shows no dismiss control at all when there is nothing to return to', () => {
    renderScreen(undefined)

    expect(host.querySelector('button[title="Back to your projects"]')).toBeNull()
    expect(host.querySelector('button[aria-label="Close"]')).toBeNull()
    expect(host.textContent).not.toContain('Back to your projects')
  })

  it('Escape is a no-op (and never throws) when the screen has no way back', () => {
    renderScreen(undefined)
    expect(() =>
      act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    ).not.toThrow()
  })

  it('maps catalogue prose at the final render boundary after a vocabulary upload', () => {
    usePersonalVocabulary.setState({
      entries: { terminals: 'shell boxes', 'New project': 'Fresh mission' },
      status: 'loaded',
      entryCount: 2
    })
    renderScreen()
    expect(host.textContent).toContain('shell boxes')
    expect(host.textContent).toContain('Fresh mission')
  })

  it('keeps the shipped wording while School mode is enabled', () => {
    usePersonalVocabulary.setState({ entries: { terminals: 'shell boxes' }, status: 'loaded', entryCount: 1 })
    useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' })
    renderScreen()
    expect(host.textContent).toContain('terminals')
    expect(host.textContent).not.toContain('shell boxes')
  })
})
