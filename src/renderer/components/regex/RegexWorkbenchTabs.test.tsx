// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lab = vi.hoisted(() => ({ state: { status: 'idle', cases: [], bench: null, error: null } as Record<string, unknown>, calls: [] as unknown[][] }))
vi.mock('../../lib/regex/useRegexLab', () => ({
  useRegexLab: (...args: unknown[]) => {
    lab.calls.push(args)
    return lab.state
  }
}))

import { RegexWorkbenchTabs } from './RegexWorkbenchTabs'
import { regexHistory } from '../../lib/regex/history'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
const onChange = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  lab.state = { status: 'idle', cases: [], bench: null, error: null }
  lab.calls = []
  onChange.mockReset()
  regexHistory.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

function render(pattern = '(?<n>\\d+)', valid = true, matches: { start: number }[] | null = [{ start: 4 }]): void {
  act(() =>
    root.render(
      <RegexWorkbenchTabs
        value={{ pattern, flags: 'g' }}
        onChange={onChange}
        valid={valid}
        sample={'abc\nid 42\nxyz'}
        matches={matches as never}
      />
    )
  )
}

const tab = (name: string) => [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent === name) as HTMLButtonElement

describe('RegexWorkbenchTabs', () => {
  it('has five keyboard tabs wired to one labelled panel', () => {
    render()
    const tabs = host.querySelectorAll('[role="tab"]')
    expect([...tabs].map((t) => t.textContent)).toEqual(['Test cases', 'GREP', 'Use & convert', 'Benchmark', 'History'])
    const panel = host.querySelector('[role="tabpanel"]')!
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0].id)
    expect(tabs[0].getAttribute('aria-controls')).toBe(panel.id)
  })

  it('adding a case hands it to the worker hook, and results show pass or fail', () => {
    render()
    const input = host.querySelector('input[aria-label="New test case text"]') as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'id 7')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => ([...host.querySelectorAll('button')].find((b) => b.textContent === 'Add case') as HTMLButtonElement).click())
    expect(lab.calls.at(-1)?.[2]).toEqual([{ text: 'id 7', expect: 'match' }])
    lab.state = { status: 'ok', cases: [{ matched: true, pass: true, first: '7' }], bench: null, error: null }
    render()
    expect(host.querySelector('.md3-regex-lab__case.is-pass')).not.toBeNull()
    expect(host.querySelector('.md3-regex-lab__summary')?.textContent).toBe('1 passed · 0 failed')
  })

  it('GREP lists matching lines with numbers', () => {
    render()
    act(() => tab('GREP').click())
    expect(host.querySelector('.md3-regex-lab__grep-line')?.textContent).toBe('2')
    expect(host.querySelector('.md3-regex-lab__grep-text')?.textContent).toBe('id 42')
  })

  it('convert shows code, or names what the target cannot express', () => {
    render()
    act(() => tab('Use & convert').click())
    expect(host.querySelector('.md3-regex-lab__code')?.textContent).toContain('(?P<n>\\d+)')
    render('a(?=b)')
    const go = [...host.querySelectorAll('.md3-regex-lab__targets button')].find((b) => b.textContent === 'Go') as HTMLButtonElement
    act(() => go.click())
    expect(host.querySelector('.md3-regex-lab__code')).toBeNull()
    expect(host.querySelector('.md3-regex-lab__error')?.textContent).toMatch(/no lookahead/)
  })

  it('records a settled valid pattern in history, and restoring it calls onChange', () => {
    render('x+')
    act(() => vi.advanceTimersByTime(1300))
    act(() => tab('History').click())
    const item = host.querySelector('.md3-regex-lab__history-item') as HTMLButtonElement
    expect(item.textContent).toContain('/x+/g')
    act(() => item.click())
    expect(onChange).toHaveBeenCalledWith({ pattern: 'x+', flags: 'g' })
  })

  it('an invalid pattern is never recorded and the benchmark button stays disabled', () => {
    render('(', false, null)
    act(() => vi.advanceTimersByTime(2000))
    expect(regexHistory.get()).toEqual([])
    act(() => tab('Benchmark').click())
    const run = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Run benchmark') as HTMLButtonElement
    expect(run.disabled).toBe(true)
  })
})
