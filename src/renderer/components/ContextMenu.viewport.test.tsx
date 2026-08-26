// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { anchoredPopoverPosition } from '../ui/AnchoredPopover'

class TestResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: TestResizeObserver
  })
})

let root: Root | undefined

afterEach(() => {
  if (root) act(() => root?.unmount())
  document.body.replaceChildren()
  root = undefined
})

describe('desktop overlay viewport safety', () => {
  it('bounds a long root menu even when it contains a submenu, without nesting the flyout in the scroll container', () => {
    const rootItems: MenuItem[] = Array.from({ length: 36 }, (_, index) => ({
      label: `Root action ${index + 1}`,
      onClick: () => {}
    }))
    const childItems: MenuItem[] = Array.from({ length: 36 }, (_, index) => ({
      label: `Flyout action ${index + 1}`,
      onClick: () => {}
    }))
    const items: MenuItem[] = [
      ...rootItems.slice(0, 18),
      { type: 'submenu', label: 'Profiles', children: childItems },
      ...rootItems.slice(18)
    ]

    root = createRoot(document.body)
    act(() => root?.render(<ContextMenu x={20} y={20} items={items} onClose={() => {}} />))

    const rootMenu = document.body.querySelector<HTMLElement>('.ctx-menu:not(.ctx-submenu)')
    expect(rootMenu?.classList.contains('ctx-menu--scroll')).toBe(true)

    const trigger = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (button) => button.textContent?.trim() === 'Profiles'
    )
    expect(trigger).toBeTruthy()
    act(() => trigger?.click())

    const flyout = document.body.querySelector<HTMLElement>('.ctx-submenu')
    expect(flyout).toBeTruthy()
    expect(rootMenu?.contains(flyout)).toBe(false)
    expect(flyout?.querySelectorAll('[role="menuitem"]')).toHaveLength(36)
  })

  it('starts a taller-than-viewport anchored popover at the padded top instead of a negative top', () => {
    const position = anchoredPopoverPosition(
      { top: 100, bottom: 220, left: 100 },
      420,
      800,
      { width: 640, height: 240 }
    )

    expect(position.top).toBe(8)
    expect(position.top).toBeGreaterThanOrEqual(8)
    expect(position.maxHeight).toBe(92)
    expect(position.maxHeight).toBeLessThanOrEqual(224)
  })
})
