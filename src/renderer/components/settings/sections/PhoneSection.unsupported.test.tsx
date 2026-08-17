// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildStubApi } from '../../../bridge/stubs'
import { PhoneSection } from './PhoneSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('PhoneSection browser capability', () => {
  let root: Root | undefined
  let host: HTMLElement
  const calls = {
    start: vi.fn(),
    stop: vi.fn(),
    probeSsh: vi.fn(),
    listDevices: vi.fn(),
    revokeDevice: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    host = document.createElement('div')
    document.body.appendChild(host)
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      pairing: {
        supported: false,
        start: calls.start,
        stop: calls.stop,
        onDone: vi.fn(() => () => {}),
        probeSsh: calls.probeSsh,
        openRemoteLoginSettings: vi.fn(),
        listDevices: calls.listDevices,
        revokeDevice: calls.revokeDevice
      }
    }
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    host.remove()
  })

  it('declares the Server Edition stub unsupported at the shared API boundary', () => {
    expect(buildStubApi().pairing.supported).toBe(false)
  })

  it('renders a deliberate desktop-only explanation and never calls rejecting stubs', () => {
    root = createRoot(host)
    act(() => root!.render(<PhoneSection isActive />))

    expect(host.textContent).toContain('Not available in Server Edition')
    expect(host.textContent).toContain('Pair nodeterm mobile from the desktop app')
    expect(host.textContent).not.toContain('Start pairing')
    expect(calls.start).not.toHaveBeenCalled()
    expect(calls.probeSsh).not.toHaveBeenCalled()
    expect(calls.listDevices).not.toHaveBeenCalled()
    expect(calls.revokeDevice).not.toHaveBeenCalled()
  })
})
