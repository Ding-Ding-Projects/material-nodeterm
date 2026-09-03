// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { useTablistKeys } from './useTablistKeys'

afterEach(cleanup)

/**
 * A chip-style strip, exactly the shape the eighteen hand-rolled tab lists had: the right roles and
 * `aria-selected`, selection driven by `onClick`, and nothing listening for a key.
 */
function ChipStrip({ orientation }: { orientation?: 'horizontal' | 'vertical' }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState('one')
  useTablistKeys(ref, orientation)
  return (
    <div ref={ref} role="tablist" aria-label="Views">
      {['one', 'two', 'three'].map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={selected === id}
          onClick={() => setSelected(id)}
        >
          {id}
        </button>
      ))}
    </div>
  )
}

/** A strip whose middle tab cannot be activated. */
function StripWithDisabled(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState('one')
  useTablistKeys(ref)
  return (
    <div ref={ref} role="tablist" aria-label="Views">
      {['one', 'two', 'three'].map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          disabled={id === 'two'}
          aria-selected={selected === id}
          onClick={() => setSelected(id)}
        >
          {id}
        </button>
      ))}
    </div>
  )
}

const tab = (name: string) => screen.getByRole('tab', { name })

describe('the arrow keys actually move, which is the whole promise of the role', () => {
  it('moves forward and selects, not merely focuses', () => {
    render(<ChipStrip />)
    tab('one').focus()
    fireEvent.keyDown(tab('one'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tab('two'))
    // Focus without selection would leave the strip looking unchanged while the keyboard user
    // believes they moved -- the half-fix that reads as working.
    expect(tab('two').getAttribute('aria-selected')).toBe('true')
  })

  it('moves backward', () => {
    render(<ChipStrip />)
    tab('one').focus()
    fireEvent.keyDown(tab('one'), { key: 'ArrowRight' })
    fireEvent.keyDown(tab('two'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tab('one'))
    expect(tab('one').getAttribute('aria-selected')).toBe('true')
  })

  it('wraps at both ends', () => {
    render(<ChipStrip />)
    tab('one').focus()
    fireEvent.keyDown(tab('one'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tab('three'))
    fireEvent.keyDown(tab('three'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tab('one'))
  })

  it('jumps to the ends with Home and End', () => {
    render(<ChipStrip />)
    tab('one').focus()
    fireEvent.keyDown(tab('one'), { key: 'End' })
    expect(document.activeElement).toBe(tab('three'))
    fireEvent.keyDown(tab('three'), { key: 'Home' })
    expect(document.activeElement).toBe(tab('one'))
  })

  it('follows the rendered axis when vertical', () => {
    render(<ChipStrip orientation="vertical" />)
    tab('one').focus()
    // The horizontal keys must do nothing here, or a vertical strip answers to both and the
    // announced orientation is a lie in the other direction.
    fireEvent.keyDown(tab('one'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tab('one'))
    fireEvent.keyDown(tab('one'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(tab('two'))
  })

  it('skips a tab that cannot be activated', () => {
    render(<StripWithDisabled />)
    tab('one').focus()
    fireEvent.keyDown(tab('one'), { key: 'ArrowRight' })
    // Landing on the disabled tab would be a dead end the user has to arrow back out of.
    expect(document.activeElement).toBe(tab('three'))
  })
})

describe('the tab order holds exactly one stop', () => {
  it('puts the selected tab in the tab order and the rest out of it', () => {
    render(<ChipStrip />)
    expect(tab('one').tabIndex).toBe(0)
    expect(tab('two').tabIndex).toBe(-1)
    expect(tab('three').tabIndex).toBe(-1)
  })

  it('moves the stop when selection changes, so Tab never walks the whole set', async () => {
    render(<ChipStrip />)
    fireEvent.click(tab('three'))
    // The tab order follows selection through a MutationObserver, which delivers on a microtask.
    // In a browser that lands long before anyone can press Tab; in a test it needs a tick, and
    // asserting synchronously here would read as the roving being broken rather than pending.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(tab('three').tabIndex).toBe(0)
    expect(tab('one').tabIndex).toBe(-1)
  })

  it('announces the rendered axis', () => {
    render(<ChipStrip orientation="vertical" />)
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('vertical')
  })
})
