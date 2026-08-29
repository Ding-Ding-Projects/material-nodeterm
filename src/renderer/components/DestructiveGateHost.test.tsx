/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DestructiveGateHost } from './DestructiveGateHost'
import { openDestructiveGate, useDestructiveGate } from '../state/destructiveGate'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('DestructiveGateHost cancellation acknowledgement', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
    )
    useDestructiveGate.setState({ request: null })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.querySelector('.destgate-overlay')?.remove()
    useDestructiveGate.setState({ request: null })
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('closes first and then acknowledges an emergency-exit cancellation', () => {
    const onCancel = vi.fn(() => {
      expect(useDestructiveGate.getState().request).toBeNull()
    })
    openDestructiveGate({
      title: 'Delete node',
      description: 'Ends its session.',
      onConfirm: vi.fn(),
      onCancel
    })

    act(() => root.render(<DestructiveGateHost />))
    act(() => document.querySelector<HTMLButtonElement>('.destgate__exit')!.click())

    expect(onCancel).toHaveBeenCalledOnce()
    expect(useDestructiveGate.getState().request).toBeNull()
  })

  it('fires once when range change and key-up reach 100 in the same render', async () => {
    const onConfirm = vi.fn()
    openDestructiveGate({
      title: 'Delete node',
      description: 'Ends its session.',
      onConfirm
    })
    act(() => root.render(<DestructiveGateHost />))

    const keys = Array.from(document.querySelectorAll<HTMLButtonElement>('.destgate__key'))
    act(() => keys[0].click())
    act(() => keys[1].click())
    const slider = document.querySelector<HTMLInputElement>('.destgate__slider')!
    act(() => {
      slider.value = '100'
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'End', bubbles: true }))
    })
    await act(async () => vi.runAllTimersAsync())

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(useDestructiveGate.getState().request).toBeNull()
  })
})
