// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { contrastRatio, parseAnyColor, type RGBA } from './color/convert'
import { accentTokens, applyAccentTokens, CUSTOM_PROPERTIES } from './accentTokens'

// Mirrors accentTokens.ts's own PANEL, deliberately duplicated rather than imported (a test that
// imports its fixture from the module under test cannot notice the module's own value drifting).
// M3-baseline re-seed (2026-08): these are the M3 `--md-surface-container` literal per theme, not
// the app's old hand-picked panel hexes (`#282828` dark / `#f3efe7` light) this used to carry.
const PANEL: Record<'dark' | 'light', RGBA> = {
  dark: { r: 0x21, g: 0x1f, b: 0x26, a: 1 }, // #211F26
  light: { r: 0xf3, g: 0xed, b: 0xf7, a: 1 } // #F3EDF7
}

function parsed(value: string): RGBA {
  const result = parseAnyColor(value)
  if (!result) throw new Error(`expected a colour, got ${value}`)
  return result
}

function container(accent: RGBA, panel: RGBA): RGBA {
  return {
    r: panel.r + (accent.r - panel.r) * 0.16,
    g: panel.g + (accent.g - panel.g) * 0.16,
    b: panel.b + (accent.b - panel.b) * 0.16,
    a: 1
  }
}

afterEach(() => document.documentElement.removeAttribute('style'))

describe('accentTokens', () => {
  it.each(['dark', 'light'] as const)('derives readable text and container roles from a green accent on %s', (theme) => {
    const tokens = accentTokens('#32d74b', theme)
    expect(tokens).not.toBeNull()
    expect(tokens!.accent).toBe('#32d74b')
    expect(tokens!.accentRgb).toBe('50, 215, 75')
    expect(tokens!.mdPrimary).toBe('#32d74b')
    expect(tokens!.mdPrimaryContainer).toBe('rgba(50, 215, 75, 0.16)')
    // These were frozen blue before this resolver existed. A green selection must keep its own
    // hue across both dependent text roles, not merely update the solid fill.
    expect(tokens!.accentText).not.toMatch(/^(#6cb0ff|#0060df)$/i)
    expect(tokens!.mdOnPrimaryContainer).not.toMatch(/^(#6cb0ff|#004fb8)$/i)

    const panel = PANEL[theme]
    const accent = parsed(tokens!.accent)
    expect(contrastRatio(parsed(tokens!.accentText), panel)).toBeGreaterThanOrEqual(4.5)
    expect(
      contrastRatio(parsed(tokens!.mdOnPrimaryContainer), container(accent, panel))
    ).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(parsed(tokens!.mdOnPrimary), accent)).toBeGreaterThanOrEqual(4.5)
  })

  it('moves hover and readable roles when the theme surface changes', () => {
    const dark = accentTokens('#ffd60a', 'dark')!
    const light = accentTokens('#ffd60a', 'light')!
    expect(dark.accentHover).not.toBe(light.accentHover)
    expect(dark.accentText).not.toBe(light.accentText)
    expect(dark.mdOnPrimaryContainer).not.toBe(light.mdOnPrimaryContainer)
  })

  it('keeps every shipped accent swatch readable across every dependent text role', () => {
    // '#6750a4' is the current default (M3 seed); '#0a84ff' is the pre-M3 default, kept reachable
    // as an ordinary swatch — both still need to work as a CUSTOM accent choice, not just whichever
    // one happens to be shipped as default this release.
    const accents = ['#6750a4', '#0a84ff', '#32d74b', '#ffd60a', '#ff453a', '#bf5af2', '#64d2ff']
    for (const theme of ['dark', 'light'] as const) {
      for (const value of accents) {
        const tokens = accentTokens(value, theme)!
        const accent = parsed(tokens.accent)
        const panel = PANEL[theme]
        expect(contrastRatio(parsed(tokens.mdOnPrimary), accent), `${theme} ${value} fill`).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(parsed(tokens.accentText), panel), `${theme} ${value} text`).toBeGreaterThanOrEqual(4.5)
        expect(
          contrastRatio(parsed(tokens.mdOnPrimaryContainer), container(accent, panel)),
          `${theme} ${value} container`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('applyAccentTokens', () => {
  it('publishes the complete live family onto the document root', () => {
    const root = document.documentElement
    applyAccentTokens(root, '#bf5af2', 'dark')
    expect(root.style.getPropertyValue('--accent')).toBe('#bf5af2')
    expect(root.style.getPropertyValue('--accent-rgb')).toBe('191, 90, 242')
    expect(root.style.getPropertyValue('--md-primary')).toBe('#bf5af2')
    expect(root.style.getPropertyValue('--md-primary-container')).toBe('rgba(191, 90, 242, 0.16)')
    expect(root.style.getPropertyValue('--accent-text')).not.toBe('')
    expect(root.style.getPropertyValue('--md-on-primary-container')).not.toBe('')
  })

  it('a custom accent republishes the whole primary family', () => {
    // Replaces a stylesheet-side check ("themed container roles stay derived from their theme's
    // own RGB triple", styles.theme.test.ts) that verified a custom accent's container role
    // stayed live via a CSS-side `rgba(var(--accent-rgb), α)` tint. The M3-baseline re-seed makes
    // `--md-primary-container` an opaque design LITERAL in the stylesheet (see styles.css's M3
    // foundation section), so that CSS-cascade relationship no longer exists — a custom accent
    // reaches every dependent role ONLY because this function sets each one explicitly, inline.
    // This is the stronger, more direct guarantee: every member of `CUSTOM_PROPERTIES` is actually
    // published, not merely that a stylesheet declaration happens to reference the right variable.
    const root = document.documentElement
    applyAccentTokens(root, '#32d74b', 'dark')
    for (const name of CUSTOM_PROPERTIES) {
      expect(root.style.getPropertyValue(name), name).not.toBe('')
    }
  })

  it('clears every inline override for an invalid hand-edited value', () => {
    const root = document.documentElement
    applyAccentTokens(root, '#ff453a', 'dark')
    applyAccentTokens(root, 'definitely not css', 'light')
    for (const name of CUSTOM_PROPERTIES) {
      expect(root.style.getPropertyValue(name), name).toBe('')
    }
  })

  it('leaves the default accent family to the authored dark/light stylesheet values', () => {
    const root = document.documentElement
    applyAccentTokens(root, '#bf5af2', 'dark')
    applyAccentTokens(root, '#6750a4', 'light')
    expect(root.getAttribute('style')).toBe('')
  })
})
