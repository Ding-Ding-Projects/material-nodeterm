// @vitest-environment jsdom
/**
 * The shared password field the lock dialogs use. Three behaviours are the reason it exists, and
 * each of them is a way somebody gets locked out of a credential that cannot be recovered:
 * being unable to check what was typed, Caps Lock, and a field that eats Enter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PasswordField } from './PasswordField'

let host: HTMLDivElement
let root: Root

function input(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('.toylock-passwordfield__input')
  if (!el) throw new Error('no password input rendered')
  return el
}

function revealButton(): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>('.toylock-passwordfield__reveal')
  if (!el) throw new Error('no reveal button rendered')
  return el
}

function type(value: string): void {
  act(() => {
    const el = input()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** A key event carrying a modifier state, the way a real keyboard delivers one. */
function key(name: string, opts: { capsLock?: boolean } = {}): void {
  act(() => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
    Object.defineProperty(event, 'getModifierState', {
      value: (mod: string) => mod === 'CapsLock' && opts.capsLock === true
    })
    input().dispatchEvent(event)
  })
}

function render(ui: React.ReactElement): void {
  act(() => root.render(ui))
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

describe('PasswordField', () => {
  it('masks by default and reveals only when asked', () => {
    render(<PasswordField label="Password" value="hunter2" onChange={() => {}} />)
    expect(input().type).toBe('password')
    expect(revealButton().getAttribute('aria-label')).toBe('Show password')

    act(() => revealButton().click())
    expect(input().type).toBe('text')
    // The name says what the button does NEXT, which is what a screen-reader user needs.
    expect(revealButton().getAttribute('aria-label')).toBe('Hide password')
    expect(revealButton().getAttribute('aria-pressed')).toBe('true')

    act(() => revealButton().click())
    expect(input().type).toBe('password')
  })

  it('starts masked again on a fresh mount, never carrying a reveal over', () => {
    // A revealed password is on screen for anyone behind the user, and for any capture the app
    // takes of itself. Remembering the toggle would leak it into the next dialog.
    render(<PasswordField label="Password" value="a" onChange={() => {}} />)
    act(() => revealButton().click())
    expect(input().type).toBe('text')
    act(() => root.unmount())
    root = createRoot(host)
    render(<PasswordField label="Password" value="a" onChange={() => {}} />)
    expect(input().type).toBe('password')
  })

  it('warns while Caps Lock is on, and stops when it is off', () => {
    render(<PasswordField label="Password" value="" onChange={() => {}} />)
    expect(document.querySelector('.toylock-field__warn')).toBeNull()
    key('a', { capsLock: true })
    expect(document.querySelector('.toylock-field__warn')?.textContent).toContain('Caps Lock')
    key('a', { capsLock: false })
    expect(document.querySelector('.toylock-field__warn')).toBeNull()
  })

  it('submits on Enter, but only when it is the last field', () => {
    const onSubmit = vi.fn()
    render(<PasswordField label="Password" value="x" onChange={() => {}} onSubmit={onSubmit} />)
    key('Enter')
    expect(onSubmit).toHaveBeenCalledTimes(1)

    // No onSubmit: this field is followed by another (a second factor), and Enter here would spend
    // a real attempt on a half-finished entry.
    act(() => root.unmount())
    root = createRoot(host)
    render(<PasswordField label="Password" value="x" onChange={() => {}} />)
    key('Enter')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('refuses non-digits in a PIN as they are typed', () => {
    const onChange = vi.fn()
    render(<PasswordField label="PIN" numeric value="" onChange={onChange} />)
    type('12a3!')
    expect(onChange).toHaveBeenCalledWith('123')
  })

  it('passes everything else through unchanged', () => {
    const onChange = vi.fn()
    render(<PasswordField label="Password" value="" onChange={onChange} />)
    type('p@ss w0rd!')
    expect(onChange).toHaveBeenCalledWith('p@ss w0rd!')
  })
})
