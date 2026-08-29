// @vitest-environment jsdom
//
// End-to-end wiring for sectioned-menu filtering: menuRowVisibility/isFilterableMenu are unit
// tested in isolation (menuVisibility.test.ts), but the risk the task called out is the SEAM —
// ContextMenu still maps a filtered row back to `items[Number(fi.id)]` by index, and it now does
// that for submenu rows too (Enter opens the flyout) as well as plain items. These tests click and
// keyboard-activate rows THROUGH a live filter to prove that mapping stays honest, not just that
// the pure visibility function returns the right booleans.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
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

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  if (root) act(() => root?.unmount())
  document.body.replaceChildren()
  root = undefined
  host = undefined
})

function renderMenu(items: MenuItem[]): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(<ContextMenu x={10} y={10} items={items} onClose={() => {}} />))
}

function filterInput(): HTMLInputElement {
  const el = document.body.querySelector<HTMLInputElement>('.menu-filter__input')
  if (!el) throw new Error('missing context-menu filter input')
  return el
}

function type(value: string): void {
  const input = filterInput()
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function enter(): void {
  act(() =>
    filterInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  )
}

/** Exact match on the visible label text — `.includes` would let "New terminal with profile"
 *  falsely stand in for a query for the plain "New terminal" row. */
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

/** A sectioned menu shaped like the canvas pane menu: two labelled groups, a submenu whose match
 *  can only come from a child, a colors strip, and a trailing destructive item — 7 actionable
 *  rows, over FILTER_THRESHOLD (6), so filtering is expected to be live. */
function sectionedMenu(handlers: {
  newTerminal: () => void
  newRemote: () => void
  profile: () => void
  claude: () => void
  codex: () => void
  gemini: () => void
  del: () => void
  pick: (c: string) => void
}): MenuItem[] {
  return [
    { type: 'label', label: 'Terminals' },
    { label: 'New terminal', onClick: handlers.newTerminal },
    {
      type: 'submenu',
      label: 'New terminal with profile',
      children: [{ label: 'PowerShell 7', onClick: handlers.profile }]
    },
    { label: 'New remote…', onClick: handlers.newRemote },
    { type: 'label', label: 'Agents' },
    { label: 'New Claude Code', onClick: handlers.claude },
    { label: 'New Codex', onClick: handlers.codex },
    { label: 'New Gemini', onClick: handlers.gemini },
    { type: 'separator' },
    { type: 'colors', onPick: handlers.pick },
    { type: 'separator' },
    { label: 'Delete', danger: true, onClick: handlers.del }
  ]
}

describe('ContextMenu sectioned filtering', () => {
  it('renders a filter box and every row for a large sectioned menu with no query', () => {
    const handlers = {
      newTerminal: vi.fn(),
      newRemote: vi.fn(),
      profile: vi.fn(),
      claude: vi.fn(),
      codex: vi.fn(),
      gemini: vi.fn(),
      del: vi.fn(),
      pick: vi.fn()
    }
    renderMenu(sectionedMenu(handlers))
    expect(document.body.querySelector('.menu-filter__input')).not.toBeNull()
    expect(document.body.querySelector('.ctx-colors')).not.toBeNull()
    expect(queryMenuItem('New Claude Code')).toBeTruthy()
  })

  it('shows a submenu row that matches only via a CHILD label, and clicking it still opens the right flyout (index mapping honest)', () => {
    const handlers = {
      newTerminal: vi.fn(),
      newRemote: vi.fn(),
      profile: vi.fn(),
      claude: vi.fn(),
      codex: vi.fn(),
      gemini: vi.fn(),
      del: vi.fn(),
      pick: vi.fn()
    }
    renderMenu(sectionedMenu(handlers))
    type('powershell')

    // Nothing else should still match "powershell" — the trigger row is visible ONLY because of
    // its child.
    expect(queryMenuItem('New terminal')).toBeUndefined()
    expect(queryMenuItem('New Claude Code')).toBeUndefined()
    const trigger = menuItem('New terminal with profile')

    act(() => trigger.click())
    act(() => menuItem('PowerShell 7').click())
    expect(handlers.profile).toHaveBeenCalledOnce()
    expect(handlers.newTerminal).not.toHaveBeenCalled()
  })

  it('hides a section label once every row under it is filtered out, and hides the colors strip while a query is active', () => {
    const handlers = {
      newTerminal: vi.fn(),
      newRemote: vi.fn(),
      profile: vi.fn(),
      claude: vi.fn(),
      codex: vi.fn(),
      gemini: vi.fn(),
      del: vi.fn(),
      pick: vi.fn()
    }
    renderMenu(sectionedMenu(handlers))
    type('claude')

    // "Terminals" section has nothing matching "claude" left under it.
    expect(document.body.textContent).not.toContain('Terminals')
    // "Agents" section survives because "New Claude Code" matches.
    expect(document.body.textContent).toContain('Agents')
    expect(queryMenuItem('New Claude Code')).toBeTruthy()
    expect(queryMenuItem('New Codex')).toBeUndefined()
    // Colors has no label to match a live query, so it hides.
    expect(document.body.querySelector('.ctx-colors')).toBeNull()
  })

  it('activates the correct row by keyboard through a narrowed filter (index mapping honest)', () => {
    const handlers = {
      newTerminal: vi.fn(),
      newRemote: vi.fn(),
      profile: vi.fn(),
      claude: vi.fn(),
      codex: vi.fn(),
      gemini: vi.fn(),
      del: vi.fn(),
      pick: vi.fn()
    }
    renderMenu(sectionedMenu(handlers))
    type('codex')
    enter()
    expect(handlers.codex).toHaveBeenCalledOnce()
    expect(handlers.claude).not.toHaveBeenCalled()
    expect(handlers.gemini).not.toHaveBeenCalled()
  })

  it('Enter on a filtered, child-matched submenu row opens its flyout instead of no-op-ing', () => {
    const handlers = {
      newTerminal: vi.fn(),
      newRemote: vi.fn(),
      profile: vi.fn(),
      claude: vi.fn(),
      codex: vi.fn(),
      gemini: vi.fn(),
      del: vi.fn(),
      pick: vi.fn()
    }
    renderMenu(sectionedMenu(handlers))
    type('powershell')
    enter()
    expect(queryMenuItem('PowerShell 7')).toBeTruthy()
  })
})
