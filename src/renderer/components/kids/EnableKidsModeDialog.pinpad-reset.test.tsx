// @vitest-environment jsdom
//
// A first-time user could not turn Kids mode on at all, and nothing said so.
//
// PinPad keeps the typed digits in its OWN state, and `push()` early-returns once that reaches
// `length`. EnableKidsModeDialog rendered ONE PinPad for both steps with no `key`, so React reused
// the instance: the confirm step arrived still holding the four digits chosen a moment earlier,
// every tap on it was ignored, `onComplete` never fired again, and the dialog sat there looking
// perfectly fine. Found by trying to photograph the Kids screens — the capture driver chose a PIN,
// confirmed it, and the shell never appeared.
//
// What is pinned here is the COMPONENT CONTRACT the dialog depends on, not the dialog's own JSX,
// because the contract is the part a later refactor can quietly break again: a full pad accepts
// nothing more, so any surface showing a PinPad twice in a row owes it a fresh instance.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PinPad } from './PinPad'
import { EnableKidsModeDialogHost } from './EnableKidsModeDialog'
import { useEnableKidsDialog } from './entry'
import { useKidsMode } from '../../state/kidsMode'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

function mount(ui: React.ReactNode): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(ui))
}

/** Tap real digit keys, then let PinPad's 60ms paint delay run so onComplete can fire. */
function tap(digits: string): void {
  for (const d of digits) {
    const key = host!.querySelector<HTMLButtonElement>(`[aria-label="Digit ${d}"]`)
    if (!key) throw new Error(`no key for digit ${d}`)
    act(() => key.click())
  }
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 150))
  })
}

describe('PinPad completion, and reusing one across steps', () => {
  it('hands the caller the completed PIN exactly once', async () => {
    const onComplete = vi.fn()
    mount(<PinPad length={4} onComplete={onComplete} ariaLabel="Choose a 4-digit PIN" />)

    tap('1234')
    await settle()

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith('1234')
  })

  it('a full pad ignores further digits — the mechanism behind the defect', async () => {
    const onComplete = vi.fn()
    mount(<PinPad length={4} onComplete={onComplete} ariaLabel="Choose a 4-digit PIN" />)

    tap('1234')
    await settle()
    expect(onComplete).toHaveBeenCalledTimes(1)

    // Correct in isolation — and fatal the moment a second step reuses this same instance.
    tap('5678')
    await settle()
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('a step change that REMOUNTS the pad accepts the second PIN', async () => {
    const onComplete = vi.fn()

    // `key` changing per step is exactly what EnableKidsModeDialog now does.
    mount(<PinPad key="choose" length={4} onComplete={onComplete} ariaLabel="Choose a 4-digit PIN" />)
    tap('1234')
    await settle()
    expect(onComplete).toHaveBeenCalledTimes(1)

    act(() =>
      root!.render(
        <PinPad key="confirm" length={4} onComplete={onComplete} ariaLabel="Confirm the 4-digit PIN" />
      )
    )
    tap('1234')
    await settle()

    expect(onComplete).toHaveBeenCalledTimes(2)
    expect(onComplete).toHaveBeenLastCalledWith('1234')
  })

  it('WITHOUT a key the second step is dead — the exact shipped defect', async () => {
    const onComplete = vi.fn()

    mount(<PinPad length={4} onComplete={onComplete} ariaLabel="Choose a 4-digit PIN" />)
    tap('1234')
    await settle()
    expect(onComplete).toHaveBeenCalledTimes(1)

    // No key: React reuses the instance, so it is still full and every tap is swallowed.
    act(() =>
      root!.render(<PinPad length={4} onComplete={onComplete} ariaLabel="Confirm the 4-digit PIN" />)
    )
    tap('1234')
    await settle()

    // Pinned deliberately: this records WHY the key is required. If PinPad ever clears itself on an
    // ariaLabel change, THIS expectation is the one to revisit — not the key in the dialog.
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})

// ── The dialog itself ────────────────────────────────────────────────────────────────────────
// The tests above pin PinPad's contract; this one pins the thing that actually broke. Without it,
// deleting `key={step}` from the dialog leaves every test above green while a first-time user
// still cannot enable Kids mode — a guard that cannot see the defect it was written for.
describe('EnableKidsModeDialog drives choose -> confirm end to end', () => {
  it('a first-time user can choose a PIN, confirm it, and enable the mode', async () => {
    const enable = vi.fn().mockResolvedValue({ ok: true })
    useKidsMode.setState({ enable } as never)
    useEnableKidsDialog.getState().show()

    mount(<EnableKidsModeDialogHost />)
    await settle()

    // The pad is portalled to document.body, so query from there rather than the mount host.
    const key = (d: string) =>
      document.body.querySelector<HTMLButtonElement>(`[aria-label="Digit ${d}"]`)
    const tapBody = (digits: string) => {
      for (const d of digits) {
        const el = key(d)
        if (!el) throw new Error(`no key for digit ${d}`)
        act(() => el.click())
      }
    }

    expect(document.body.querySelector('[aria-label="Choose a 4-digit PIN"]')).toBeTruthy()
    tapBody('1234')
    await settle()

    // Step advanced — this much worked even with the defect.
    expect(document.body.querySelector('[aria-label="Confirm the 4-digit PIN"]')).toBeTruthy()

    // And THIS is what a reused pad swallowed: the confirm digits never reached onComplete, so
    // enable() was never called and the dialog stayed open forever.
    tapBody('1234')
    await settle()

    expect(enable).toHaveBeenCalledTimes(1)
    expect(enable).toHaveBeenCalledWith('1234')
  })
})
