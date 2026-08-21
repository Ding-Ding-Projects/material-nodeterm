// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GroupPickerDialog, type GroupPickerOption } from './GroupPickerDialog'
import { resetDialogStack } from '../dialog-stack'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const GROUPS: GroupPickerOption[] = [
  { id: 'g1', title: 'Feature work', color: '#ff0000', memberCount: 4 },
  { id: 'g2', title: 'Bugfixes', color: '#00ff00', memberCount: 1 },
  { id: 'g3', title: 'Release prep', memberCount: 0 }
]

describe('GroupPickerDialog', () => {
  let root: Root | undefined
  let host: HTMLElement

  beforeEach(() => {
    resetDialogStack()
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    host.remove()
  })

  function render(groups = GROUPS): { onPick: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn> } {
    const onPick = vi.fn()
    const onCancel = vi.fn()
    root = createRoot(host)
    act(() => {
      root!.render(<GroupPickerDialog count={2} groups={groups} onPick={onPick} onCancel={onCancel} />)
    })
    return { onPick, onCancel }
  }

  const options = (): HTMLElement[] => Array.from(document.querySelectorAll('[role="option"]'))
  const input = (): HTMLInputElement => document.querySelector('.menu-filter__input') as HTMLInputElement
  const setQuery = (value: string): void => {
    const el = input()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('lists every eligible group with its member count', () => {
    render()
    const rows = options()
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('Feature work')
    expect(rows[0].textContent).toContain('4')
    expect(rows[2].textContent).toContain('Release prep')
  })

  it('filters by plain text', () => {
    render()
    setQuery('bug')
    const rows = options()
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('Bugfixes')
  })

  it('shows an honest empty state when nothing matches', () => {
    render()
    setQuery('nonexistent-xyz')
    expect(options()).toHaveLength(0)
    expect(document.querySelector('.group-picker__empty')?.textContent).toMatch(/no groups match/i)
  })

  it('shows a distinct empty state when there are no groups at all', () => {
    render([])
    expect(document.querySelector('.group-picker__empty')?.textContent).toMatch(/no groups yet/i)
  })

  it('clicking a row picks that group', () => {
    const { onPick } = render()
    act(() => {
      options()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onPick).toHaveBeenCalledWith('g2')
  })

  it('ArrowDown/ArrowUp move the active row, Enter picks it', () => {
    const { onPick } = render()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    })
    // Started at 0, +1, +1, -1 -> active index 1 ("Bugfixes")
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onPick).toHaveBeenCalledWith('g2')
  })

  it('ArrowDown does not run past the last row', () => {
    const { onPick } = render()
    for (let i = 0; i < 10; i++) {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      })
    }
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onPick).toHaveBeenCalledWith('g3')
  })

  it('Escape cancels without picking', () => {
    const { onPick, onCancel } = render()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('a filtered-out active row is re-clamped, so Enter cannot pick a hidden group', () => {
    const { onPick } = render()
    // Move active index to the last row ("Release prep", idx 2).
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    // Now filter down to just one match — the previously-active index must clamp into range.
    setQuery('bug')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onPick).toHaveBeenCalledWith('g2')
  })

  it('backdrop click cancels', () => {
    const { onCancel } = render()
    const backdrop = document.querySelector('.group-picker__backdrop') as HTMLElement
    act(() => {
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('focuses the search field on open', () => {
    render()
    expect(document.activeElement).toBe(input())
  })

  it('carries an accessible dialog name naming the move', () => {
    render()
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.getAttribute('aria-label')).toMatch(/2 nodes/i)
  })
})
