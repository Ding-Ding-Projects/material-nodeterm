// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { useSettings } from '../state/settings'
import { AccessibilityTools, stepUiScale } from './AccessibilityTools'
import { applyA11yAttributes } from '../lib/a11yAttributes'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
let patches: Partial<Settings>[]

beforeEach(() => {
  patches = []
  useSettings.setState({
    settings: DEFAULT_SETTINGS,
    base: DEFAULT_SETTINGS,
    hydrated: true,
    // Record what the menu asks for and apply it, without touching disk.
    update: (patch: Partial<Settings>) => {
      patches.push(patch)
      useSettings.setState((s) => ({ settings: { ...s.settings, ...patch }, base: { ...s.base, ...patch } }))
    }
  } as never)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

function trigger(): HTMLButtonElement {
  return host.querySelector('.md3-rail-item--a11y') as HTMLButtonElement
}

function openMenu(onOpenShortcuts = vi.fn()): void {
  act(() => root.render(<AccessibilityTools onOpenShortcuts={onOpenShortcuts} />))
  act(() => trigger().click())
}

describe('AccessibilityTools', () => {
  it('is visible by default and opens an anchored dialog with every control', () => {
    openMenu()
    const panel = document.querySelector('.md3-a11y-tools__panel')
    expect(panel?.getAttribute('role')).toBe('dialog')
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(panel?.querySelectorAll('[role="switch"]').length).toBe(4)
    expect(panel?.textContent).toContain('100%')
  })

  it('each switch writes exactly its own persisted mode', () => {
    openMenu()
    const switches = [...document.querySelectorAll('.md3-a11y-tools__panel [role="switch"]')] as HTMLButtonElement[]
    act(() => switches[1].click())
    expect(patches).toEqual([{ a11yReduceMotion: true }])
    expect(useSettings.getState().settings.a11yReduceMotion).toBe(true)
    expect(useSettings.getState().settings.a11yHighContrast).toBe(false)
  })

  it('text size steps the shared UI scale by 10% and stops at the bounds', () => {
    openMenu()
    const larger = document.querySelector('[aria-label="Larger text"]') as HTMLButtonElement
    act(() => larger.click())
    expect(patches.at(-1)).toEqual({ uiScale: 1.1 })
    expect(stepUiScale(1.95, 1)).toBe(2)
    expect(stepUiScale(0.5, -1)).toBe(0.5)
    expect(stepUiScale('garbage', 1)).toBe(1.1)
  })

  it('hiding asks first with Cancel focused, and Cancel changes nothing', () => {
    openMenu()
    const hide = document.querySelector('.md3-a11y-tools__hide') as HTMLButtonElement
    act(() => hide.click())
    const confirm = document.querySelector('.md3-a11y-tools__confirm')
    expect(confirm?.getAttribute('role')).toBe('alertdialog')
    expect(document.activeElement?.textContent).toBe('Cancel')
    act(() => (document.activeElement as HTMLButtonElement).click())
    expect(patches).toEqual([])
    expect(document.querySelector('.md3-a11y-tools__confirm')).toBeNull()
  })

  it('confirming hides only the button; the modes stay as they were', () => {
    useSettings.setState((s) => ({ settings: { ...s.settings, a11yBoldFocus: true } }))
    openMenu()
    act(() => (document.querySelector('.md3-a11y-tools__hide') as HTMLButtonElement).click())
    const confirmBtn = [...document.querySelectorAll('.md3-a11y-tools__confirm button')].find((b) => b.textContent === 'Hide button') as HTMLButtonElement
    act(() => confirmBtn.click())
    expect(patches).toEqual([{ a11yToolsVisible: false }])
    expect(useSettings.getState().settings.a11yBoldFocus).toBe(true)
    expect(trigger()).toBeNull()
  })

  it('only a literal false hides the button: a hand-edited non-boolean keeps it visible', () => {
    useSettings.setState((s) => ({ settings: { ...s.settings, a11yToolsVisible: 'no' as unknown as boolean } }))
    act(() => root.render(<AccessibilityTools onOpenShortcuts={vi.fn()} />))
    expect(trigger()).not.toBeNull()
  })

  it('Escape closes the menu and returns focus to the trigger', () => {
    openMenu()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(document.querySelector('.md3-a11y-tools__panel')).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('Keyboard shortcuts closes the menu and opens the panel', () => {
    const onOpen = vi.fn()
    openMenu(onOpen)
    const btn = [...document.querySelectorAll('.md3-a11y-tools__panel button')].find((b) => b.textContent?.includes('Keyboard shortcuts')) as HTMLButtonElement
    act(() => btn.click())
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.md3-a11y-tools__panel')).toBeNull()
  })
})

describe('applyA11yAttributes', () => {
  it('sets exactly the modes that are on and removes the rest', () => {
    const el = document.createElement('html')
    applyA11yAttributes(el, { contrast: true, motion: true, focus: false, targets: true })
    expect(el.dataset.a11yContrast).toBe('on')
    expect(el.dataset.a11yMotion).toBe('reduced')
    expect(el.dataset.a11yTargets).toBe('on')
    expect('a11yFocus' in el.dataset).toBe(false)
    applyA11yAttributes(el, { contrast: false, motion: false, focus: false, targets: false })
    expect(Object.keys(el.dataset)).toEqual([])
  })
})
