import { describe, expect, it } from 'vitest'
import {
  APPEARANCE_ANIMATION_EASINGS,
  APPEARANCE_ANIMATION_PRESETS,
  APPEARANCE_HYPHENS,
  APPEARANCE_KERNING,
  APPEARANCE_LIGATURES,
  APPEARANCE_NUMERIC_FIGURES,
  APPEARANCE_WRITING_MODES,
  type AppearanceTextStyle
} from '@shared/types'
import { animationCss, buildAppearanceStylesheet, styleToCssProperties, typographyCss } from './apply'
import { ANIMATION_LABELS, TYPE_OPTION_LABELS } from '../../components/appearance/AppearanceEditor'

describe('typographyCss', () => {
  it('maps each word-processor control to its CSS property', () => {
    expect(
      typographyCss({
        fontKerning: 'none',
        ligatures: 'discretionary',
        numericFigures: 'tabular',
        textIndentPx: 24,
        hyphens: 'auto',
        writingMode: 'vertical-rl',
        lineClamp: 2
      })
    ).toEqual({
      'font-kerning': 'none',
      'font-variant-ligatures': 'common-ligatures discretionary-ligatures',
      'font-variant-numeric': 'tabular-nums',
      'text-indent': '24px',
      hyphens: 'auto',
      'writing-mode': 'vertical-rl',
      display: '-webkit-box',
      '-webkit-box-orient': 'vertical',
      '-webkit-line-clamp': '2',
      overflow: 'hidden'
    })
  })

  it('emits nothing for an untouched style, so existing entries are byte-identical', () => {
    expect(typographyCss({})).toEqual({})
    expect(animationCss({})).toEqual({})
    expect(styleToCssProperties({ color: 'red' })).toEqual({ 'text-decoration-line': 'none', color: 'red' })
  })

  it('a hand-edited value outside the closed list never reaches the stylesheet', () => {
    const forged = {
      writingMode: 'x; } body { display: none',
      ligatures: 'none} *{color:red',
      animationPreset: 'pulse 1s; } html { display:none',
      textIndentPx: Number.NaN,
      lineClamp: '3' as unknown as number
    } as unknown as AppearanceTextStyle
    const sheet = buildAppearanceStylesheet({ a: { label: 'A', kind: 'tab', updatedAt: 0, style: forged } })
    expect(sheet).not.toContain('display: none')
    expect(sheet).not.toContain('color:red')
    expect(sheet).not.toContain('nt-appearance')
    expect(sheet).not.toContain('text-indent')
  })

  it('clamps numbers into their ranges', () => {
    expect(typographyCss({ textIndentPx: 9999 })['text-indent']).toBe('200px')
    expect(typographyCss({ lineClamp: 0 })).toEqual({})
  })
})

describe('animationCss', () => {
  it('builds one named loop with defaults', () => {
    expect(animationCss({ animationPreset: 'float' })).toEqual({
      animation: 'nt-appearance-float 1600ms ease-in-out 0ms infinite both'
    })
    expect(
      animationCss({ animationPreset: 'spin', animationDurationMs: 800, animationDelayMs: 200, animationIterations: 3, animationEasing: 'spring' })
    ).toEqual({ animation: 'nt-appearance-spin 800ms cubic-bezier(0.38, 1.21, 0.22, 1) 200ms 3 both' })
  })
})

describe('editor labels', () => {
  it('every closed-list value has a human label', () => {
    const pairs: [readonly string[], Record<string, string>][] = [
      [APPEARANCE_KERNING, TYPE_OPTION_LABELS.fontKerning],
      [APPEARANCE_LIGATURES, TYPE_OPTION_LABELS.ligatures],
      [APPEARANCE_NUMERIC_FIGURES, TYPE_OPTION_LABELS.numericFigures],
      [APPEARANCE_HYPHENS, TYPE_OPTION_LABELS.hyphens],
      [APPEARANCE_WRITING_MODES, TYPE_OPTION_LABELS.writingMode],
      [APPEARANCE_ANIMATION_PRESETS, ANIMATION_LABELS.animationPreset],
      [APPEARANCE_ANIMATION_EASINGS, ANIMATION_LABELS.animationEasing]
    ]
    for (const [list, labels] of pairs) for (const v of list) expect(labels[v], v).toBeTruthy()
  })
})

describe('stylesheet value guard', () => {
  it('drops a free-text value that tries to close the rule, keeping the rest', () => {
    const sheet = buildAppearanceStylesheet({
      a: { label: 'A', kind: 'tab', updatedAt: 0, style: { fontFamily: 'x; } body { display: none', color: 'red' } }
    })
    expect(sheet).not.toContain('display: none')
    expect(sheet).not.toContain('font-family')
    expect(sheet).toContain('color: red !important;')
  })

  it('a font stack with quotes and commas is still allowed', () => {
    const sheet = buildAppearanceStylesheet({ a: { label: 'A', kind: 'tab', updatedAt: 0, style: { fontFamily: '"Outfit", sans-serif' } } })
    expect(sheet).toContain('font-family: "Outfit", sans-serif !important;')
  })
})

describe('preset import keeps every documented key', () => {
  it('round-trips compositing, type and animation fields', async () => {
    const { parseImportFile } = await import('../../state/appearance')
    const style = { opacity: 0.5, rotateDeg: 10, blendMode: 'multiply', ligatures: 'none', animationPreset: 'pulse', animationIterations: 2 }
    const r = parseImportFile(JSON.stringify({ presets: [{ name: 'P', style }] }), [])
    expect(r.imported[0].style).toEqual(style)
  })
})
