// @vitest-environment jsdom
//
// The colour surface used by the sticky-note chip, the group-frame dot and the tab caret menu.
// What is being pinned is the BEHAVIOUR the "infinite colour picker" contract is made of, driven
// through the real ContextMenu + ColorPicker rather than asserted against source text:
//   1. the full picker opens on the target's CURRENT colour, not on a preset;
//   2. a colour applies LIVE and the surface stays open, because a colour is chosen by seeing it;
//   3. the surface dismisses only on the backdrop or Escape;
//   4. Escape does not also reach the canvas underneath.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ColorMenu } from './ColorMenu'
import { NODE_COLORS } from '../../state/workspace'

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

afterEach(() => {
  if (root) act(() => root?.unmount())
  document.body.replaceChildren()
  root = undefined
})

function render(props: {
  value?: string
  onPick: (c: string) => void
  onClose: () => void
}): void {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(<ColorMenu x={20} y={30} {...props} />))
}

function q<T extends Element>(selector: string): T {
  const el = document.body.querySelector<T>(selector)
  if (!el) throw new Error(`missing ${selector}`)
  return el
}

function openFullPicker(): void {
  act(() => {
    q<HTMLButtonElement>('.ctx-colors__custom').dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    )
  })
}

/** Drag the hue slider — the continuous control, i.e. the thing presets can never express. */
function dragHue(to: number): void {
  const slider = q<HTMLInputElement>('.color-picker__slider--hue')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(slider, String(to))
    slider.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('ColorMenu opens the full picker on the current colour', () => {
  it('seeds the picker from the value it was given', () => {
    render({ value: '#32d74b', onPick: vi.fn(), onClose: vi.fn() })
    openFullPicker()
    expect(q<HTMLInputElement>('.color-picker__hex-input').value).toBe('#32d74b')
  })

  it('seeds from a NON-hex stored colour too', () => {
    // Storage is any CSS colour the picker can emit, so the seed path must not assume hex.
    render({ value: 'rgb(50, 215, 75)', onPick: vi.fn(), onClose: vi.fn() })
    openFullPicker()
    expect(q<HTMLInputElement>('.color-picker__hex-input').value).toBe('#32d74b')
  })

  it('falls back to a preset only when there is no current colour to open on', () => {
    // Discriminating against the seeded case above: a mutant that ignores `value` would produce
    // THIS result for every target, which is exactly the bug on the project tab menu.
    render({ onPick: vi.fn(), onClose: vi.fn() })
    openFullPicker()
    expect(q<HTMLInputElement>('.color-picker__hex-input').value).toBe(NODE_COLORS[0])
  })
})

describe('ColorMenu applies live and stays open', () => {
  it('reports every drag of the continuous picker without dismissing itself', () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    render({ value: '#0a84ff', onPick, onClose })
    openFullPicker()

    dragHue(0)
    dragHue(120)

    expect(onPick).toHaveBeenCalledTimes(2)
    // Real colours, not presets: the point of the surface.
    expect(onPick.mock.calls.map((c) => c[0])).not.toContain(NODE_COLORS[0])
    // The failure this prevents: a picker that closed on first change makes it impossible to
    // choose a colour by SEEING it applied.
    expect(onClose).not.toHaveBeenCalled()
    expect(document.body.querySelector('.color-picker')).not.toBeNull()
  })

  it('keeps the open picker alive across a host re-render caused by its own live change', () => {
    // Live application re-renders the node/tab that owns the colour, which re-renders this
    // surface with a NEW items array. Picker state lives on the menu, not the row, so the drag
    // survives; owning it on the row collapsed the picker mid-drag.
    const onPick = vi.fn()
    render({ value: '#0a84ff', onPick, onClose: vi.fn() })
    openFullPicker()
    dragHue(200)
    const picked = onPick.mock.calls[0]?.[0] as string

    act(() => root?.render(<ColorMenu x={20} y={30} value={picked} onPick={onPick} onClose={vi.fn()} />))

    expect(document.body.querySelector('.color-picker')).not.toBeNull()
    dragHue(240)
    expect(onPick).toHaveBeenCalledTimes(2)
  })

  it('still offers the presets as the fast path, which do close the surface', () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    render({ value: '#0a84ff', onPick, onClose })
    act(() => {
      document.body
        .querySelectorAll<HTMLButtonElement>('.ctx-colors button')[1]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onPick).toHaveBeenCalledWith(NODE_COLORS[1])
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ColorMenu dismisses only on the backdrop or Escape', () => {
  it('closes on the backdrop', () => {
    const onClose = vi.fn()
    render({ value: '#0a84ff', onPick: vi.fn(), onClose })
    act(() => {
      q<HTMLElement>('.ctx-backdrop').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape, and that Escape does not continue on to the canvas', () => {
    const onClose = vi.fn()
    const canvasEscape = vi.fn()
    document.addEventListener('keydown', canvasEscape)
    try {
      render({ value: '#0a84ff', onPick: vi.fn(), onClose })
      act(() => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(onClose).toHaveBeenCalledTimes(1)
      // The failure this prevents: one Escape both dismissed the picker AND cleared the canvas
      // selection / cancelled the draw tool underneath it.
      expect(canvasEscape).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', canvasEscape)
    }
  })

  it('leaves other keys alone', () => {
    const onClose = vi.fn()
    render({ value: '#0a84ff', onPick: vi.fn(), onClose })
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stops listening for Escape once it is unmounted', () => {
    // A window listener that outlives the surface would close a menu that is not there and, worse,
    // keep swallowing the canvas's Escape forever.
    const onClose = vi.fn()
    render({ value: '#0a84ff', onPick: vi.fn(), onClose })
    act(() => root?.unmount())
    root = undefined
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).not.toHaveBeenCalled()
  })
})
