/* @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PairingDoneResult } from '@shared/types'

const qr = vi.hoisted(() => ({ toDataURL: vi.fn() }))
vi.mock('qrcode', () => ({ toDataURL: qr.toDataURL }))

import { usePhonePairing } from './usePhonePairing'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const STARTED = {
  payload: '{"pair":true}',
  sshOpen: true,
  relayPlan: 'off' as const,
  shortCode: '123456',
  manualHost: '192.0.2.1:12345'
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('usePhonePairing lifecycle and completion reporting', () => {
  let root: Root | undefined
  let host: HTMLDivElement
  let complete: ((result: PairingDoneResult) => void) | undefined
  let current!: ReturnType<typeof usePhonePairing>
  const startPairing = vi.fn()
  const stopPairing = vi.fn(async () => undefined)
  const unsubscribe = vi.fn()

  const renderHook = (onFinished?: () => void): void => {
    const Harness = (): React.JSX.Element => {
      current = usePhonePairing(onFinished)
      return (
        <div
          data-phase={current.phase}
          data-busy={String(current.busy)}
          data-qr={current.qr}
          data-code={current.shortCode}
        >
          {current.error}
        </div>
      )
    }
    act(() => root!.render(<Harness />))
  }

  const startThroughQr = async (): Promise<void> => {
    startPairing.mockResolvedValueOnce(STARTED)
    qr.toDataURL.mockResolvedValueOnce('data:image/png;base64,fresh')
    await act(async () => current.start())
  }

  beforeEach(() => {
    vi.clearAllMocks()
    qr.toDataURL.mockResolvedValue('data:image/png;base64,default')
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    complete = undefined
    Object.defineProperty(window, 'nodeTerminal', {
      configurable: true,
      value: {
        pairing: {
          start: startPairing,
          onDone: (callback: (result: PairingDoneResult) => void) => {
            complete = callback
            return unsubscribe
          },
          stop: stopPairing,
          probeSsh: vi.fn(async () => true)
        }
      }
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    host.remove()
  })

  it('stops a listener that resolves after unmount during pairing.start', async () => {
    const startGate = deferred<typeof STARTED>()
    startPairing.mockReturnValueOnce(startGate.promise)
    renderHook()
    let task!: Promise<void>

    await act(async () => {
      task = current.start()
      await Promise.resolve()
    })
    expect(startPairing).toHaveBeenCalledOnce()
    act(() => root!.unmount())
    root = undefined

    expect(stopPairing).toHaveBeenCalledOnce()
    startGate.resolve(STARTED)
    await act(async () => task)

    expect(stopPairing).toHaveBeenCalledTimes(2)
    expect(qr.toDataURL).not.toHaveBeenCalled()
  })

  it('stops a superseded start before dispatching its replacement', async () => {
    const firstGate = deferred<typeof STARTED>()
    startPairing
      .mockReturnValueOnce(firstGate.promise)
      .mockResolvedValueOnce({ ...STARTED, shortCode: '654321' })
    qr.toDataURL.mockResolvedValueOnce('data:image/png;base64,replacement')
    renderHook()
    let first!: Promise<void>
    let second!: Promise<void>

    await act(async () => {
      first = current.start()
      await Promise.resolve()
    })
    await act(async () => {
      second = current.start()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(startPairing).toHaveBeenCalledOnce()

    firstGate.resolve(STARTED)
    await act(async () => Promise.all([first, second]))

    expect(startPairing).toHaveBeenCalledTimes(2)
    expect(stopPairing).toHaveBeenCalledOnce()
    expect(stopPairing.mock.invocationCallOrder[0]).toBeLessThan(
      startPairing.mock.invocationCallOrder[1]
    )
    expect(host.firstElementChild?.getAttribute('data-code')).toBe('654321')
    expect(host.firstElementChild?.getAttribute('data-phase')).toBe('waiting')
  })

  it('owns and stops the host listener while QR generation is pending', async () => {
    const qrGate = deferred<string>()
    startPairing.mockResolvedValueOnce(STARTED)
    qr.toDataURL.mockReturnValueOnce(qrGate.promise)
    renderHook()
    let task!: Promise<void>

    await act(async () => {
      task = current.start()
      await Promise.resolve()
    })
    expect(qr.toDataURL).toHaveBeenCalledOnce()

    act(() => root!.unmount())
    root = undefined
    expect(stopPairing).toHaveBeenCalledOnce()

    qrGate.resolve('data:image/png;base64,late')
    await act(async () => task)
    expect(stopPairing).toHaveBeenCalledOnce()
  })

  it('does not let a late QR continuation undo an explicit stop', async () => {
    const qrGate = deferred<string>()
    startPairing.mockResolvedValueOnce(STARTED)
    qr.toDataURL.mockReturnValueOnce(qrGate.promise)
    renderHook()
    let task!: Promise<void>

    await act(async () => {
      task = current.start()
      await Promise.resolve()
    })
    act(() => current.stop())

    expect(host.firstElementChild?.getAttribute('data-phase')).toBe('idle')
    expect(host.firstElementChild?.getAttribute('data-busy')).toBe('false')
    expect(host.firstElementChild?.getAttribute('data-qr')).toBe('')

    qrGate.resolve('data:image/png;base64,late')
    await act(async () => task)

    expect(host.firstElementChild?.getAttribute('data-phase')).toBe('idle')
    expect(host.firstElementChild?.getAttribute('data-qr')).toBe('')
    expect(stopPairing).toHaveBeenCalledOnce()
  })

  it('does not let a late QR continuation overwrite completion', async () => {
    const qrGate = deferred<string>()
    startPairing.mockResolvedValueOnce(STARTED)
    qr.toDataURL.mockReturnValueOnce(qrGate.promise)
    renderHook()
    let task!: Promise<void>

    await act(async () => {
      task = current.start()
      await Promise.resolve()
    })
    act(() => complete?.({ ok: true, relay: 'off' }))

    expect(host.firstElementChild?.getAttribute('data-phase')).toBe('paired')
    expect(host.firstElementChild?.getAttribute('data-busy')).toBe('false')

    qrGate.resolve('data:image/png;base64,late')
    await act(async () => task)

    expect(host.firstElementChild?.getAttribute('data-phase')).toBe('paired')
    expect(host.firstElementChild?.getAttribute('data-qr')).toBe('')
  })

  it('stops the host attempt when QR generation fails', async () => {
    startPairing.mockResolvedValueOnce(STARTED)
    qr.toDataURL.mockRejectedValueOnce(new Error('QR renderer failed'))
    renderHook()

    await act(async () => current.start())

    expect(stopPairing).toHaveBeenCalledOnce()
    expect(host.firstElementChild?.getAttribute('data-phase')).toBe('idle')
    expect(host.firstElementChild?.getAttribute('data-busy')).toBe('false')
    expect(host.textContent).toContain('QR renderer failed')
  })

  it('reports a failed commit distinctly and refreshes the revocable device list', async () => {
    const onFinished = vi.fn()
    renderHook(onFinished)
    await startThroughQr()

    act(() => complete?.({ ok: false, reason: 'failed' }))

    expect(host.firstElementChild?.getAttribute('data-phase')).toBe('failed')
    expect(host.textContent).toContain('before credentials were delivered')
    expect(host.textContent).toContain('Phone settings')
    expect(host.textContent).toContain('revoke it before trying again')
    expect(onFinished).toHaveBeenCalledOnce()
  })

  it('keeps genuine expiry labeled as a timeout', async () => {
    renderHook()
    await startThroughQr()

    act(() => complete?.({ ok: false, reason: 'timeout' }))

    expect(host.firstElementChild?.getAttribute('data-phase')).toBe('timeout')
    expect(host.textContent).toBe('')
  })
})
