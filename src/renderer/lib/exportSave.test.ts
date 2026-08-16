// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOWNLOAD_URL_REVOKE_DELAY_MS, saveBlobDownload } from './exportSave'

let originalCreate: PropertyDescriptor | undefined
let originalRevoke: PropertyDescriptor | undefined

beforeEach(() => {
  vi.useFakeTimers()
  originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate)
  else delete (URL as unknown as Record<string, unknown>).createObjectURL
  if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke)
  else delete (URL as unknown as Record<string, unknown>).revokeObjectURL
})

describe('saveBlobDownload', () => {
  it('clicks a real download anchor and keeps its Blob URL alive through Chromium startup', () => {
    const create = vi.fn(() => 'blob:nodeterm-preset')
    const revoke = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
    let clicked: HTMLAnchorElement | null = null
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = this
    })

    const blob = new Blob(['{}'], { type: 'application/json' })
    saveBlobDownload(blob, 'nodeterm-appearance-presets.json')

    expect(create).toHaveBeenCalledWith(blob)
    expect(clicked).not.toBeNull()
    // The assignment happens inside the mocked DOM method; TypeScript cannot see that the real
    // `saveBlobDownload` call synchronously invokes it.
    const anchor = clicked as unknown as HTMLAnchorElement
    expect(anchor.href).toBe('blob:nodeterm-preset')
    expect(anchor.download).toBe('nodeterm-appearance-presets.json')
    expect(anchor.rel).toBe('noopener')
    expect(revoke).not.toHaveBeenCalled()

    vi.advanceTimersByTime(DOWNLOAD_URL_REVOKE_DELAY_MS - 1)
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revoke).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:nodeterm-preset')
  })
})
