// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthenticatorSection } from './AuthenticatorSection'
import type { AuthenticatorEntry } from '@shared/authenticator'
import { useKidsMode } from '../../../state/kidsMode'
import { useDestructiveGate } from '../../../state/destructiveGate'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('AuthenticatorSection credential-store recovery', () => {
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
      authenticator: {
        list,
        codes: vi.fn(async () => ({})),
        addFromUri: vi.fn(),
        addManual: vi.fn(),
        rename: vi.fn(),
        remove: vi.fn(),
        reveal: vi.fn(),
        exportSecrets: vi.fn()
      }
    }
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('renders an explicit unknown state instead of claiming the store has no entries', async () => {
    await act(async () => {
      root.render(<AuthenticatorSection isActive />)
    })

    expect(list).toHaveBeenCalledOnce()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not read the authenticator credential store.'
    )
    expect(host.textContent).toContain('Existing entries could not be verified.')
    expect(host.textContent).not.toContain('No entries yet.')
  })
})

const ENTRY: AuthenticatorEntry = {
  id: '00000000-0000-4000-8000-000000000001',
  issuer: 'Example',
  account: 'child@example.test',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  createdAt: 1,
  updatedAt: 2,
  revision: 'a'.repeat(64)
}

describe('AuthenticatorSection destructive removal', () => {
  let host: HTMLElement
  let root: Root
  let list: ReturnType<typeof vi.fn>
  let remove: ReturnType<typeof vi.fn>

  const button = (label: string): HTMLButtonElement => {
    const found = [...document.querySelectorAll('button')].reverse().find((candidate) =>
      candidate.textContent?.includes(label)
    )
    if (!(found instanceof HTMLButtonElement)) throw new Error(`missing ${label} button`)
    return found
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    list = vi.fn(async () => [ENTRY])
    remove = vi.fn(async () => ({ ok: true as const, removed: ENTRY }))
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      authenticator: {
        list,
        codes: vi.fn(async () => ({})),
        addFromUri: vi.fn(),
        addManual: vi.fn(),
        rename: vi.fn(),
        remove,
        reveal: vi.fn(),
        exportSecrets: vi.fn()
      }
    }
    useKidsMode.setState({ enabled: false, policyStatus: 'ready', hydrated: true })
    useDestructiveGate.setState({ request: null })
  })

  afterEach(() => {
    useDestructiveGate.getState().close()
    act(() => root.unmount())
    host.remove()
  })

  it('refuses a renamed/replaced entry after plain confirmation and performs no remove', async () => {
    const changed = { ...ENTRY, issuer: 'Replacement', updatedAt: 3, revision: 'b'.repeat(64) }
    list.mockResolvedValueOnce([ENTRY]).mockResolvedValueOnce([changed])
    await act(async () => root.render(<AuthenticatorSection isActive />))

    act(() => button('Remove').click())
    expect(document.querySelector('.confirm__msg')?.textContent).toContain('Example')
    await act(async () => button('Remove').click())

    expect(remove).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/changed while confirmation was open/i)
    expect(host.textContent).toContain('Replacement')
  })

  it('routes unavailable Kids policy through the two-key gate before spending the revision', async () => {
    useKidsMode.setState({ enabled: false, policyStatus: 'unavailable', hydrated: true })
    await act(async () => root.render(<AuthenticatorSection isActive />))

    act(() => button('Remove').click())
    const request = useDestructiveGate.getState().request
    expect(request?.title).toMatch(/authenticator seed/i)
    expect(remove).not.toHaveBeenCalled()

    await act(async () => request?.onConfirm())
    expect(remove).toHaveBeenCalledWith({ id: ENTRY.id, revision: ENTRY.revision })
    expect(host.textContent).not.toContain('child@example.test')
  })

  it('upgrades a stale ordinary approval when Kids policy becomes unavailable', async () => {
    await act(async () => root.render(<AuthenticatorSection isActive />))
    act(() => button('Remove').click())
    useKidsMode.setState({ enabled: false, policyStatus: 'unavailable', hydrated: true })

    await act(async () => button('Remove').click())
    expect(remove).not.toHaveBeenCalled()
    expect(useDestructiveGate.getState().request?.title).toMatch(/authenticator seed/i)
  })

  it('surfaces a core revision refusal and preserves the row', async () => {
    remove.mockResolvedValueOnce({
      ok: false as const,
      error: 'changed' as const,
      message: 'The entry changed at the final store boundary.'
    })
    await act(async () => root.render(<AuthenticatorSection isActive />))
    act(() => button('Remove').click())
    await act(async () => button('Remove').click())

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'The entry changed at the final store boundary.'
    )
    expect(host.textContent).toContain('child@example.test')
  })
})
