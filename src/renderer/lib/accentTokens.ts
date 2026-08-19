import { contrastRatio, parseAnyColor, parseHex, toHex, type RGBA } from './color/convert'
import type { ResolvedAppTheme } from './appTheme'
import { DEFAULT_ACCENT } from '@shared/types'

export interface AccentTokens {
  accent: string
  accentHover: string
  accentText: string
  accentRgb: string
  mdPrimary: string
  mdOnPrimary: string
  mdPrimaryContainer: string
  mdOnPrimaryContainer: string
}

// The two panels a custom accent's readable roles are checked against. Post the M3-baseline
// re-seed (2026-08) these are the M3 `surface-container` literal for each theme (styles.css's
// `--panel` alias now points there too) — NOT the app's old hand-picked panel hexes, which this
// constant used to carry verbatim (`#282828` dark / `#f3efe7` light).
const PANEL: Record<ResolvedAppTheme, RGBA> = {
  dark: { r: 0x21, g: 0x1f, b: 0x26, a: 1 }, // --md-surface-container dark, #211F26
  light: { r: 0xf3, g: 0xed, b: 0xf7, a: 1 } // --md-surface-container light, #F3EDF7
}

const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 }
const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 }
const INK: RGBA = { r: 26, g: 26, b: 26, a: 1 }
/** The complete set of custom properties one call to `applyAccentTokens` publishes for a non-
 *  default accent. Exported so `accentTokens.test.ts` can assert the whole family is republished
 *  rather than duplicating this list — see that file's "a custom accent republishes the whole
 *  primary family" test, which replaced a stylesheet-side check that this file's own literals now
 *  make impossible to express in CSS alone (see the M3 foundation section of styles.css). */
export const CUSTOM_PROPERTIES = [
  '--accent',
  '--accent-hover',
  '--accent-text',
  '--accent-rgb',
  '--md-primary',
  '--md-on-primary',
  '--md-primary-container',
  '--md-on-primary-container'
] as const

function mix(from: RGBA, to: RGBA, amount: number): RGBA {
  return {
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
    a: 1
  }
}

function composite(foreground: RGBA, background: RGBA, alpha: number): RGBA {
  return mix(background, foreground, alpha)
}

/** Stay on the chosen hue's straight line toward the theme's readable pole, taking the nearest
 *  colour that clears ordinary-text contrast. This keeps a red accent red and a green accent
 *  green; it never falls back to the old blue constants just because the role is text. */
function readableAccent(accent: RGBA, background: RGBA, theme: ResolvedAppTheme): RGBA {
  // Leave a small margin for the final hex rounding; an exact 4.500 float can round one channel
  // onto the failing side when it becomes the CSS value Chromium actually paints.
  const target = 4.6
  if (contrastRatio(accent, background) >= target) return accent
  const pole = theme === 'dark' ? WHITE : INK
  for (let step = 1; step <= 100; step += 1) {
    const candidate = mix(accent, pole, step / 100)
    if (contrastRatio(candidate, background) >= target) return candidate
  }
  return pole
}

/**
 * Expand the one persisted accent into every dependent role the stylesheet cannot derive from a
 * hex custom property by itself. `null` means the hand-edited value is not a colour; callers then
 * remove their inline overrides and let the authored theme defaults win.
 */
export function accentTokens(accentValue: string, theme: ResolvedAppTheme): AccentTokens | null {
  const parsed = parseAnyColor(accentValue)
  if (!parsed) return null
  // Accent roles are opaque. Round/clamp once, then derive every role from exactly what CSS paints.
  const accentHex = toHex(parsed)
  const accent = parseHex(accentHex)
  if (!accent) return null

  const panel = PANEL[theme]
  const hover = mix(accent, theme === 'dark' ? WHITE : INK, theme === 'dark' ? 0.18 : 0.14)
  const text = readableAccent(accent, panel, theme)
  const containerBackground = composite(accent, panel, 0.16)
  const onContainer = readableAccent(accent, containerBackground, theme)
  const onPrimary =
    contrastRatio(WHITE, accent) >= contrastRatio(BLACK, accent) ? WHITE : BLACK
  const rgb = `${Math.round(accent.r)}, ${Math.round(accent.g)}, ${Math.round(accent.b)}`

  return {
    accent: accentHex,
    accentHover: toHex(hover),
    accentText: toHex(text),
    accentRgb: rgb,
    mdPrimary: accentHex,
    mdOnPrimary: toHex(onPrimary),
    mdPrimaryContainer: `rgba(${rgb}, 0.16)`,
    mdOnPrimaryContainer: toHex(onContainer)
  }
}

/** Publish (or clear) the complete accent family on `<html>`. Kept outside React so a DOM gate
 *  can verify the exact live custom properties instead of merely scanning component source. */
export function applyAccentTokens(
  root: Pick<HTMLElement, 'style'>,
  accentValue: string,
  theme: ResolvedAppTheme
): void {
  const tokens = accentTokens(accentValue, theme)
  // The persisted default is the M3 baseline seed. Leaving it to styles.css preserves BOTH
  // authored default families — dark #D0BCFF / light #6750A4 as `--md-primary`, plus every
  // deliberately tuned hover/text/container role that goes with them. Inline derivation is only
  // for a genuine override.
  if (!tokens || tokens.accent === DEFAULT_ACCENT) {
    for (const property of CUSTOM_PROPERTIES) root.style.removeProperty(property)
    return
  }
  root.style.setProperty('--accent', tokens.accent)
  root.style.setProperty('--accent-hover', tokens.accentHover)
  root.style.setProperty('--accent-text', tokens.accentText)
  root.style.setProperty('--accent-rgb', tokens.accentRgb)
  root.style.setProperty('--md-primary', tokens.mdPrimary)
  root.style.setProperty('--md-on-primary', tokens.mdOnPrimary)
  root.style.setProperty('--md-primary-container', tokens.mdPrimaryContainer)
  root.style.setProperty('--md-on-primary-container', tokens.mdOnPrimaryContainer)
}
