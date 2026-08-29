import { describe, it, expect } from 'vitest'
import {
  ADHD_MODES_OFF,
  FOCUS_DIM_MAX,
  FOCUS_DIM_MIN,
  MOMENTUM_MAX_MINUTES,
  MOMENTUM_MIN_MINUTES,
  SNOOZE_MINUTES,
  adhdCssVars,
  allowsNotification,
  anyAdhdModeOn,
  focusTargetId,
  formatElapsed,
  momentumNudge,
  nodeOpacity,
  normalizeAdhdModes,
  snoozeUntil
} from './adhdModes'

const on = (patch: Partial<typeof ADHD_MODES_OFF>) => ({ ...ADHD_MODES_OFF, ...patch })

describe('ADHD modes — defaults and independence', () => {
  it('every mode is off by default', () => {
    // An accommodation that enables itself has decided something about the user it cannot know.
    expect(ADHD_MODES_OFF.focus).toBe(false)
    expect(ADHD_MODES_OFF.lowStimulation).toBe(false)
    expect(ADHD_MODES_OFF.timeAwareness).toBe(false)
    expect(ADHD_MODES_OFF.oneThing).toBe(false)
    expect(ADHD_MODES_OFF.momentum).toBe(false)
    expect(anyAdhdModeOn(ADHD_MODES_OFF)).toBe(false)
  })

  it('each mode is independent — one on does not imply another', () => {
    // The whole design rests on this. If enabling focus quietly enabled low stimulation, a person
    // who wanted a spotlight would also lose their notifications, and would turn both off.
    const focusOnly = on({ focus: true })
    expect(anyAdhdModeOn(focusOnly)).toBe(true)
    expect(focusOnly.lowStimulation).toBe(false)
    expect(allowsNotification(focusOnly, 'informational')).toBe(true)
    expect(adhdCssVars(focusOnly)['--nt-adhd-motion-scale']).toBeUndefined()

    const quietOnly = on({ lowStimulation: true })
    expect(nodeOpacity(quietOnly, false)).toBe(1)
  })
})

describe('focus dims, it never hides', () => {
  it('the focused node is always fully opaque', () => {
    expect(nodeOpacity(on({ focus: true, focusDim: FOCUS_DIM_MAX }), true)).toBe(1)
  })

  it('an unfocused node stays visible even at the strongest setting', () => {
    // The cap IS the "never hides" rule as a number. An interface that makes work disappear is a
    // worse problem than a busy one, especially for someone who may not recall what was there.
    const strongest = nodeOpacity(on({ focus: true, focusDim: FOCUS_DIM_MAX }), false)
    expect(strongest).toBeGreaterThan(0)
    expect(strongest).toBeCloseTo(1 - FOCUS_DIM_MAX, 5)
  })

  it('a hand-edited settings.json cannot fade a node to nothing', () => {
    // settings.json is editable and shared; 5 would otherwise reach a CSS opacity as -4.
    expect(nodeOpacity(on({ focus: true, focusDim: 5 }), false)).toBeCloseTo(1 - FOCUS_DIM_MAX, 5)
    expect(nodeOpacity(on({ focus: true, focusDim: -3 }), false)).toBeCloseTo(1 - FOCUS_DIM_MIN, 5)
    expect(nodeOpacity(on({ focus: true, focusDim: Number.NaN }), false)).toBeCloseTo(
      1 - FOCUS_DIM_MIN,
      5
    )
  })

  it('with focus off nothing is dimmed, so a flag bug cannot blank the canvas', () => {
    expect(nodeOpacity(ADHD_MODES_OFF, false)).toBe(1)
    expect(nodeOpacity(ADHD_MODES_OFF, true)).toBe(1)
  })
})

describe('what the spotlight follows', () => {
  it('a single selected node wins over the pointer', () => {
    // Selection is deliberate and survives the mouse moving away. A spotlight that chases the
    // pointer is the opposite of a focus aid.
    expect(focusTargetId(['a'], 'b')).toBe('a')
  })

  it('several selected is not a focus — no spotlight rather than an arbitrary one', () => {
    expect(focusTargetId(['a', 'b'], 'c')).toBeNull()
  })

  it('falls back to hover only when nothing is selected', () => {
    expect(focusTargetId([], 'b')).toBe('b')
    expect(focusTargetId([], null)).toBeNull()
  })
})

describe('time awareness reads like a person', () => {
  it('is coarse on purpose — a ticking readout is itself a distraction', () => {
    expect(formatElapsed(30_000)).toBe('just now')
    expect(formatElapsed(60_000)).toBe('1 min')
    expect(formatElapsed(41 * 60_000)).toBe('41 min')
    expect(formatElapsed(60 * 60_000)).toBe('1 h')
    expect(formatElapsed(95 * 60_000)).toBe('1 h 35 min')
    expect(formatElapsed(26 * 60 * 60_000)).toBe('1 day')
    expect(formatElapsed(50 * 60 * 60_000)).toBe('2 days')
  })

  it('refuses nonsense rather than rendering it', () => {
    expect(formatElapsed(-1)).toBe('')
    expect(formatElapsed(Number.NaN)).toBe('')
  })
})

