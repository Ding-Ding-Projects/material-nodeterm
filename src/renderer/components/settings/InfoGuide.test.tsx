// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FieldRow } from './FieldRow'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(description?: string): void {
  act(() =>
    root.render(<FieldRow label="Grid size" description={description} control={<input aria-label="grid" />} />)
  )
}

const button = () => host.querySelector('.md3-info-guide__btn') as HTMLButtonElement | null

describe('InfoGuide in FieldRow', () => {
  it('sits directly above the control, named for its own setting', () => {
    render('Spacing of the canvas dot grid.')
    const control = host.querySelector('.md3-settings-row__control') as HTMLElement
    expect(control.firstElementChild?.classList.contains('md3-info-guide')).toBe(true)
    expect(control.lastElementChild?.tagName).toBe('INPUT')
    expect(button()?.getAttribute('aria-label')).toBe('About this setting: Grid size')
    expect(button()?.getAttribute('aria-expanded')).toBe('false')
  })

  it('a row with no description gets no button', () => {
    render(undefined)
    expect(button()).toBeNull()
  })

  it('opens a focused explanation with guided steps, and Escape returns focus', () => {
    render('Spacing of the canvas dot grid.')
    act(() => button()!.click())
    const panel = host.querySelector('.md3-info-guide__panel') as HTMLElement
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.textContent).toContain('Spacing of the canvas dot grid.')
    expect(panel.querySelectorAll('li').length).toBe(3)
    expect(document.activeElement).toBe(panel)
    expect(button()?.getAttribute('aria-controls')).toBe(panel.id)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(host.querySelector('.md3-info-guide__panel')).toBeNull()
    expect(document.activeElement).toBe(button())
  })

  it('a press outside closes it without moving focus', () => {
    render('Spacing of the canvas dot grid.')
    act(() => button()!.click())
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(host.querySelector('.md3-info-guide__panel')).toBeNull()
  })
})
