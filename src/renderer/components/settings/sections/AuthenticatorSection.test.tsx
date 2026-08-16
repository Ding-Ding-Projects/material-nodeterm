// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatorEntry } from '@shared/authenticator'

import { useDestructiveGate } from '../../../state/destructiveGate'
import { useKidsMode } from '../../../state/kidsMode'
import { AuthenticatorSection } from './AuthenticatorSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const BASE_ENTRY: AuthenticatorEntry = {
  id: 'entry-1',
  issuer: 'Example',
  account: 'child@example.test',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  createdAt: 1,
  updatedAt: 1,
  revision: 'sealed-generation-1'
}

describe('AuthenticatorSection seed removal', () => {
  let host: HTMLDivElement
  let root: Root
  let entry: AuthenticatorEntry
  let list: ReturnType<typeof vi.fn>
  let remove: ReturnType<typeof vi.fn>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    entry = { ...BASE_ENTRY }
    list = vi.fn(async () => [entry])
    remove = vi.fn(async (expected: AuthenticatorEntry) => ({ ok: true, removed: expected } as const))
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      authenticator: {
        list,
        codes: vi.fn(async () => ({})),
        remove,
        rename: vi.fn(),
        reveal: vi.fn(),
        addFromUri: vi.fn(),
        addManual: vi.fn(),
        exportSecrets: vi.fn()
      },
      clipboard: { writeText: vi.fn() }
    }
    useDestructiveGate.setState({ request: null })
    useKidsMode.setState({ enabled: true, hydrated: true, policyStatus: 'ready' })
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.querySelector('.confirm-overlay')?.remove()
    useDestructiveGate.setState({ request: null })
  })

  async function mount(): Promise<void> {
    await act(async () => {
      root.render(<AuthenticatorSection isActive />)
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  function removeButton(): HTMLButtonElement {
    return [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Remove'
    )!
  }

  it('routes a Kids-mode seed deletion through the two-key gate', async () => {
    await mount()

    act(() => removeButton().click())
    const request = useDestructiveGate.getState().request
    expect(request?.title).toMatch(/authenticator seed/i)
    expect(remove).not.toHaveBeenCalled()

    await act(async () => {
      useDestructiveGate.getState().close()
      request?.onConfirm()
      await Promise.resolve()
    })
    expect(remove).toHaveBeenCalledWith(BASE_ENTRY)
  })

  it('upgrades an open ordinary dialog when the Kids policy becomes unavailable', async () => {
    useKidsMode.setState({ enabled: false, policyStatus: 'ready' })
    await mount()

    act(() => removeButton().click())
    const ordinaryRemove = document.querySelector<HTMLButtonElement>('.confirm__btn.danger')
    expect(ordinaryRemove).toBeTruthy()
    act(() => useKidsMode.setState({ policyStatus: 'unavailable' }))
    await act(async () => {
      ordinaryRemove!.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(useDestructiveGate.getState().request?.title).toMatch(/authenticator seed/i)
    expect(remove).not.toHaveBeenCalled()
  })

  it('performs zero deletion when the core entry cannot be re-read at commit', async () => {
    await mount()
    act(() => removeButton().click())
    const request = useDestructiveGate.getState().request
    list.mockRejectedValueOnce(new Error('vault unavailable'))

    await act(async () => {
      useDestructiveGate.getState().close()
      request?.onConfirm()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(remove).not.toHaveBeenCalled()
    expect(host.textContent).toMatch(/could not be re-read/i)
  })

  it('performs zero deletion when the disclosed entry changes under the gate', async () => {
    await mount()
    act(() => removeButton().click())
    const request = useDestructiveGate.getState().request
    entry.account = 'replacement@example.test'

    await act(async () => {
      useDestructiveGate.getState().close()
      request?.onConfirm()
      await Promise.resolve()
    })
    expect(remove).not.toHaveBeenCalled()
  })

  it('keeps the row when the core compare-and-remove detects a sealed generation change', async () => {
    await mount()
    act(() => removeButton().click())
    const request = useDestructiveGate.getState().request
    remove.mockResolvedValueOnce({ ok: false, error: 'changed' })

    await act(async () => {
      useDestructiveGate.getState().close()
      request?.onConfirm()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(host.textContent).toMatch(/changed or disappeared/i)
    expect(removeButton()).toBeTruthy()
  })
})
