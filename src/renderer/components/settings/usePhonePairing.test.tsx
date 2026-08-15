/* @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PairingDoneResult } from '@shared/types'
import { usePhonePairing } from './usePhonePairing'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('usePhonePairing completion reporting', () => {
  let root: Root
  let host: HTMLDivElement
  let complete: ((result: PairingDoneResult) => void) | undefined
  const unsubscribe = vi.fn()

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    complete = undefined
    Object.defineProperty(window, 'nodeTerminal', {
      configurable: true,
      value: {
        pairing: {
          onDone: (callback: (result: PairingDoneResult) => void) => {
            complete = callback
            return unsubscribe
          },
          stop: vi.fn(async () => undefined),
          probeSsh: vi.fn(async () => true)
        }
      }
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.clearAllMocks()
  })

  it('reports a failed commit distinctly and refreshes the revocable device list', () => {
    const onFinished = vi.fn()
    const Harness = (): React.JSX.Element => {
      const { phase, error } = usePhonePairing(onFinished)
      return <div data-phase={phase}>{error}</div>
    }

    act(() => root.render(<Harness />))
    expect(complete).toBeTypeOf('function')

    act(() => complete?.({ ok: false, reason: 'failed' }))

    expect(host.firstElementChild?.getAttribute('data-phase')).toBe('failed')
    expect(host.textContent).toContain('before credentials were delivered')
    expect(host.textContent).toContain('Phone settings')
    expect(host.textContent).toContain('revoke it before trying again')
    expect(onFinished).toHaveBeenCalledOnce()
  })

  it('keeps genuine expiry labeled as a timeout', () => {
    const Harness = (): React.JSX.Element => {
      const { phase, error } = usePhonePairing()
      return <div data-phase={phase}>{error}</div>
    }

    act(() => root.render(<Harness />))
    act(() => complete?.({ ok: false, reason: 'timeout' }))

    expect(host.firstElementChild?.getAttribute('data-phase')).toBe('timeout')
    expect(host.textContent).toBe('')
  })
})
