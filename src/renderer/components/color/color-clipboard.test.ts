import { describe, expect, it, vi } from 'vitest'
import { copyColorText, type BrowserClipboardWriter } from './color-clipboard'

const browserWriter = (writeText: BrowserClipboardWriter['writeText']): BrowserClipboardWriter => ({
  writeText
})

describe('copyColorText', () => {
  it('routes through the app clipboard bridge before the browser fallback', async () => {
    const bridge = vi.fn(async () => true)
    const browser = vi.fn(async () => {})

    expect(
      await copyColorText('#0a84ff', {
        bridge: { writeText: bridge },
        browser: browserWriter(browser)
      })
    ).toBe(true)
    expect(bridge).toHaveBeenCalledWith('#0a84ff', { reportFailure: false })
    expect(browser).not.toHaveBeenCalled()
  })

  it('uses the browser clipboard when the bridge is absent', async () => {
    const browser = vi.fn(async () => {})

    expect(await copyColorText('rgb(1, 2, 3)', { browser: browserWriter(browser) })).toBe(true)
    expect(browser).toHaveBeenCalledWith('rgb(1, 2, 3)')
  })

  it('falls back when the bridge reports false', async () => {
    const browser = vi.fn(async () => {})
    const reportFailure = vi.fn()

    expect(
      await copyColorText('hsl(0 0% 0%)', {
        bridge: { writeText: vi.fn(async () => false) },
        browser: browserWriter(browser),
        reportFailure
      })
    ).toBe(true)
    expect(browser).toHaveBeenCalledWith('hsl(0 0% 0%)')
    expect(reportFailure).not.toHaveBeenCalled()
  })

  it('falls back when the bridge rejects', async () => {
    const browser = vi.fn(async () => {})

    expect(
      await copyColorText('#123456', {
        bridge: {
          writeText: vi.fn(async () => {
            throw new Error('window destroyed')
          })
        },
        browser: browserWriter(browser)
      })
    ).toBe(true)
    expect(browser).toHaveBeenCalledWith('#123456')
  })

  it('returns false when no clipboard writer exists', async () => {
    const reportFailure = vi.fn()
    expect(await copyColorText('#fff', { reportFailure })).toBe(false)
    expect(reportFailure).toHaveBeenCalledTimes(1)
  })

  it('owns a browser clipboard rejection and never reports false success', async () => {
    const rejected = Promise.reject(new Error('permission denied'))
    const browser = vi.fn(() => rejected)

    const reportFailure = vi.fn()
    await expect(
      copyColorText('#fff', { browser: browserWriter(browser), reportFailure })
    ).resolves.toBe(false)
    expect(browser).toHaveBeenCalledTimes(1)
    expect(reportFailure).toHaveBeenCalledTimes(1)
  })

  it('owns a synchronous clipboard throw too', async () => {
    expect(
      await copyColorText('#fff', {
        browser: browserWriter(() => {
          throw new Error('clipboard getter detached')
        }),
        reportFailure: vi.fn()
      })
    ).toBe(false)
  })
})
