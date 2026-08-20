// @vitest-environment jsdom
/**
 * TIME AWARENESS and MOMENTUM, as rendered surfaces.
 *
 * Both modes were switches wired to nothing: the decision functions existed and were unit-tested,
 * the CSS was finished, and nothing between them was ever written — `momentumNudge()` and
 * `snoozeUntil()` had zero production callers, and `timeAwareness` reached the settings row that
 * wrote it and nowhere else. Testing the pure functions again would prove exactly as little as it
 * proved then, so these tests mount the real production components.
 *
 * Three things are asserted that a pure test cannot reach:
 *  - the readout is GATED on the setting (off renders nothing, with activity recorded and waiting)
 *  - the momentum DECISION reaches a render, with its own text, and "Not now" writes a real
 *    timestamp that puts it away
 *  - there is ONE shared minute ticker for the whole canvas, and none at all while the modes are off
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdhdElapsedChip, AdhdMomentumNote } from './AdhdNodeSurfaces'
import { ADHD_MODES_OFF, SNOOZE_MINUTES, snoozeUntil } from '../lib/adhdModes'
import { markNodeActivity, markNodeOpened, activityTickRunning, resetNodeActivity } from '../lib/nodeActivity'
import { useSettings } from '../state/settings'
import { DEFAULT_SETTINGS, type AdhdModes } from '@shared/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MINUTE = 60_000
let host: HTMLDivElement
let root: Root

function setModes(patch: Partial<AdhdModes>): void {
  const adhdModes = { ...ADHD_MODES_OFF, ...patch }
  act(() => {
    useSettings.setState({
      settings: { ...DEFAULT_SETTINGS, adhdModes },
      base: { ...DEFAULT_SETTINGS, adhdModes },
      scope: 'global',
      activeProjectId: '',
      projectOverrides: {}
    })
  })
}

function render(ui: React.JSX.Element): void {
  act(() => root.render(ui))
}

/** Record a node whose last change was `minutes` ago and which opened `openedMinutes` ago. */
function nodeIdle(nodeId: string, minutes: number, openedMinutes = minutes): void {
  const now = Date.now()
  markNodeOpened(nodeId, now - openedMinutes * MINUTE)
  markNodeActivity(nodeId, now - minutes * MINUTE)
}

