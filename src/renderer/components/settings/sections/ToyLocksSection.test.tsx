// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ToyLockCredentialKind, ToyLockRecord } from '@shared/toylock'
import { useToyLocks } from '../../../state/toylocks'
import { ToyLocksSection } from './ToyLocksSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ToyLocksSection credential-store recovery', () => {
  let host: HTMLElement
  let root: Root
  let list: ReturnType<typeof vi.fn>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    list = vi.fn(async () => {
      throw new Error('credential store unreadable')
    })
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      toylock: {
        list,
        remove: vi.fn(async () => undefined)
      }
    }
    useToyLocks.setState({
      records: [],
      loaded: false,
      loadError: null,
      unlockedUntil: {}
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    useToyLocks.setState({
      records: [],
      loaded: false,
      loadError: null,
      unlockedUntil: {}
    })
    host.remove()
  })

  it('shows a failed strict load without presenting an empty lock inventory', async () => {
    await act(async () => {
      root.render(<ToyLocksSection isActive />)
    })

    expect(list).toHaveBeenCalledOnce()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not read the toy-lock credential store.'
    )
    expect(host.textContent).toContain('Existing locks could not be verified.')
    expect(host.textContent).not.toContain('Nothing is locked yet.')
    expect(host.textContent).not.toContain('Loading…')
  })
})

describe('ToyLocksSection credential-kind labels', () => {
  let host: HTMLElement
  let root: Root

  const record = (credentialKind: ToyLockCredentialKind): ToyLockRecord => ({
    id: `lock-${credentialKind}`,
    target: { kind: 'tab', id: `tab-${credentialKind}`, label: `Tab ${credentialKind}` },
    credentialKind,
    createdAt: 0,
    duration: 'session',
    lockedOnLaunch: true
  })

  // Every kind in the union, in one fixture, because the defect being pinned was a fixture that
  // COULD NOT discriminate: the shipped two-branch label was right for 'password' and wrong for
  // everything else, so a test carrying only a password lock passes against the broken code.
  const records = [
    record('password'),
    record('totp'),
    record('password-totp'),
    record('windows-pin')
  ]

  /** The second line of a row: "<credential> · <duration> · <launch>". */
  const metaLineFor = (label: string): string | undefined => {
    const li = [...host.querySelectorAll('li')].find((el) =>
      el.textContent?.includes(`🔒 ${label}`)
    )
    const divs = li ? [...li.querySelectorAll('div')] : []
    return divs.at(-1)?.textContent ?? undefined
  }

  beforeEach(async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      toylock: { list: vi.fn(async () => records), remove: vi.fn(async () => undefined) }
    }
    useToyLocks.setState({ records: [], loaded: false, loadError: null, unlockedUntil: {} })
    await act(async () => {
      root.render(<ToyLocksSection isActive />)
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    useToyLocks.setState({ records: [], loaded: false, loadError: null, unlockedUntil: {} })
    host.remove()
  })

  it('names every credential kind for what it actually asks for', () => {
    expect(metaLineFor('Tab password')).toBe('Password · This surface only · locked on launch')
    expect(metaLineFor('Tab totp')).toBe(
      'Authenticator code · This surface only · locked on launch'
    )
    // The two kinds the shipped `? :` mislabelled as "Authenticator code".
    expect(metaLineFor('Tab password-totp')).toBe(
      'Password + authenticator code (both required) · This surface only · locked on launch'
    )
    expect(metaLineFor('Tab windows-pin')).toBe(
      'Windows PIN · This surface only · locked on launch'
    )
  })

  it('never calls the Windows PIN kind Windows Hello', () => {
    // docs/toy-locks.md: there is no Windows Hello prompt behind this, and implying one would be
    // the single most misleading thing this list could say about a lock's credential.
    expect(host.textContent).not.toContain('Hello')
  })
})
