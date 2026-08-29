// @vitest-environment jsdom
//
// The FACT `paneMenuGroup`'s third rule degrades around, pinned against the real renderer instead
// of asserted from reading it: `ContextMenu` draws a submenu's children itself and has no
// second-level flyout, so a submenu nested inside a submenu contributes NOTHING — not a disabled
// row, not an error, just silence. That is why a pane-menu group holding an account picker stays a
// labelled flat section. If nested flyouts ever land, the first test here goes red and points at
// the rule to revisit.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ContextMenu, type MenuItem } from '../components/ContextMenu'
import { paneMenuGroup } from './paneMenuGroup'

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

let root: Root | undefined

afterEach(() => {
  if (root) act(() => root?.unmount())
  document.body.replaceChildren()
  root = undefined
})

function renderMenu(items: MenuItem[]): void {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(<ContextMenu x={10} y={10} items={items} onClose={() => {}} />))
}

/** Exact label match: `.includes` would let "New Claude" stand in for its account child. */
function queryMenuItem(label: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (el) => el.textContent?.trim() === label
  )
}

function menuItem(label: string): HTMLButtonElement {
  const el = queryMenuItem(label)
  if (!el) throw new Error(`missing menu item: ${label}`)
  return el
}

describe('a pane-menu group that contains a submenu', () => {
  const pickAccount = vi.fn()
  const newCodex = vi.fn()
  const group = (): MenuItem[] => [
    {
      type: 'submenu',
      label: 'New Claude',
      children: [{ label: 'work@example.com', onClick: pickAccount }]
    },
    { label: 'New Codex', onClick: newCodex }
  ]

  it('loses its account rows entirely when nested (what the guard prevents)', () => {
    renderMenu([{ type: 'submenu', label: 'Agents', children: group() }])
    act(() => menuItem('Agents').click())

    // The flyout is open — the plain sibling proves it.
    expect(queryMenuItem('New Codex')).toBeTruthy()
    // The nested picker rendered nothing: neither its trigger nor the account under it.
    expect(queryMenuItem('New Claude')).toBeUndefined()
    expect(queryMenuItem('work@example.com')).toBeUndefined()
  })

  it('keeps every row reachable because paneMenuGroup declines to nest it', () => {
    renderMenu(paneMenuGroup('Agents', null, group()))
    act(() => menuItem('New Claude').click())
    act(() => menuItem('work@example.com').click())
    expect(pickAccount).toHaveBeenCalledOnce()
    expect(newCodex).not.toHaveBeenCalled()
  })
})
