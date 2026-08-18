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
 * What a component should spread onto the element it colours.
 *
 * Returns a class instead of a colour for rainbow, because the animation lives in the stylesheet
 * where `prefers-reduced-motion` can turn it off. That is not optional politeness: a continuously
 * cycling background is exactly the kind of motion the reduced-motion preference exists for, and
 * this project treats respecting it as a completion blocker rather than a nicety.
 *
 * `alpha` is the two-hex-digit suffix several call sites already append (`${color}33` for a header
 * tint). It is ignored for rainbow, which tints itself in CSS.
 */
export function nodeColorStyle(
  color: string | undefined,
  alpha = ''
): { className: string; style: { background?: string; borderColor?: string } } {
  if (isRainbowColor(color)) return { className: 'nt-rainbow', style: {} }
  return { className: '', style: { background: color ? `${color}${alpha}` : undefined } }
}

/** Border-only variant, for the node root which colours its border rather than its background. */
export function nodeBorderStyle(color: string | undefined): {
  className: string
  style: { borderColor?: string }
} {
  if (isRainbowColor(color)) return { className: 'nt-rainbow-border', style: {} }
  return { className: '', style: { borderColor: color } }
}
