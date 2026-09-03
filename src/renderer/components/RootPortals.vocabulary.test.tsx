// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'
import { NodeIconDialogHost, nodeIconDialog } from './NodeIconPicker'
import { RemoteOAuthCallbackNotice } from './RemoteOAuthCallbackNotice'
import { SshPassphrasePrompt } from './SshPassphrasePrompt'
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
  delete (window as unknown as { nodeTerminal?: unknown }).nodeTerminal
})

describe('root portal vocabulary boundaries', () => {
  it('maps fallback copy while keeping the thrown diagnostic exact and accessible', () => {
    usePersonalVocabulary.setState({
      entries: { 'Reload window': 'Redraw surface', 'Try to continue': 'Keep going' },
      status: 'loaded',
      entryCount: 2,
      loadedAt: Date.now(),
      lastError: null
    })
    function ThrowOriginal(): never {
      throw new Error('native diagnostic 42')
    }
    act(() => root.render(<AppErrorBoundary><ThrowOriginal /></AppErrorBoundary>))
    expect(host.querySelector('.app-error__message')?.textContent).toBe('native diagnostic 42')
    expect(host.querySelector('.mdx-btn--filled')?.textContent).toBe('Redraw surface')
    expect(host.querySelector('.mdx-btn--outlined')?.textContent).toBe('Keep going')
  })

  it('maps SSH prompt prose while preserving the identity basename and target', () => {
    usePersonalVocabulary.setState({
      entries: {
        "That passphrase didn't work": 'Passphrase rejected',
        'Try again for ': 'Retry key ',
        ' Unlocking for ': ' Navigate target ',
        'Passphrase for ': 'Key passphrase for ',
        Cancel: 'Stop',
        Unlock: 'Open'
      },
      status: 'loaded',
      entryCount: 6,
      loadedAt: Date.now(),
      lastError: null
    })
    act(() => root.render(<SshPassphrasePrompt identityFile={'C:\\keys\\id_rsa'} retry target="alice@example.test" onSubmit={() => {}} onCancel={() => {}} />))
    expect(document.body.textContent).toContain('Passphrase rejected')
    expect(document.body.textContent).toContain('Retry key id_rsa.')
    expect(document.body.textContent).toContain('Navigate target alice@example.test.')
    expect(document.body.querySelector('input')?.getAttribute('aria-label')).toBe('Key passphrase for id_rsa')
    expect(document.body.textContent).not.toContain('C:\\keys')
  })

  it('maps callback prose while keeping port, callback path, URL, and HTTP status exact', async () => {
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      remoteOAuth: {
        complete: async () => ({ status: 'completed', httpStatus: 302 }),
        cancel: async () => undefined
      }
    }
    usePersonalVocabulary.setState({
      entries: {
        'Complete remote sign-in': 'Finish remote access',
        'Paste the complete localhost callback URL': 'Enter callback link',
        'Complete callback': 'Finish callback',
        Cancel: 'Stop',
        'This callback expires in about ': 'Time remaining: '
      },
      status: 'loaded',
      entryCount: 5,
      loadedAt: Date.now(),
      lastError: null
    })
    act(() => root.render(<RemoteOAuthCallbackNotice />))
    await act(async () => {
      window.dispatchEvent(new CustomEvent('nodeterm:remote-oauth-callback', {
        detail: { port: 43127, callbackPath: '/oauth/callback?state=abc', expiresAt: Date.now() + 60_000 }
      }))
    })
    expect(host.querySelector('h2')?.textContent).toBe('Finish remote access')
    expect(host.textContent).toContain('localhost:43127/oauth/callback?state=abc')
    expect(host.querySelector('input')?.getAttribute('placeholder')).toBe('Enter callback link')
    expect(host.querySelector('input')?.getAttribute('aria-label')).toBe('Remote OAuth callback URL')
  })

  it('maps icon dialog copy while retaining the user title and emoji facts', async () => {
    usePersonalVocabulary.setState({
      entries: { 'Icon for ': 'Badge for ', 'Remove icon': 'Clear badge', Cancel: 'Stop', Use: 'Apply' },
      status: 'loaded',
      entryCount: 4,
      loadedAt: Date.now(),
      lastError: null
    })
    void nodeIconDialog({ nodeId: 'node-7', title: 'User title 7', icon: { type: 'emoji', value: '🚀' } })
    act(() => root.render(<NodeIconDialogHost />))
    expect(document.body.querySelector('.confirm__msg')?.textContent).toBe('Badge for User title 7')
    expect(document.body.querySelector('.node-icon-dialog__swatch')?.textContent).toBe('🚀')
    expect(document.body.querySelector('.node-icon-dialog__swatch')?.getAttribute('aria-label')).toContain('🚀')
    expect(document.body.textContent).toContain('Clear badge')
    act(() => document.body.querySelectorAll('button')[document.body.querySelectorAll('button').length - 2]?.click())
  })
})
