// @vitest-environment jsdom
//
// EditableNodeTitle is the one click-to-rename control every node header now shares (see its own
// file doc for what it replaced and why TerminalNode deliberately is not on it). These tests cover
// the contract every caller relies on: commit, cancel-restores, empty-name rejection (and the
// opt-out a free-text note needs), and keyboard operation.
//
// Every test renders through a small stateful Harness wrapper rather than freezing `value` in a
// JS closure — EditableNodeTitle is a CONTROLLED component, and a caller whose `onChange` doesn't
// actually feed back into a real re-render (the first draft of this file did exactly that) proves
// nothing: the DOM's native input value drifts out from under React and every assertion about the
// "current value" is really asserting about a value nobody ever fed back in. The Harness mirrors
// how every real node (updateNodeData -> React Flow -> re-render with the new `data.title`) uses
// it.
//
// Rendered with react-dom/client + act() and driven through real DOM events, the same harness
// pattern ServiceNode.test.tsx and DinoNode.test.tsx use — there is no @testing-library/react in
// this project.
import { useState } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { EditableNodeTitle, type EditableNodeTitleProps } from './EditableNodeTitle'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    root = createRoot(container)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

type HarnessProps = Omit<EditableNodeTitleProps, 'value' | 'onChange'> & {
  initial: string
  onCommit?: (v: string) => void
  /** Called with the live value on every change, so a test can assert the final settled value
   *  without reaching into the Harness's own state. */
  onValue?: (v: string) => void
}

function Harness({ initial, onCommit, onValue, ...rest }: HarnessProps) {
  const [value, setValue] = useState(initial)
  return (
    <EditableNodeTitle
      {...rest}
      value={value}
      onChange={(next) => {
        setValue(next)
        onValue?.(next)
      }}
      onCommit={onCommit}
    />
  )
}

function render(props: HarnessProps) {
  act(() => {
    root.render(<Harness {...props} />)
  })
}

function trigger() {
  const el = container.querySelector('button')
  if (!el) throw new Error('trigger button not found')
  return el
}

function input() {
  const el = container.querySelector('input')
  if (!el) throw new Error('input not found — not in edit mode?')
  return el
}

/** Types a value into the currently-mounted input via the native setter, matching every other
 *  controlled-input test in this repo (React ignores a plain `.value =` assignment). */
function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function keydown(el: HTMLElement, key: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

/** React 17+ delegates blur/focus through the bubbling 'focusout'/'focusin' native events, not
 *  the non-bubbling 'blur'/'focus' — dispatching a plain 'blur' event never reaches a React
 *  onBlur handler. Caught by watching this go red first: with a bare `blur` FocusEvent the
 *  "blur also commits" test below failed with `expected undefined to be 'blurred-name'` even
 *  though the component's onBlur handler was correct; switching to 'focusout' turned it green. */
function blurInput(el: HTMLInputElement) {
  act(() => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

describe('EditableNodeTitle', () => {
  it('shows the display trigger with the current value, not an input', () => {
    render({ initial: 'agent-one' })
    expect(trigger().textContent).toBe('agent-one')
    expect(container.querySelector('input')).toBeNull()
  })

  it('clicking the trigger opens an input seeded with the current value', () => {
    render({ initial: 'agent-one' })
    act(() => trigger().click())
    expect(input().value).toBe('agent-one')
  })

  it('Enter commits a changed value', () => {
    let committed: string | undefined
    render({ initial: 'agent-one', onCommit: (v) => (committed = v) })
    act(() => trigger().click())
    typeInto(input(), 'agent-renamed')
    keydown(input(), 'Enter')
    // The input unmounts back to the trigger once editing ends.
    expect(container.querySelector('input')).toBeNull()
    expect(committed).toBe('agent-renamed')
    expect(trigger().textContent).toBe('agent-renamed')
  })

  it('blur also commits a changed value (parity with the old hand-rolled editors)', () => {
    let committed: string | undefined
    render({ initial: 'agent-one', onCommit: (v) => (committed = v) })
    act(() => trigger().click())
    typeInto(input(), 'blurred-name')
    blurInput(input())
    expect(committed).toBe('blurred-name')
  })

  it('committing an unchanged value never fires onCommit (no spurious rename push)', () => {
    let committed = false
    render({ initial: 'agent-one', onCommit: () => (committed = true) })
    act(() => trigger().click())
    keydown(input(), 'Enter')
    expect(committed).toBe(false)
  })

  it('Escape restores the value editing started with and does not commit', () => {
    let committed = false
    let latest = ''
    render({
      initial: 'agent-one',
      onCommit: () => (committed = true),
      onValue: (v) => (latest = v)
    })
    act(() => trigger().click())
    typeInto(input(), 'typed-but-abandoned')
    expect(latest).toBe('typed-but-abandoned')
    keydown(input(), 'Escape')
    expect(committed).toBe(false)
    expect(latest).toBe('agent-one')
    expect(container.querySelector('input')).toBeNull()
    expect(trigger().textContent).toBe('agent-one')
  })

  it('rejects an empty commit by default, reverting to the pre-edit value', () => {
    // BROKEN-ON-PURPOSE CHECK: with the `rejectEmpty` branch deleted (always calling onCommit),
    // this assertion goes red — `committed` is defined and `latest` stays '' — because nothing
    // reverts the live value. Verified by temporarily removing that branch in
    // EditableNodeTitle.tsx and re-running this file (both assertions below failed), then
    // restoring it (both passed again).
    let committed: string | undefined
    let latest = ''
    render({
      initial: 'agent-one',
      onCommit: (v) => (committed = v),
      onValue: (v) => (latest = v)
    })
    act(() => trigger().click())
    typeInto(input(), '   ')
    keydown(input(), 'Enter')
    expect(committed).toBeUndefined()
    expect(latest).toBe('agent-one')
  })

  it('rejectEmpty=false accepts an empty commit (StickyNode/WebNode/ServiceNode opt-out)', () => {
    let committed: string | undefined
    render({ initial: 'Note', rejectEmpty: false, onCommit: (v) => (committed = v) })
    act(() => trigger().click())
    typeInto(input(), '')
    keydown(input(), 'Enter')
    expect(committed).toBe('')
  })

  it('renders an empty value with the emptyLabel fallback when not editing', () => {
    render({ initial: '', emptyLabel: 'Untitled thing' })
    expect(trigger().textContent).toBe('Untitled thing')
  })

  it('the trigger is a real <button> — keyboard reachable via Tab, no explicit tabindex needed', () => {
    render({ initial: 'agent-one' })
    const btn = trigger()
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.tabIndex).toBeGreaterThanOrEqual(0)
  })

  it('onEditingChange fires true on open and false on close', () => {
    const seen: boolean[] = []
    render({ initial: 'agent-one', onEditingChange: (e) => seen.push(e) })
    act(() => trigger().click())
    keydown(input(), 'Enter')
    expect(seen).toEqual([true, false])
  })
})
