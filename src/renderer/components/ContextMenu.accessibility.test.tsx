// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ContextMenu, type MenuItem } from './ContextMenu'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class TestResizeObserver {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: TestResizeObserver
  })
})

afterEach(() => {
  document.body.replaceChildren()
})

function renderMenu(items: MenuItem[], onClose = vi.fn()) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(<ContextMenu x={10} y={10} items={items} onClose={onClose} />))
  return { host, root, onClose }
}

function menuItem(label: string): HTMLButtonElement {
  const row = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent?.includes(label)
  )
  if (!row) throw new Error(`missing menu item: ${label}`)
  return row
}

describe('ContextMenu submenu accessibility', () => {
  it('opens a submenu from the keyboard, moves focus into it, and restores focus on Escape', () => {
    const run = vi.fn()
    const { root } = renderMenu([
      {
        type: 'submenu',
        label: 'New terminal with profile',
        children: [{ label: 'PowerShell 7', onClick: run }]
      }
    ])

    const trigger = menuItem('New terminal with profile')
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById(trigger.getAttribute('aria-controls') ?? '')).toBeNull()

    act(() => {
      trigger.focus()
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })

    const child = menuItem('PowerShell 7')
    const submenu = child.closest<HTMLElement>('[role="menu"]')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(submenu?.id).toBe(trigger.getAttribute('aria-controls'))
    expect(submenu?.getAttribute('aria-labelledby')).toBe(trigger.id)
    expect(document.activeElement).toBe(child)

    act(() =>
      child.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    )
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    expect(run).not.toHaveBeenCalled()

    act(() => root.unmount())
  })

  it('keeps a disabled submenu item focusable and exposes its reason without activating it', () => {
    const unavailable = vi.fn()
    const available = vi.fn()
    const onClose = vi.fn()
    const reason = 'The selected WSL distribution is no longer installed.'
    const { root } = renderMenu(
      [
        {
          type: 'submenu',
          label: 'New terminal with profile',
          children: [
            {
              label: 'WSL — Missing Linux',
              disabled: true,
              hint: reason,
              onClick: unavailable
            },
            { label: 'PowerShell 7', onClick: available }
          ]
        }
      ],
      onClose
    )

    const trigger = menuItem('New terminal with profile')
    act(() => trigger.click())
    const disabledRow = menuItem('WSL — Missing Linux')
    const describedBy = disabledRow.getAttribute('aria-describedby')

    expect(disabledRow.disabled).toBe(false)
    expect(disabledRow.getAttribute('aria-disabled')).toBe('true')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe(reason)
    expect(disabledRow.textContent).toContain(reason)

    act(() => disabledRow.focus())
    expect(document.activeElement).toBe(disabledRow)
    act(() => disabledRow.click())
    expect(unavailable).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    act(() => menuItem('PowerShell 7').click())
    expect(available).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()

    act(() => root.unmount())
  })

  it('applies the same focusable disabled-reason contract to a top-level row', () => {
    const run = vi.fn()
    const onClose = vi.fn()
    const reason = 'PowerShell 7 was not found.'
    const { root } = renderMenu(
      [{ label: 'PowerShell 7', disabled: true, hint: reason, onClick: run }],
      onClose
    )

    const row = menuItem('PowerShell 7')
    act(() => row.focus())
    expect(document.activeElement).toBe(row)
    expect(row.getAttribute('aria-disabled')).toBe('true')
    expect(row.textContent).toContain(reason)
    act(() => row.click())
    expect(run).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    act(() => root.unmount())
  })

  it('does not activate an implicitly typed disabled row through the filter keyboard path', () => {
    const disabledRun = vi.fn()
    const onClose = vi.fn()
    const { root } = renderMenu(
      [
        {
          label: 'Unavailable profile',
          disabled: true,
          hint: 'The executable was not found.',
          onClick: disabledRun
        },
        ...Array.from({ length: 6 }, (_, index) => ({
          label: `Available profile ${index + 1}`,
          onClick: vi.fn()
        }))
      ],
      onClose
    )

    const filter = document.body.querySelector<HTMLInputElement>('.menu-filter__input')
    if (!filter) throw new Error('missing context-menu filter')
    act(() =>
      filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    )
    expect(disabledRun).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    act(() => root.unmount())
  })
})
