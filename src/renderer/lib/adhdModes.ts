import type { AdhdModes } from '@shared/types'

/**
 * ADHD modes — the pure decisions, so every one of them is testable without a canvas.
 *
 * Five independent modes, never one master switch. That is the load-bearing design choice: someone
 * may want a quieter interface without time nudges, or want the nudges precisely BECAUSE they are
 * hyperfocusing and would like interrupting. Bundled into one toggle, most people switch the whole
 * thing off to escape the single part that does not suit them, and then have none of it.
 *
 * Two rules run through everything here:
 *
 *   1. FOCUS DIMS, IT NEVER HIDES. An interface that makes work disappear is a worse problem than a
 *      busy one — especially for the person this is for, who may not remember what was there. So the
 *      strongest setting still leaves an unfocused node visible and clickable.
 *   2. THE COPY STATES FACTS, NEVER VERDICTS. "Nothing has changed here for 40 minutes" is a fact.
 *      Anything about what that means, or a streak, a score, or congratulation, is this feature
 *      deciding something about the user that it has no standing to decide.
 */

/** Nothing is on until a person turns it on. An accommodation that enables itself has decided. */
export const ADHD_MODES_OFF: AdhdModes = {
  focus: false,
  lowStimulation: false,
  timeAwareness: false,
  oneThing: false,
  momentum: false,
  focusDim: 0.55,
  momentumMinutes: 20,
  oneThingText: '',
  snoozeUntilMs: null
}

/** How far an unfocused node may fade. The ceiling is the "never hides" rule expressed as a number. */
export const FOCUS_DIM_MIN = 0.1
export const FOCUS_DIM_MAX = 0.8

/** Bounds for the momentum nudge, in minutes. */
export const MOMENTUM_MIN_MINUTES = 5
export const MOMENTUM_MAX_MINUTES = 240

/** How long "not now" is respected. Stated in the UI, not a secret. */
export const SNOOZE_MINUTES = 30

const clamp = (n: number, lo: number, hi: number): number =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo

/**
 * Normalize a stored value. settings.json is hand-editable and travels between versions, so every
 * field is re-validated rather than trusted: an out-of-range dim or a non-finite minute count would
 * otherwise reach a CSS property or a timer comparison.
 */
export function normalizeAdhdModes(raw: Partial<AdhdModes> | undefined | null): AdhdModes {
  const r = raw ?? {}
  return {
    focus: r.focus === true,
    lowStimulation: r.lowStimulation === true,
    timeAwareness: r.timeAwareness === true,
    oneThing: r.oneThing === true,
    momentum: r.momentum === true,
    focusDim: clamp(Number(r.focusDim ?? ADHD_MODES_OFF.focusDim), FOCUS_DIM_MIN, FOCUS_DIM_MAX),
    momentumMinutes: Math.round(
      clamp(
        Number(r.momentumMinutes ?? ADHD_MODES_OFF.momentumMinutes),
        MOMENTUM_MIN_MINUTES,
        MOMENTUM_MAX_MINUTES
      )
    ),
    // A person's own words. Bounded so a pasted essay cannot become the canvas chrome.
    oneThingText: typeof r.oneThingText === 'string' ? r.oneThingText.slice(0, 200) : '',
    snoozeUntilMs:
      typeof r.snoozeUntilMs === 'number' && Number.isFinite(r.snoozeUntilMs)
        ? r.snoozeUntilMs
        : null
  }
}

/** True when any mode is on — used to decide whether to do any of this work at all. */
export function anyAdhdModeOn(m: AdhdModes): boolean {
  return m.focus || m.lowStimulation || m.timeAwareness || m.oneThing || m.momentum
}

/**
 * The opacity an unfocused node renders at. `focusDim` is how much to REMOVE, so a higher slider
 * means a stronger effect, which is the direction a person expects from a control called "dim".
 *
 * Returns 1 for the focused node, and 1 for everything when focus is off — so a caller can apply
 * this unconditionally without branching, and a bug in the mode flag cannot make the canvas vanish.
 */