beforeEach(() => {
  resetNodeActivity()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  // update() coalesces a disk write behind a 300 ms timer. Stubbed so a "Not now" click cannot
  // reach a real IPC bridge that does not exist here.
  ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
    settings: { save: vi.fn() }
  }
  setModes({})
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------------------------
// Time awareness
// ---------------------------------------------------------------------------------------------

describe('time awareness renders elapsed time where the work is', () => {
  it('renders NOTHING while the mode is off, however long the node has been idle', () => {
    // The whole point of the gate: an accommodation that is off costs the person nothing, and a
    // clock that appears anyway has decided something for them.
    nodeIdle('n1', 90)
    render(<AdhdElapsedChip nodeId="n1" />)
    expect(host.querySelector('.adhd-elapsed')).toBeNull()
    expect(host.textContent).toBe('')
  })

  it('renders the elapsed chip once the mode is on', () => {
    nodeIdle('n1', 41)
    setModes({ timeAwareness: true })
    render(<AdhdElapsedChip nodeId="n1" />)
    const chip = host.querySelector('.adhd-elapsed')
    expect(chip).not.toBeNull()
    expect(chip?.textContent).toContain('41 min')
  })

  it('states a number and no verdict', () => {
    nodeIdle('n1', 41)
    setModes({ timeAwareness: true })
    render(<AdhdElapsedChip nodeId="n1" />)
    const chip = host.querySelector('.adhd-elapsed') as HTMLElement
    // No streak, no score, no congratulation, nothing phrased as a question with a right answer.
    expect(chip.textContent).not.toMatch(/still|streak|score|great|well done|should|why|\?/i)
    expect(chip.getAttribute('title')).not.toMatch(/still|streak|score|great|should|why|\?/i)
  })

  it('reads as a whole sentence to a screen reader, not as a bare "41 min"', () => {
    nodeIdle('n1', 41)
    setModes({ timeAwareness: true })
    render(<AdhdElapsedChip nodeId="n1" />)
    const hidden = host.querySelector('.adhd-elapsed .sr-only')
    expect(hidden?.textContent).toContain('Last change 41 min ago')
    // NOT a live region: announcing the number every minute is the nagging this feature refuses.
    expect(host.querySelector('.adhd-elapsed')?.getAttribute('aria-live')).toBeNull()
    expect(host.querySelector('.adhd-elapsed')?.getAttribute('role')).toBeNull()
  })

  it('carries the second fact in the tooltip, worded as something the app can actually know', () => {
    // A relaunch reattaches a tmux session that may be days old, so "open in this window" is the
    // only honest version of "how long has this been open".
    nodeIdle('n1', 5, 120)
    setModes({ timeAwareness: true })
    render(<AdhdElapsedChip nodeId="n1" />)
    const title = (host.querySelector('.adhd-elapsed') as HTMLElement).getAttribute('title')
    expect(title).toContain('Last change 5 min ago')
    expect(title).toContain('open in this window for 2 h')
  })

  it('says nothing about a node it has never observed, rather than guessing zero', () => {
    setModes({ timeAwareness: true })
    render(<AdhdElapsedChip nodeId="never-seen" />)
    expect(host.querySelector('.adhd-elapsed')).toBeNull()
  })

  it('appears and disappears with the setting, live', () => {
    nodeIdle('n1', 41)
    render(<AdhdElapsedChip nodeId="n1" />)
    expect(host.querySelector('.adhd-elapsed')).toBeNull()
    setModes({ timeAwareness: true })
    expect(host.querySelector('.adhd-elapsed')).not.toBeNull()
    setModes({ timeAwareness: false })
    expect(host.querySelector('.adhd-elapsed')).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// Momentum
// ---------------------------------------------------------------------------------------------

describe('momentum reaches a render, and goes away when told', () => {
  it('renders NOTHING while the mode is off', () => {
    nodeIdle('n1', 90)
    render(<AdhdMomentumNote nodeId="n1" />)
    expect(host.querySelector('.adhd-momentum')).toBeNull()
  })

  it('stays quiet until the threshold is genuinely passed', () => {
    nodeIdle('n1', 19)
    setModes({ momentum: true, momentumMinutes: 20 })
    render(<AdhdMomentumNote nodeId="n1" />)
    expect(host.querySelector('.adhd-momentum')).toBeNull()
  })

  it('renders the decision — the same text momentumNudge produced, verbatim', () => {
    nodeIdle('n1', 40)
    setModes({ momentum: true, momentumMinutes: 20 })
    render(<AdhdMomentumNote nodeId="n1" />)
    const note = host.querySelector('.adhd-momentum') as HTMLElement
    expect(note).not.toBeNull()
    expect(note.textContent).toContain('Nothing has changed here for 40 min.')
  })

  it('is non-blocking: a polite live region that takes nothing and focuses nothing', () => {
    nodeIdle('n1', 40)
    setModes({ momentum: true, momentumMinutes: 20 })
    render(<AdhdMomentumNote nodeId="n1" />)
    const note = host.querySelector('.adhd-momentum') as HTMLElement
    expect(note.getAttribute('role')).toBe('status')
    // Nothing autofocuses: the person is working in the terminal underneath.
    expect(document.activeElement).toBe(document.body)
    // No animation is authored on it, so there is nothing for reduced motion to have to suppress.
    expect(note.style.animation).toBe('')
  })

  it('"Not now" writes a real timestamp for the stated period, and the note goes', () => {
    nodeIdle('n1', 90)
    setModes({ momentum: true, momentumMinutes: 20 })
    render(<AdhdMomentumNote nodeId="n1" />)
    const before = Date.now()
    act(() => {
      ;(host.querySelector('.adhd-momentum__dismiss') as HTMLButtonElement).click()
    })
    const snoozed = useSettings.getState().settings.adhdModes.snoozeUntilMs
    // A timestamp, not a flag that clears on the next render.
    expect(snoozed).not.toBeNull()
    expect(snoozed as number).toBeGreaterThanOrEqual(snoozeUntil(before) - 2_000)
    expect(host.querySelector('.adhd-momentum')).toBeNull()
  })

  it('one "not now" quiets every node, not just the one that was clicked', () => {
    // The snooze is one setting on purpose: a person who says "not now" means it, and quieting
    // only the node they happened to click leaves the other fourteen still talking.
    nodeIdle('n1', 90)
    nodeIdle('n2', 90)
    setModes({ momentum: true, momentumMinutes: 20 })
    render(
      <>
        <AdhdMomentumNote nodeId="n1" />
        <AdhdMomentumNote nodeId="n2" />
      </>
    )
    expect(host.querySelectorAll('.adhd-momentum')).toHaveLength(2)
    act(() => {
      ;(host.querySelector('.adhd-momentum__dismiss') as HTMLButtonElement).click()
    })
    expect(host.querySelectorAll('.adhd-momentum')).toHaveLength(0)
  })

  it('a snooze that has genuinely elapsed does not keep the note away forever', () => {
    nodeIdle('n1', 90)
    setModes({
      momentum: true,
      momentumMinutes: 20,
      snoozeUntilMs: Date.now() - (SNOOZE_MINUTES + 1) * MINUTE
    })
    render(<AdhdMomentumNote nodeId="n1" />)
    expect(host.querySelector('.adhd-momentum')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// The one clock
// ---------------------------------------------------------------------------------------------

describe('one shared ticker, and none at all while the modes are off', () => {
  it('starts no timer when neither mode is on', () => {
    nodeIdle('n1', 40)
    render(
      <>
        <AdhdElapsedChip nodeId="n1" />
        <AdhdMomentumNote nodeId="n1" />
      </>
    )
    expect(activityTickRunning()).toBe(false)
  })

  it('several nodes share ONE interval — not one per node', () => {
    // A canvas routinely holds dozens of terminals. One interval each would put dozens of timers
    // on the event loop and wake React from every one of them.
    const spy = vi.spyOn(globalThis, 'setInterval')
    nodeIdle('n1', 40)
    nodeIdle('n2', 40)
    nodeIdle('n3', 40)
    setModes({ timeAwareness: true, momentum: true })
    render(
      <>
        <AdhdElapsedChip nodeId="n1" />
        <AdhdMomentumNote nodeId="n1" />
        <AdhdElapsedChip nodeId="n2" />
        <AdhdMomentumNote nodeId="n2" />
        <AdhdElapsedChip nodeId="n3" />
        <AdhdMomentumNote nodeId="n3" />
      </>
    )
    expect(activityTickRunning()).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('stops once the last reader is gone', () => {
    nodeIdle('n1', 40)
    setModes({ timeAwareness: true })
    render(<AdhdElapsedChip nodeId="n1" />)
    expect(activityTickRunning()).toBe(true)
    render(<></>)
    expect(activityTickRunning()).toBe(false)
  })

  it('stops when the mode is switched off, without an unmount', () => {
    nodeIdle('n1', 40)
    setModes({ timeAwareness: true })
    render(<AdhdElapsedChip nodeId="n1" />)
    expect(activityTickRunning()).toBe(true)
    setModes({ timeAwareness: false })
    expect(activityTickRunning()).toBe(false)
  })
})
