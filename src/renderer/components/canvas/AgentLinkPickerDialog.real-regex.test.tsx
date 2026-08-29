// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentLinkPickerDialog, type AgentLinkPickerOption } from './AgentLinkPickerDialog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TARGETS: AgentLinkPickerOption[] = [
  { id: 'node-codex', agentId: 'codex', title: 'Codex reviewer', agentLabel: 'Codex' }
]

describe('AgentLinkPickerDialog with the real regex popover', () => {
  let root: Root | undefined
  let host: HTMLElement

  beforeEach(() => {
    class TestResizeObserver {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    host.remove()
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  it('moves into the real portaled builder, closes it first on Escape, and returns to search', () => {
    const onPick = vi.fn()
    const onCancel = vi.fn()
    root = createRoot(host)
    act(() => {
      root!.render(
        <AgentLinkPickerDialog
          sourceTitle="Lead agent"
          targets={TARGETS}
          onPick={onPick}
          onCancel={onCancel}
        />
      )
    })
    const trigger = document.querySelector('.md3-regex-trigger') as HTMLButtonElement
    const search = document.querySelector('input[aria-label="Filter link targets"]') as HTMLInputElement
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.getAttribute('aria-controls')).toBeTruthy()
    act(() => trigger.click())
    const builder = document.querySelector('.md3-regex-popover') as HTMLElement
    const pattern = builder.querySelector('input[aria-label="Regex pattern"]') as HTMLInputElement
    expect(builder).not.toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(pattern)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).not.toBe(search)
    act(() => {
      pattern.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('.md3-regex-popover')).toBeNull()
    expect(document.activeElement).toBe(search)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('wraps forward and reverse focus across builder and picker, and closes through Done', () => {
    root = createRoot(host)
    act(() => {
      root!.render(
        <AgentLinkPickerDialog
          sourceTitle="Lead agent"
          targets={TARGETS}
          onPick={vi.fn()}
          onCancel={vi.fn()}
        />
      )
    })
    const trigger = document.querySelector('.md3-regex-trigger') as HTMLButtonElement
    const search = document.querySelector('input[aria-label="Filter link targets"]') as HTMLInputElement
    act(() => trigger.click())
    const builder = document.querySelector('.md3-regex-popover') as HTMLElement
    const controls = Array.from(
      builder.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
    )
    expect(controls.length).toBeGreaterThan(1)
    controls[0].focus()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(controls[1])
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
      )
    })
    expect(document.activeElement).toBe(controls[0])
    const done = Array.from(builder.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Done'
    ) as HTMLButtonElement | undefined
    done?.click()
    expect(document.querySelector('.md3-regex-popover')).toBeNull()
    expect(document.activeElement).toBe(search)
  })

  it('closes the real builder from its outside edge without closing the picker', () => {
    const onCancel = vi.fn()
    root = createRoot(host)
    act(() => {
      root!.render(
        <AgentLinkPickerDialog
          sourceTitle="Lead agent"
          targets={TARGETS}
          onPick={vi.fn()}
          onCancel={onCancel}
        />
      )
    })
    const trigger = document.querySelector('.md3-regex-trigger') as HTMLButtonElement
    act(() => trigger.click())
    const backdrop = document.querySelector('.anchored-pop__backdrop') as HTMLElement
    act(() => backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(document.querySelector('.md3-regex-popover')).toBeNull()
    expect(document.querySelector('.agent-link-picker')).not.toBeNull()
    expect(onCancel).not.toHaveBeenCalled()
  })
})
