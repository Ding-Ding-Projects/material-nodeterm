// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CompactTopBarMenu } from './CompactTopBarMenu'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('CompactTopBarMenu', () => {
  let root: Root
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    if (!('ResizeObserver' in globalThis)) {
      ;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
        observe(): void {}
        disconnect(): void {}
      } as unknown as typeof ResizeObserver
    }
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ''
  })

  it('filters local actions and returns focus to More after selection', async () => {
    const onAws = vi.fn()
    const onHelp = vi.fn()
    act(() => {
      root.render(
        <CompactTopBarMenu
          items={[
            { id: 'aws', label: 'AWS Universe', onSelect: onAws },
            { id: 'help', label: 'Help', onSelect: onHelp }
          ]}
        />
      )
    })

    const trigger = host.querySelector<HTMLButtonElement>('.md3-compact-more')
    expect(trigger).not.toBeNull()
    act(() => trigger?.click())
    const input = document.body.querySelector<HTMLInputElement>('#compact-top-bar-search')
    expect(input).not.toBeNull()
    await act(async () => {
      if (input) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'aws')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const menuItems = document.body.querySelectorAll('[role="menuitem"]')
    expect(menuItems).toHaveLength(1)
    expect(menuItems[0]?.textContent).toContain('AWS Universe')
    act(() => {
      document.body.querySelector<HTMLButtonElement>('[role="menuitem"]')?.click()
    })
    expect(onAws).toHaveBeenCalledTimes(1)
    expect(document.body.querySelector('.md3-compact-more__popover')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
