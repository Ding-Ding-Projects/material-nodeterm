import { alphaTint } from '../components/color/tint'
import { contrastRatio, parseAnyColor, toRgbString, type RGBA } from './color/convert'

/**
 * Node colour, including the animated rainbow.
 *
 * `data.color` is otherwise a plain CSS colour string that components drop straight into
 * `style={{ background: color }}`. Rainbow cannot be a colour string — it is a value that changes
 * over time — so it is carried as a SENTINEL and rendered by CSS, which is the only layer that can
 * animate a hue without re-rendering React sixty times a second.
 *
 * Keeping the sentinel out of `NODE_COLORS` is deliberate: that array is the palette of literal
 * swatches, and several places iterate it expecting real colours (the popover grid, and anything
 * that mixes a colour with alpha like `${color}22`). A sentinel silently joining that list would
 * produce `rainbow22` as a CSS value, which is not an error — it is simply ignored, so the surface
 * would render with no background and nothing would say why.
 */

/** The stored value meaning "cycle the hue". Not a colour, and never concatenated with alpha. */
export const RAINBOW_COLOR = 'rainbow'

export function isRainbowColor(color: string | undefined): boolean {
  return color === RAINBOW_COLOR
}

/**
 * Speed is stored as a user-facing 1..5 rather than a duration, for the same reason the render
 * "Speed" control is 1..5: a number of seconds is a unit nobody has an intuition for, and a slider
 * that goes the wrong way (bigger number = slower) is a control people fight.
 *
 * 1 is a slow drift, 5 is fast. The mapping is documented rather than implied so the setting and
 * the stylesheet cannot disagree about what "3" means.
 */
export const RAINBOW_SPEED_MIN = 1
export const RAINBOW_SPEED_MAX = 5
export const RAINBOW_SPEED_DEFAULT = 3

const RAINBOW_SECONDS_BY_SPEED: Record<number, number> = {
  1: 24,
  2: 12,
  3: 6,
  4: 3,
  5: 1.5
}

/**
 * Seconds for one full hue rotation at `speed`. Out-of-range or hand-edited values fall back to the
 * default rather than producing `NaNs` in a CSS duration, which would silently disable the
 * animation — a settings file is hand-editable, so this is reachable.
 */
export function rainbowDurationSeconds(speed: number | undefined): number {
  const rounded = Math.round(Number(speed))
  return RAINBOW_SECONDS_BY_SPEED[rounded] ?? RAINBOW_SECONDS_BY_SPEED[RAINBOW_SPEED_DEFAULT]
}

/**
 * What a component spreads onto the element it colours.
 *
 * Two concerns that must not be solved separately, because a component picking one and forgetting
 * the other is how a colour silently fails to apply:
 *
 *  - RAINBOW is not a colour, so it returns a CLASS and no inline value. The animation lives in the
 *    stylesheet, which is where `prefers-reduced-motion` can switch it off — this project treats
 *    respecting that as a completion blocker, not a nicety.
 *  - EVERYTHING ELSE goes through `alphaTint`, never through string concatenation. `${color}33`
 *    is only a colour when the stored value is 6-digit hex, and the picker has offered rgb() and
 *    oklch() for a while, so concatenation drops the whole declaration for anyone who used them.
 *
 * `alpha` is a multiplier (0..1), matching `alphaTint` rather than the hex-suffix idiom it
 * replaced. Rainbow ignores it and tints itself in CSS.
 */
export function nodeColorStyle(
  color: string | undefined,
  alpha = 1
): { className: string; style: { background?: string } } {
  if (isRainbowColor(color)) return { className: 'nt-rainbow', style: {} }
  return { className: '', style: { background: alphaTint(color, alpha) } }
}

/** Border-only variant, for a node root that colours its border rather than its background. */
export function nodeBorderStyle(color: string | undefined): {
  className: string
  style: { borderColor?: string }
} {
  if (isRainbowColor(color)) return { className: 'nt-rainbow-border', style: {} }
  return { className: '', style: { borderColor: color } }
}

const WHITE_RGB: RGBA = { r: 255, g: 255, b: 255, a: 1 }
const BLACK_RGB: RGBA = { r: 0, g: 0, b: 0, a: 1 }

/**
 * A full-strength fill for a node's title bar, plus a foreground guaranteed readable on it.
 *
 * The header used to carry the node's colour only as a 1px `borderTopColor` — a thin outline on
 * an otherwise-dark bar, which is why a picked colour barely registered (reported 2026-08-20,
 * against a collapsed node: a gold outline, everything else default-dark). This fills the WHOLE
 * bar, so the colour choice actually reads.
 *
 * Foreground is picked, not fixed: `data.color` is anything the infinite picker can produce, from
 * near-white to near-black, and a single hardcoded text colour would go illegible on roughly half
 * of it. WCAG contrast is symmetric in neither direction, so this checks BOTH poles and keeps
 * whichever wins — which mathematically floors the guarantee at ~4.5:1 (the WCAG AA text
 * threshold): the poles' contrast curves cross at ~4.56 (white) vs ~4.60 (black) against a
 * mid-luminance background, so the max of the two never dips meaningfully below that crossing.
 * Never invent a third pole (e.g. always white, or always the on-surface token) — that reintroduces
 * exactly the illegible-on-bright-colour case this exists to close.
 *
 * The header fill is forced to fully OPAQUE (alpha 1) regardless of the colour's own alpha
 * channel: "full colour" means a solid bar, and a translucent header would let the underlying
 * surface leak through and shift the contrast math this function just computed.
 *
 * Rainbow is exempt: its background animates in the stylesheet (`.nt-rainbow`), so no single
 * foreground can be computed ahead of time. It keeps its existing low-alpha wash over the header's
 * normal surface colour, where the on-surface tokens already read fine, rather than attempting a
 * fill this function cannot keep pace with.
 */
export function nodeHeaderFillStyle(color: string | undefined): {
  /** Add to the header's className. `'nt-rainbow'` for the animated case, `''` otherwise. */
  className: string
  /** True when `style` carries a real, computed fill — callers use this to add the
   *  `--filled` class that overrides the header's default (token) text/icon colours. */
  filled: boolean
  style: { background?: string; color?: string }
} {
  if (isRainbowColor(color)) return { className: 'nt-rainbow', filled: false, style: {} }
  const rgba = color ? parseAnyColor(color) : null
  if (!rgba) return { className: '', filled: false, style: {} }
  const opaque: RGBA = { ...rgba, a: 1 }
  const fg = contrastRatio(WHITE_RGB, opaque) >= contrastRatio(BLACK_RGB, opaque) ? WHITE_RGB : BLACK_RGB
  return {
    className: '',
    filled: true,
    style: { background: toRgbString(opaque), color: toRgbString(fg) }
  }
}
