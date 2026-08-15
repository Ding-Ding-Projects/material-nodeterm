// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ColorPicker } from './ColorPicker'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ColorPicker copy', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    delete (window as unknown as { nodeTerminal?: unknown }).nodeTerminal
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function mount(): HTMLButtonElement {
    act(() => root.render(<ColorPicker value="#0a84ff" onChange={vi.fn()} label="Accent" />))
    const button = host.querySelector<HTMLButtonElement>('.color-picker__copy')
    if (!button) throw new Error('ColorPicker copy button did not render')
    return button
  }

  async function click(button: HTMLButtonElement): Promise<void> {
    await act(async () => {
      button.click()
      await Promise.resolve()
    })
  }

  it('uses the active app clipboard bridge and raises feedback only after it accepts the write', async () => {
    const bridgeWrite = vi.fn(async () => true)
    const browserWrite = vi.fn(async () => {})
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      clipboard: { writeText: bridgeWrite }
    }
    vi.stubGlobal('navigator', { clipboard: { writeText: browserWrite } })

    const button = mount()
    await click(button)

    expect(bridgeWrite).toHaveBeenCalledWith('#0a84ff', { reportFailure: false })
    expect(browserWrite).not.toHaveBeenCalled()
    expect(button.textContent).toBe('Copied')
  })

  it('does not claim success when the fallback clipboard rejects', async () => {
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      clipboard: { writeText: vi.fn(async () => false) }
    }
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('permission denied'))) }
    })

    const toast = vi.fn()
    window.addEventListener('nodeterm:toast', toast)

    const button = mount()
    await click(button)

    expect(button.textContent).toBe('Copy')
    expect(toast).toHaveBeenCalledTimes(1)
    window.removeEventListener('nodeterm:toast', toast)
  })

  it('does not throw or claim success when no clipboard API exists', async () => {
    vi.stubGlobal('navigator', {})

    const toast = vi.fn()
    window.addEventListener('nodeterm:toast', toast)

    const button = mount()
    await click(button)

    expect(button.textContent).toBe('Copy')
    expect(toast).toHaveBeenCalledTimes(1)
    window.removeEventListener('nodeterm:toast', toast)
  })
})
