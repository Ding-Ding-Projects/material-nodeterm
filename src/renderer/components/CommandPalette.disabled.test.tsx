// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { CommandPalette, type Command } from './CommandPalette'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('CommandPalette disabled commands', () => {
  it('shows an unavailable profile with its reason but guards mouse, Enter, and secondary actions', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const run = vi.fn()
    const secondary = vi.fn()
    const onClose = vi.fn()
    const commands: Command[] = [
      {
        id: 'new-term-profile:wsl:Missing Linux',
        label: 'New terminal — WSL — Missing Linux',
        note: 'The distribution is no longer installed.',
        disabled: true,
        run,
        onSecondary: secondary
      }
    ]

    act(() => root.render(<CommandPalette commands={commands} onClose={onClose} />))
    const row = document.body.querySelector<HTMLButtonElement>('.palette__item')
    const input = document.body.querySelector<HTMLInputElement>('.palette__input')
    expect(row?.getAttribute('aria-disabled')).toBe('true')
    expect(row?.textContent).toContain('The distribution is no longer installed.')

    act(() => row?.click())
    act(() => input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    act(() =>
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })
      )
    )

    expect(run).not.toHaveBeenCalled()
    expect(secondary).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    act(() => root.unmount())
    host.remove()
  })

  it('still runs and closes an available command from Enter', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const run = vi.fn()
    const onClose = vi.fn()
    act(() =>
      root.render(
        <CommandPalette
          commands={[{ id: 'pwsh', label: 'New terminal — PowerShell 7', run }]}
          onClose={onClose}
        />
      )
    )
    const input = document.body.querySelector<HTMLInputElement>('.palette__input')
    act(() => input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(run).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
    act(() => root.unmount())
    host.remove()
  })
})
