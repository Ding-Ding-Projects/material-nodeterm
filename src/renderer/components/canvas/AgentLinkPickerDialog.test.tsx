// @vitest-environment jsdom
import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentLinkPickerDialog, type AgentLinkPickerOption } from './AgentLinkPickerDialog'
import { usePersonalVocabulary } from '../../state/personalVocabulary'
import { useSchoolMode } from '../../state/schoolMode'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/agentIcons', () => ({
  AgentIcon: ({ agentId }: { agentId: string }) => <span data-agent-id={agentId} aria-hidden="true" />
}))
vi.mock('../MaterialSymbol', () => ({
  MaterialSymbol: ({ name }: { name: string }) => <span data-symbol={name} aria-hidden="true" />
}))
vi.mock('../regex/AnchoredRegexBuilder', () => ({
  AnchoredRegexBuilder: ({
    onOpenChange,
    closeSignal
  }: {
    onOpenChange?: (open: boolean) => void
    closeSignal?: number
  }) => {
    const [open, setOpen] = useState(false)
    useEffect(() => {
      if (!closeSignal) return
      setOpen(false)
      onOpenChange?.(false)
      document.querySelector<HTMLInputElement>('input[aria-label="Filter link targets"]')?.focus()
    }, [closeSignal, onOpenChange])
    useEffect(() => {
      if (open) requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.anchored-pop input')?.focus())
    }, [open])
    return (
      <>
        <button
          type="button"
          aria-label="Regex builder"
          aria-expanded={open}
          aria-controls="test-builder"
          onClick={() => {
            setOpen(true)
            onOpenChange?.(true)
          }}
        />
        {open && (
          <div id="test-builder" className="anchored-pop md3-regex-popover">
            <input aria-label="Regex pattern" autoFocus />
            <button type="button">Done</button>
          </div>
        )}
      </>
    )
  }
}))
vi.mock('../dialog-stack', () => ({ useDialogStack: () => () => true }))

const TARGETS: AgentLinkPickerOption[] = [
  { id: 'node-codex', agentId: 'codex', title: 'Codex reviewer', agentLabel: 'Codex' },
  { id: 'node-gemini', agentId: 'gemini', title: 'Gemini researcher', agentLabel: 'Gemini' }
]

describe('AgentLinkPickerDialog', () => {
  let root: Root | undefined
  let host: HTMLElement

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0 })
    useSchoolMode.setState({ enabled: false, hydrated: true })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    host.remove()
    document.body.replaceChildren()
    usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0 })
    useSchoolMode.setState({ enabled: false, hydrated: false })
  })

  function render(targets = TARGETS, onPick = vi.fn(), onCancel = vi.fn()): {
    onPick: ReturnType<typeof vi.fn>
    onCancel: ReturnType<typeof vi.fn>
  } {
    root = createRoot(host)
    act(() => {
      root!.render(
        <AgentLinkPickerDialog
          sourceTitle="Lead agent"
          targets={targets}
          onPick={onPick}
          onCancel={onCancel}
        />
      )
    })
    return { onPick, onCancel }
  }

  const rows = (): HTMLButtonElement[] =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))

  it('opens with a live agent identity on each row and accessible dialog semantics', () => {
    render()
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('agent-link-picker-title')
    expect(dialog.getAttribute('aria-describedby')).toBe('agent-link-picker-description')
    expect(rows()).toHaveLength(2)
    expect(document.querySelector('[data-agent-id="codex"]')).not.toBeNull()
    expect(document.querySelector('[data-agent-id="gemini"]')).not.toBeNull()
  })

  it('maps the built-in display label in the visible row and accessible name while keeping the node title exact', () => {
    usePersonalVocabulary.setState({
      status: 'loaded',
      entries: { Codex: 'Code buddy' },
      entryCount: 1
    })
    const target = TARGETS[0]
    render([target])
    const row = rows()[0]
    expect(row.textContent).toContain('Code buddy')
    expect(row.textContent).toContain('Codex reviewer')
    expect(row.getAttribute('aria-label')).toBe('Codex reviewer, Code buddy')
  })

  it('focuses the search field, reaches the regex trigger, then roves to the first row with Tab', () => {
    const { onPick } = render()
    const input = document.querySelector('input[aria-label="Filter link targets"]') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    const trigger = document.querySelector('[aria-label="Regex builder"]') as HTMLButtonElement
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.getAttribute('aria-controls')).toBeTruthy()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(document.querySelector('[aria-label="Regex builder"]'))
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(rows()[0])
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onPick).not.toHaveBeenCalled()
    act(() => rows()[0].click())
    expect(onPick).toHaveBeenCalledWith('node-codex')
  })

  it('moves focus into the portaled builder, cycles the combined scope, and closes it first', () => {
    const { onCancel } = render()
    const input = document.querySelector('input[aria-label="Filter link targets"]') as HTMLInputElement
    const trigger = document.querySelector('button[aria-label="Regex builder"]') as HTMLButtonElement
    act(() => trigger.click())
    const builderInput = document.querySelector('input[aria-label="Regex pattern"]') as HTMLInputElement
    expect(document.activeElement).toBe(builderInput)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement?.textContent).toBe('Done')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('.anchored-pop')).toBeNull()
    expect(document.activeElement).toBe(input)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('syncs row focus and supports filtering without losing the provider id', () => {
    render()
    const input = document.querySelector('input[aria-label="Filter link targets"]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(input, 'gemini')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(rows()).toHaveLength(1)
    expect(rows()[0].getAttribute('data-idx')).toBe('0')
    act(() => rows()[0].focus())
    expect(rows()[0].getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector('[data-agent-id="gemini"]')).not.toBeNull()
  })

  it('reports an honest empty state and Escape cancellation', () => {
    const { onCancel } = render([])
    expect(document.querySelector('.agent-link-picker__empty')?.textContent).toMatch(/no other/i)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('wraps long source and target labels in the accessible surface', () => {
    render([
      {
        id: 'node-long',
        agentId: 'custom:long-agent',
        title: 'A'.repeat(240),
        agentLabel: 'Provider '.repeat(30)
      }
    ])
    expect(document.querySelector('.agent-link-picker__title')?.textContent).toContain('Lead agent')
    expect(document.querySelector('.agent-link-picker__name')?.textContent).toHaveLength(240)
    expect(document.querySelector('.agent-link-picker__agent')?.textContent).toHaveLength(270)
  })
})