describe('the momentum note states a fact and nothing more', () => {
  const NOW = 1_000_000_000

  it('says nothing until the threshold is genuinely passed', () => {
    const m = on({ momentum: true, momentumMinutes: 20 })
    expect(momentumNudge(m, NOW - 19 * 60_000, NOW).show).toBe(false)
    expect(momentumNudge(m, NOW - 21 * 60_000, NOW).show).toBe(true)
  })

  it('carries elapsed time and no verdict about the person', () => {
    const m = on({ momentum: true, momentumMinutes: 20 })
    const { text } = momentumNudge(m, NOW - 40 * 60_000, NOW)
    expect(text).toBe('Nothing has changed here for 40 min.')
    // No streak, no score, no congratulation, nothing that reads as a question with a right answer.
    expect(text).not.toMatch(/still|streak|score|great|well done|should|why/i)
  })

  it('"not now" is respected for the stated period, not until the next render', () => {
    const m = on({ momentum: true, momentumMinutes: 20, snoozeUntilMs: snoozeUntil(NOW) })
    expect(momentumNudge(m, NOW - 90 * 60_000, NOW).show).toBe(false)
    // Still quiet most of the way through the window...
    expect(momentumNudge(m, NOW - 90 * 60_000, NOW + (SNOOZE_MINUTES - 1) * 60_000).show).toBe(false)
    // ...and speaks again once it has genuinely elapsed.
    expect(momentumNudge(m, NOW - 90 * 60_000, NOW + (SNOOZE_MINUTES + 1) * 60_000).show).toBe(true)
  })

  it('says nothing when the mode is off, or when there is no activity to measure', () => {
    expect(momentumNudge(ADHD_MODES_OFF, NOW - 999 * 60_000, NOW).show).toBe(false)
    expect(momentumNudge(on({ momentum: true }), null, NOW).show).toBe(false)
  })
})

describe('low stimulation keeps the notifications that cost real work to miss', () => {
  it('silences informational and done, never needs-you', () => {
    const m = on({ lowStimulation: true })
    expect(allowsNotification(m, 'informational')).toBe(false)
    expect(allowsNotification(m, 'done')).toBe(false)
    // An agent blocked on a permission prompt still needs answering. Silencing that would make the
    // mode cost the user work rather than save them noise.
    expect(allowsNotification(m, 'needs-you')).toBe(true)
  })

  it('changes nothing while off', () => {
    for (const k of ['needs-you', 'done', 'informational'] as const) {
      expect(allowsNotification(ADHD_MODES_OFF, k)).toBe(true)
    }
  })

  it('only ever REMOVES motion, so it composes with the platform preference', () => {
    // Publishing a scale of 0 can compose with prefers-reduced-motion; publishing a restored
    // duration would override a user who already asked their OS once.
    expect(adhdCssVars(on({ lowStimulation: true }))['--nt-adhd-motion-scale']).toBe('0')
    expect(adhdCssVars(ADHD_MODES_OFF)['--nt-adhd-motion-scale']).toBeUndefined()
  })
})

describe('normalizing what is on disk', () => {
  it('an absent or garbage record is every mode off, not a crash', () => {
    expect(normalizeAdhdModes(undefined)).toEqual(ADHD_MODES_OFF)
    expect(normalizeAdhdModes(null)).toEqual(ADHD_MODES_OFF)
    expect(normalizeAdhdModes({} as never)).toEqual(ADHD_MODES_OFF)
  })

  it('only a literal true enables a mode', () => {
    // Truthy is not the same as chosen — a migrated string must not silently switch something on.
    const m = normalizeAdhdModes({ focus: 'yes', momentum: 1 } as never)
    expect(m.focus).toBe(false)
    expect(m.momentum).toBe(false)
  })

  it('clamps the numbers a person can hand-edit', () => {
    const m = normalizeAdhdModes({ focusDim: 99, momentumMinutes: 0 } as never)
    expect(m.focusDim).toBe(FOCUS_DIM_MAX)
    expect(m.momentumMinutes).toBe(MOMENTUM_MIN_MINUTES)
    expect(normalizeAdhdModes({ momentumMinutes: 9999 } as never).momentumMinutes).toBe(
      MOMENTUM_MAX_MINUTES
    )
  })

  it('bounds the next-action text so a pasted essay cannot become the chrome', () => {
    const m = normalizeAdhdModes({ oneThingText: 'x'.repeat(5000) } as never)
    expect(m.oneThingText.length).toBe(200)
    expect(normalizeAdhdModes({ oneThingText: 42 } as never).oneThingText).toBe('')
  })

  it('a non-finite snooze becomes null rather than an always-quiet nudge', () => {
    expect(normalizeAdhdModes({ snoozeUntilMs: Number.NaN } as never).snoozeUntilMs).toBeNull()
    expect(normalizeAdhdModes({ snoozeUntilMs: 'soon' } as never).snoozeUntilMs).toBeNull()
    expect(normalizeAdhdModes({ snoozeUntilMs: 123 } as never).snoozeUntilMs).toBe(123)
  })
})
