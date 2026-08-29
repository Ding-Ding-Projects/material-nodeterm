// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyColorText } from '../components/color/color-clipboard'
import { installWsBridge } from './ws-bridge'

class OpenWebSocket extends EventTarget {
  binaryType = ''

  constructor(_url: string | URL) {
    super()
    queueMicrotask(() => this.dispatchEvent(new Event('open')))
  }

  send(_data: string): void {}
}

const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand')

function setExecCommand(result: boolean): ReturnType<typeof vi.fn> {
  const execCommand = vi.fn(() => result)
  Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
  return execCommand
}

afterEach(() => {
  delete (window as unknown as { nodeTerminal?: unknown }).nodeTerminal
  if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand)
  else Reflect.deleteProperty(document, 'execCommand')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('installed Server Edition clipboard', () => {
  it('awaits a successful browser clipboard write through the live window API', async () => {
    vi.stubGlobal('WebSocket', OpenWebSocket)
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const execCommand = setExecCommand(false)

    await expect(installWsBridge()).resolves.toBe(true)
    await expect(window.nodeTerminal.clipboard.writeText('live colour')).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledWith('live colour')
    expect(execCommand).not.toHaveBeenCalled()
  })

  it('returns false and raises one toast after async rejection plus execCommand false', async () => {
    vi.stubGlobal('WebSocket', OpenWebSocket)
    const writeText = vi.fn(async () => {
      await Promise.resolve()
      throw new Error('permission denied')
    })
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const execCommand = setExecCommand(false)
    const toast = vi.fn()
    window.addEventListener('nodeterm:toast', toast)

    await expect(installWsBridge()).resolves.toBe(true)
    await expect(window.nodeTerminal.clipboard.writeText('blocked colour')).resolves.toBe(false)

    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(toast).toHaveBeenCalledTimes(1)
    window.removeEventListener('nodeterm:toast', toast)
  })

  it('suppresses the bridge toast when ColorPicker\'s later navigator fallback succeeds', async () => {
    vi.stubGlobal('WebSocket', OpenWebSocket)
    const writeText = vi
      .fn<(_: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('first route denied'))
      .mockResolvedValueOnce(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const execCommand = setExecCommand(false)
    const toast = vi.fn()
    window.addEventListener('nodeterm:toast', toast)

    await expect(installWsBridge()).resolves.toBe(true)
    await expect(copyColorText('fallback colour')).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledTimes(2)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(toast).not.toHaveBeenCalled()
    window.removeEventListener('nodeterm:toast', toast)
  })
})
