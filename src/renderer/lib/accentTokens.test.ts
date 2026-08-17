// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { contrastRatio, parseAnyColor, type RGBA } from './color/convert'
import { accentTokens, applyAccentTokens } from './accentTokens'

const PANEL: Record<'dark' | 'light', RGBA> = {
  dark: { r: 40, g: 40, b: 40, a: 1 },
  light: { r: 243, g: 239, b: 231, a: 1 }
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
    const accents = ['#0a84ff', '#32d74b', '#ffd60a', '#ff453a', '#bf5af2', '#64d2ff']
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

  it('clears every inline override for an invalid hand-edited value', () => {
    const root = document.documentElement
    applyAccentTokens(root, '#ff453a', 'dark')
    applyAccentTokens(root, 'definitely not css', 'light')
    for (const name of [
      '--accent', '--accent-hover', '--accent-text', '--accent-rgb', '--md-primary',
      '--md-on-primary', '--md-primary-container', '--md-on-primary-container'
    ]) {
      expect(root.style.getPropertyValue(name), name).toBe('')
    }
  })

  it('leaves the default accent family to the authored dark/light stylesheet values', () => {
    const root = document.documentElement
    applyAccentTokens(root, '#bf5af2', 'dark')
    applyAccentTokens(root, '#0a84ff', 'light')
    expect(root.getAttribute('style')).toBe('')
  })
})
