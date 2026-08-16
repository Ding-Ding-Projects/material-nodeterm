// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PairedDevice } from '@shared/types'
import { useKidsMode } from '../../../state/kidsMode'
import { PhoneSection } from './PhoneSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PHONE: PairedDevice = {
  id: 'phone-a',
  name: 'Alice’s Phone',
  pairedAt: 1_700_000_000_000,
  lastSeenAt: 0
}

describe('PhoneSection revoke failure', () => {
  let root: Root | undefined
  let host: HTMLDivElement
  const listDevices = vi.fn(async () => [PHONE])
  const revokeDevice = vi.fn()

  const flush = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useKidsMode.setState({ enabled: false })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      pairing: {
        supported: true,
        start: vi.fn(),
        stop: vi.fn(async () => undefined),
        onDone: vi.fn(() => () => {}),
        probeSsh: vi.fn(async () => true),
        openRemoteLoginSettings: vi.fn(async () => undefined),
        listDevices,
        revokeDevice
      },
      remoteHost: { setPhoneAccess: vi.fn() }
    }
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    host.remove()
  })

  it('keeps the row and shows a persistent live-access warning when the bridge rejects', async () => {
    revokeDevice.mockRejectedValueOnce(new Error('EACCES: authorized_keys unreadable'))
    await act(async () => {
      root!.render(<PhoneSection isActive />)
    })
    await flush()

    const revoke = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Revoke')
    )
    expect(revoke).toBeDefined()
    act(() => revoke!.click())

    const confirm = [...document.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find(
      (button) => button.textContent === 'Revoke'
    )
    expect(confirm).toBeDefined()
    act(() => confirm!.click())
    await flush()

    expect(revokeDevice).toHaveBeenCalledWith(PHONE.id)
    expect(host.textContent).toContain(PHONE.name)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'SSH access may still be active'
    )
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('retry Revoke')
    expect(listDevices).toHaveBeenCalledTimes(2)

    // A successful retry is the only thing that clears the persistent warning.
    revokeDevice.mockResolvedValueOnce(undefined)
    act(() => revoke!.click())
    const retry = [...document.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find(
      (button) => button.textContent === 'Revoke'
    )
    act(() => retry!.click())
    await flush()

    expect(revokeDevice).toHaveBeenCalledTimes(2)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
})
