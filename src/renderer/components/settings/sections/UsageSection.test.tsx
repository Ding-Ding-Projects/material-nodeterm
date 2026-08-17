// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { useSettings } from '../../../state/settings'
import { UsageSection } from './UsageSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('UsageSection write-only credentials', () => {
  let root: Root
  let host: HTMLElement
  let cookieProviders: ReturnType<typeof vi.fn>
  let setProviderCookie: ReturnType<typeof vi.fn>

  const mount = async (): Promise<void> => {
    root = createRoot(host)
    await act(async () => {
      root.render(<UsageSection isActive />)
    })
  }

  const row = (label: string): HTMLElement => {
    const labelElement = [...host.querySelectorAll('label')].find((candidate) => candidate.textContent === label)
    if (!labelElement?.parentElement?.parentElement) throw new Error(`credential row not found: ${label}`)
    return labelElement.parentElement.parentElement
  }

  const button = (container: ParentNode, label: string): HTMLButtonElement => {
    const match = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === label)
    if (!match) throw new Error(`button not found: ${label}`)
    return match
  }

  const type = (input: HTMLInputElement, value: string): void => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const click = async (element: HTMLElement): Promise<void> => {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    cookieProviders = vi.fn(async () => ({ minimax: false, opencode: false }))
    setProviderCookie = vi.fn(async (_provider: string, cookie: string) => Boolean(cookie.trim()))
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      usage: { cookieProviders, setProviderCookie },
      settings: { save: vi.fn(async () => undefined) }
    }
    useSettings.setState({
      settings: { ...DEFAULT_SETTINGS, hiddenUsageProviders: [] },
      base: { ...DEFAULT_SETTINGS, hiddenUsageProviders: [] },
      hydrated: true
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('keeps the pasted cookie and shows an inline error when Save rejects', async () => {
    setProviderCookie.mockRejectedValueOnce(new Error('Credential storage is unavailable.'))
    await mount()
    const minimax = row('MiniMax')
    const input = minimax.querySelector<HTMLInputElement>('input[type="password"]')!
    act(() => type(input, '_token=retry-me'))

    await click(button(minimax, 'Save'))

    expect(setProviderCookie).toHaveBeenCalledWith('minimax', '_token=retry-me')
    expect(input.value).toBe('_token=retry-me')
    expect(minimax.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not save the MiniMax session credential.'
    )
    expect(minimax.textContent).not.toContain('_token=retry-me')
    expect([...minimax.querySelectorAll('button')].some((candidate) => candidate.textContent === 'Clear')).toBe(false)
  })

  it('consumes and displays a rejected credential-status read', async () => {
    cookieProviders.mockRejectedValueOnce(new Error('Status read failed.'))

    await mount()

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not check which web-console credentials are stored.'
    )
    expect(button(row('MiniMax'), 'Clear')).toBeTruthy()
    expect(button(row('opencode'), 'Clear')).toBeTruthy()
  })

  it('does not claim a stored cookie was cleared when clear-incomplete rejects', async () => {
    cookieProviders.mockResolvedValueOnce({ minimax: true, opencode: false })
    setProviderCookie.mockRejectedValueOnce(
      Object.assign(new Error('Credential files remain.'), { code: 'clear-incomplete' })
    )
    await mount()
    const minimax = row('MiniMax')

    await click(button(minimax, 'Clear'))

    expect(setProviderCookie).toHaveBeenCalledWith('minimax', '')
    expect(minimax.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not clear the MiniMax session credential. It may still be stored.'
    )
    expect(minimax.textContent).toContain('Stored in a file only your user can read')
    expect(button(minimax, 'Clear')).toBeTruthy()
  })

  it('retains the existing write-only success behavior', async () => {
    await mount()
    const minimax = row('MiniMax')
    const input = minimax.querySelector<HTMLInputElement>('input[type="password"]')!
    act(() => type(input, '_token=stored'))

    await click(button(minimax, 'Save'))

    expect(input.value).toBe('')
    expect(minimax.textContent).toContain('Stored in a file only your user can read')
    expect(button(minimax, 'Clear')).toBeTruthy()
    expect(minimax.querySelector('[role="alert"]')).toBeNull()
  })
})
