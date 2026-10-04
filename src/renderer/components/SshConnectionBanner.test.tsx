// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { useSettings } from '../state/settings'
import { useSchoolMode } from '../state/schoolMode'
import { SshConnectionBanner, sshBannerTone } from './SshConnectionBanner'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('sshBannerTone', () => {
  it('says nothing for a healthy or unknown connection', () => {
    expect(sshBannerTone(undefined, false)).toBeNull()
    expect(sshBannerTone(undefined, true)).toBeNull()
    expect(sshBannerTone('connected', false)).toBeNull()
  })

  it('a lost hook tunnel on a live master is a warning, never an error', () => {
    expect(sshBannerTone('connected', true)).toBe('warning')
  })

  it('maps the master states', () => {
    expect(sshBannerTone('connecting', false)).toBe('progress')
    expect(sshBannerTone('reconnecting', true)).toBe('progress')
    expect(sshBannerTone('disconnected', false)).toBe('error')
    expect(sshBannerTone('error', false)).toBe('error')
  })
})

describe('SshConnectionBanner', () => {
  let host: HTMLDivElement
  let root: Root | null = null
  const onReconnect = vi.fn()

  beforeEach(() => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, languageMode: 'en', funnyLevelEn: 1 } })
    useSchoolMode.setState({ enabled: false, hydrated: true })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    onReconnect.mockReset()
  })
  afterEach(() => {
    act(() => root?.unmount())
    host.remove()
  })

  const render = (props: Partial<React.ComponentProps<typeof SshConnectionBanner>>): void => {
    act(() =>
      root!.render(
        <SshConnectionBanner label="devbox" endpoint="me@devbox.example" onReconnect={onReconnect} {...props} />
      )
    )
  }

  it('renders nothing while connected and the tunnel is verified', () => {
    render({ status: 'connected' })
    expect(host.querySelector('.md3-ssh-banner')).toBeNull()
  })

  it('a lost hook tunnel says so with the server label and offers no Reconnect', () => {
    render({ status: 'connected', hooksLost: true })
    const banner = host.querySelector('.md3-ssh-banner--warning')
    expect(banner?.textContent).toContain('devbox: Agent status and canvas control lost their verified connection')
    expect(host.querySelector('button')).toBeNull()
    expect(banner?.getAttribute('role')).toBe('status')
  })

  it('every funny level keeps the facts: which server, and that agent status lost its link', () => {
    for (const level of [1, 3, 5, 10] as const) {
      useSettings.setState({ settings: { ...DEFAULT_SETTINGS, languageMode: 'en', funnyLevelEn: level } })
      render({ status: 'connected', hooksLost: true })
      const text = host.querySelector('.md3-ssh-banner--warning')?.textContent ?? ''
      expect(text.startsWith('devbox:')).toBe(true)
      expect(text.toLowerCase()).toContain('agent status')
    }
  })

  it('an error shows ssh\'s own cause verbatim and a working Reconnect', () => {
    render({ status: 'error', cause: 'Permission denied (publickey)' })
    expect(host.querySelector('.md3-ssh-banner--error')?.textContent).toContain('devbox: Permission denied (publickey)')
    const button = host.querySelector('button')
    expect(button?.textContent).toBe('Reconnect')
    act(() => button!.click())
    expect(onReconnect).toHaveBeenCalledTimes(1)
  })

  it('connecting shows a spinner and no button', () => {
    render({ status: 'connecting' })
    expect(host.querySelector('.md3-ssh-banner--progress .ui-spinner')).not.toBeNull()
    expect(host.querySelector('button')).toBeNull()
    expect(host.textContent).toContain('Connecting to devbox')
  })
})