export function nodeOpacity(m: AdhdModes, isFocused: boolean): number {
  if (!m.focus || isFocused) return 1
  return Number((1 - clamp(m.focusDim, FOCUS_DIM_MIN, FOCUS_DIM_MAX)).toFixed(3))
}

/**
 * Which node focus mode spotlights. The SELECTED node wins over the hovered one: selection is a
 * deliberate act that survives the pointer moving away, and a spotlight that chases the mouse is
 * the opposite of what this mode is for.
 */
export function focusTargetId(
  selectedIds: readonly string[],
  hoveredId: string | null
): string | null {
  if (selectedIds.length === 1) return selectedIds[0]
  // Several selected is not a focus; leave the spotlight off rather than picking one arbitrarily.
  if (selectedIds.length > 1) return null
  return hoveredId ?? null
}

/**
 * Elapsed time as a person reads it. Deliberately coarse above an hour: the point is to make time
 * VISIBLE, and a second-by-second readout is itself a distraction.
 */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  if (hours < 24) return rem === 0 ? `${hours} h` : `${hours} h ${rem} min`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 day' : `${days} days`
}

export interface MomentumDecision {
  /** Show the nudge. */
  show: boolean
  /** Plain, factual text — never a verdict about the person. Empty when `show` is false. */
  text: string
}

/**
 * Whether to nudge about a node nobody has touched. `lastActivityMs` is a timestamp, `now` is
 * injected so this is a pure function and its tests do not depend on the clock.
 *
 * Explicitly NOT a productivity judgement: the text states elapsed time and nothing else. No streak,
 * no score, no "still working on this?", which reads as a question with a right answer.
 */
export function momentumNudge(
  m: AdhdModes,
  lastActivityMs: number | null,
  now: number
): MomentumDecision {
  const none: MomentumDecision = { show: false, text: '' }
  if (!m.momentum) return none
  // "Not now" is respected for a stated period rather than until the next render.
  if (m.snoozeUntilMs !== null && now < m.snoozeUntilMs) return none
  if (lastActivityMs === null || !Number.isFinite(lastActivityMs)) return none
  const idleMs = now - lastActivityMs
  if (idleMs < m.momentumMinutes * 60000) return none
  return { show: true, text: `Nothing has changed here for ${formatElapsed(idleMs)}.` }
}

/** The timestamp a "not now" should be respected until. */
export function snoozeUntil(now: number): number {
  return now + SNOOZE_MINUTES * 60000
}

/**
 * The CSS custom properties the modes publish. Returned as a plain map so the caller can apply them
 * to a root element and every stylesheet can read them, rather than each surface re-deriving them.
 *
 * `--nt-adhd-motion-scale` is a MULTIPLIER, not a switch: at 0 every transition collapses to
 * nothing, which composes with the platform's own reduced-motion preference instead of fighting it.
 * A user who already asked their OS for less motion has asked once and must not have to ask again,
 * so this only ever removes motion, never restores it.
 */
export function adhdCssVars(m: AdhdModes): Record<string, string> {
  const vars: Record<string, string> = {}
  if (m.lowStimulation) {
    vars['--nt-adhd-motion-scale'] = '0'
    vars['--nt-adhd-chroma'] = '0.35'
  }
  if (m.focus) {
    vars['--nt-adhd-dim'] = String(nodeOpacity(m, false))
  }
  return vars
}

/**
 * Notifications that survive low-stimulation mode. It reduces to the ones that genuinely need a
 * person — an agent BLOCKED on a permission prompt still needs answering, and silencing that would
 * make the mode cost the user real work rather than save them noise.
 */
export function allowsNotification(
  m: AdhdModes,
  kind: 'needs-you' | 'done' | 'informational'
): boolean {
  if (!m.lowStimulation) return true
  return kind === 'needs-you'
}
