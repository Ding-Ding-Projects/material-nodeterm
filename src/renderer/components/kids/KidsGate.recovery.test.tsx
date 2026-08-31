// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDestructiveGate } from '../../state/destructiveGate'
import { useKidsMode } from '../../state/kidsMode'
import { KidsGate } from './KidsGate'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

function mount(): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <KidsGate modeName="Kids mode" variant="casual" onVerified={vi.fn()} onBackToKids={vi.fn()} />
    )
  })
}

describe('Kids gate credential-state routing', () => {
  beforeEach(() => {
    useDestructiveGate.getState().close()
    Object.defineProperty(window, 'nodeTerminal', {
      configurable: true,
      value: { kidsMode: { verifyPin: vi.fn().mockResolvedValue(true) } }
    })
    useKidsMode.setState({
      credentialState: 'absent',
      refreshCredentialState: vi.fn().mockResolvedValue(undefined),
      resetCredential: vi.fn().mockResolvedValue({ ok: true })
    } as never)
  })

  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = undefined
    host = undefined
    useDestructiveGate.getState().close()
  })

  it('does not render a PIN pad when the credential is confirmed absent', () => {
    mount()
    expect(host!.querySelector('[aria-label="Grown-up PIN"]')).toBeNull()
    expect(host!.textContent).toContain('Continue to grown-up controls')
  })

  it('fails closed without rendering grown-up controls when credential state is unavailable', () => {
    useKidsMode.setState({ credentialState: 'unavailable' } as never)
    mount()
    expect(host!.querySelector('[aria-label="Grown-up PIN"]')).toBeNull()
    expect(host!.textContent).toContain('Kids mode stays locked')
    expect(host!.textContent).not.toContain('Continue to grown-up controls')
  })

  it('routes forgotten-PIN recovery through the existing two-key slider gate', () => {
    mount()
    const button = [...host!.querySelectorAll('button')].find((item) => item.textContent?.includes('I never set this PIN'))
    expect(button).toBeTruthy()
    act(() => button!.click())
    expect(useDestructiveGate.getState().request).toMatchObject({
      title: 'Reset the Kids mode PIN',
      confirmLabel: 'Reset Kids mode PIN'
    })
  })

  it('checks an absent credential through the authoritative channel', async () => {
    const verifyPin = vi.fn().mockResolvedValue(false)
    const refreshCredentialState = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'nodeTerminal', {
      configurable: true,
      value: { kidsMode: { verifyPin } }
    })
    useKidsMode.setState({ credentialState: 'absent', refreshCredentialState } as never)
    mount()

    const button = [...host!.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Continue to grown-up controls')
    )
    await act(async () => {
      button!.click()
      await Promise.resolve()
    })

    expect(verifyPin).toHaveBeenCalledWith('')
    expect(refreshCredentialState).toHaveBeenCalledOnce()
    expect(host!.textContent).toContain("That's not right")
  })
})
