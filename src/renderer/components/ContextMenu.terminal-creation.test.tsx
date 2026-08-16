// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  defaultTerminalCreationHandler,
  terminalProfileCreationActions,
  type AddTerminalFromSurface,
  type TerminalCreationScope
} from '../lib/terminal-creation-surfaces'
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

function itemsFor(
  addTerminal: AddTerminalFromSurface,
  scope: TerminalCreationScope
): MenuItem[] {
  const profileActions = terminalProfileCreationActions(
    addTerminal,
    [{ id: 'pwsh', label: 'PowerShell 7', disabled: false }],
    scope
  )
  return [
    {
      label: 'New terminal',
      onClick: defaultTerminalCreationHandler(addTerminal, scope)
    },
    {
      type: 'submenu',
      label: 'New terminal with profile…',
      children: profileActions.map((action) => ({
        label: action.label,
        disabled: action.disabled,
        hint: action.note,
        onClick: action.run
      }))
    }
  ]
}

function renderMenu(items: MenuItem[]): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(<ContextMenu x={10} y={10} items={items} onClose={() => {}} />))
}

function item(label: string): HTMLButtonElement {
  const hit = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent?.includes(label)
  )
  if (!hit) throw new Error(`missing menu item ${label}`)
  return hit
}

describe('ContextMenu terminal creation funnel', () => {
  it('dispatches the canvas default action at the clicked point with no explicit profile', () => {
    const addTerminal = vi.fn<AddTerminalFromSurface>()
    const center = { x: 125, y: 240 }
    renderMenu(itemsFor(addTerminal, { center }))

    act(() => item('New terminal').click())

    expect(addTerminal).toHaveBeenCalledOnce()
    expect(addTerminal).toHaveBeenCalledWith(center)
  })

  it('dispatches a group submenu profile with both placement and stable profile id', () => {
    const addTerminal = vi.fn<AddTerminalFromSurface>()
    const center = { x: 300, y: 450 }
    renderMenu(itemsFor(addTerminal, { center, groupId: 'group-2' }))

    act(() => item('New terminal with profile').click())
    act(() => item('PowerShell 7').click())

    expect(addTerminal).toHaveBeenCalledOnce()
    expect(addTerminal).toHaveBeenCalledWith(
      center,
      undefined,
      'group-2',
      undefined,
      'pwsh'
    )
  })
})
