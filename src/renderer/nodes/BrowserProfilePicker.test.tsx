// @vitest-environment jsdom
//
// BrowserProfilePicker is the header control for a browser node's profile (canvas & kanban card
// modal alike): switch to another profile, create a new one, rename, or remove one — removal goes
// through the app's destructive-confirmation gate (CLAUDE.md, "Super confirmation for destructive
// actions") rather than deleting a real cookie jar with one click.
//
// Rendered with react-dom/client + act(), matching every other node/component test in this repo
// (see ServiceNode.test.tsx) — there is no @testing-library/react in this project.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserProfilePicker } from './BrowserProfilePicker'
import type { BrowserProfile } from '@shared/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no ResizeObserver; AnchoredPopover (which the picker's dropdown is built on) uses one
// to keep the popover positioned. A no-op stub is enough here — this file tests the picker's own
// selection/create/rename/remove behavior, not AnchoredPopover's viewport-clamping math.
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= StubResizeObserver

interface DestructiveGateRequest {
  title: string
  description: string
  affected?: string[]
  confirmLabel?: string
  anchor?: { x: number; y: number }
  restoreFocusEl?: HTMLElement | null
  onConfirm: () => void
  onCancel?: () => void
}

const openDestructiveGate = vi.fn((_req: DestructiveGateRequest) => true)
vi.mock('../state/destructiveGate', () => ({
  openDestructiveGate: (req: DestructiveGateRequest) => openDestructiveGate(req)
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    root = createRoot(container)
  })
  openDestructiveGate.mockClear()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const profiles: BrowserProfile[] = [
  { id: 'p1', name: 'Work', color: '#0a84ff' },
  { id: 'p2', name: 'Personal', color: '#ff9f0a' }
]

type PickerProps = Parameters<typeof BrowserProfilePicker>[0]

function render(overrides: Partial<PickerProps> = {}) {
  const handlers = {
    profiles,
    selectedId: undefined as string | undefined,
    onSelect: vi.fn<PickerProps['onSelect']>(),
    onCreate: vi.fn<PickerProps['onCreate']>(),
    onRename: vi.fn<PickerProps['onRename']>(),
    onRemove: vi.fn<PickerProps['onRemove']>()
  }
  const merged: PickerProps = { ...handlers, ...overrides }
  act(() => {
    root.render(<BrowserProfilePicker {...merged} />)
  })
  return handlers
}

function openPopover() {
  const trigger = container.querySelector<HTMLButtonElement>('.browser-profile-trigger')!
  act(() => trigger.click())
}

describe('BrowserProfilePicker', () => {
  it('shows "Default" when no profile is selected', () => {
    render({ selectedId: undefined })
    expect(container.querySelector('.browser-profile-trigger__label')?.textContent).toBe('Default')
  })

  it('shows the selected profile\'s name', () => {
    render({ selectedId: 'p2' })
    expect(container.querySelector('.browser-profile-trigger__label')?.textContent).toBe('Personal')
  })

  it('shows "Unknown profile" for a dangling selection (profile removed elsewhere)', () => {
    render({ selectedId: 'gone' })
    expect(container.querySelector('.browser-profile-trigger__label')?.textContent).toBe('Unknown profile')
  })

  it('lists every profile plus Default in the popover', () => {
    const h = render()
    openPopover()
    const rows = document.querySelectorAll('[role="menuitemradio"]')
    // Default + 2 profiles
    expect(rows.length).toBe(3)
    expect(h.onSelect).not.toHaveBeenCalled()
  })

  it('clicking a profile row selects it and closes the popover', () => {
    const h = render()
    openPopover()
    const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
    const workRow = rows.find((r) => r.textContent?.includes('Work'))!
    act(() => workRow.click())
    expect(h.onSelect).toHaveBeenCalledWith('p1')
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it('clicking Default clears the selection', () => {
    const h = render({ selectedId: 'p1' })
    openPopover()
    const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
    const defaultRow = rows.find((r) => r.textContent?.includes('Default'))!
    act(() => defaultRow.click())
    expect(h.onSelect).toHaveBeenCalledWith(undefined)
  })

  it('deleting a profile opens the destructive-confirmation gate, naming the exact profile', () => {
    render()
    openPopover()
    const del = document.querySelector<HTMLButtonElement>('[aria-label="Delete “Work”"]')!
    act(() => del.click())
    expect(openDestructiveGate).toHaveBeenCalledTimes(1)
    const req = openDestructiveGate.mock.calls[0][0]
    expect(req.title).toContain('Work')
    expect(req.affected).toEqual(['Work'])
  })

  it('only removes after the gate itself calls onConfirm — deleting alone never removes', () => {
    const h = render()
    openPopover()
    const del = document.querySelector<HTMLButtonElement>('[aria-label="Delete “Work”"]')!
    act(() => del.click())
    expect(h.onRemove).not.toHaveBeenCalled()
    const req = openDestructiveGate.mock.calls[0][0]
    act(() => req.onConfirm())
    expect(h.onRemove).toHaveBeenCalledWith('p1')
  })

  it('creating a new profile names it and immediately selects it', () => {
    const h = render()
    openPopover()
    const newBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('New profile')
    )!
    act(() => (newBtn as HTMLButtonElement).click())
    const input = document.querySelector<HTMLInputElement>('input')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(input, 'Shopping')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(h.onCreate).toHaveBeenCalledOnce()
    const created = h.onCreate.mock.calls[0][0]
    expect(created.name).toBe('Shopping')
    expect(h.onSelect).toHaveBeenCalledWith(created.id)
  })
})
