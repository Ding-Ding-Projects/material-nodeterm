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
})
