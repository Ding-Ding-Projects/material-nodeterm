import type { AppearanceTextStyle, ElementAppearanceEntry } from '@shared/types'

/**
 * Turns a style bag into CSS. One function, two callers: the live stylesheet injector
 * (`AppearanceStyleInjector`) generates a `[data-appearance-id="…"] { … }` rule per entry, and the
 * editor's own live preview uses the same function so what you see while editing is exactly what
 * ships. See docs/appearance.md for the CSS-capability notes referenced in the comments below.
 */

function px(n: number | undefined): string | undefined {
  return n == null ? undefined : `${n}px`
}

/**
 * CSS can only express ONE `text-decoration-style`/`-color` for the whole decoration line set —
 * there is no per-line style/colour. When underline and overline/strikethrough disagree, the
 * underline's style/colour wins for the shared channel; every requested LINE (underline, overline,
 * strikethrough) still renders, just sharing that one style/colour. The user's individual choices
 * are kept in the stored style regardless — only the RENDERING is limited, and the editor says so.
 */
function decorationLines(style: AppearanceTextStyle): string[] {
  const lines: string[] = []
  if (style.underline && style.underline !== 'none') lines.push('underline')
  if (style.overline) lines.push('overline')
  if (style.strikethrough && style.strikethrough !== 'none') lines.push('line-through')
  return lines
}

export function styleToCssProperties(style: AppearanceTextStyle): Record<string, string> {
  const out: Record<string, string> = {}
  if (style.fontFamily) out['font-family'] = style.fontFamily
  if (style.fontSizePx != null) out['font-size'] = px(style.fontSizePx)!
  if (style.fontWeight != null) out['font-weight'] = String(style.fontWeight)
  if (style.italic) out['font-style'] = 'italic'
  if (style.fontAxes && Object.keys(style.fontAxes).length > 0) {
    const parts = Object.entries(style.fontAxes)
      .filter(([, v]) => v != null)
      .map(([axis, v]) => `'${axis}' ${v}`)
    if (parts.length) out['font-variation-settings'] = parts.join(', ')
  }
  const lines = decorationLines(style)
  if (lines.length) {
    out['text-decoration-line'] = lines.join(' ')
    out['text-decoration-style'] =
      style.underline && style.underline !== 'none' && style.underline !== 'solid'
        ? style.underline
        : style.strikethrough === 'double'
          ? 'double'
          : 'solid'
    out['text-decoration-color'] = style.underlineColor ?? style.color ?? 'currentColor'
  } else {
    out['text-decoration-line'] = 'none'
  }
  if (style.capitalization === 'small-caps') out['font-variant-caps'] = 'small-caps'
  else if (style.capitalization && style.capitalization !== 'none')
    out['text-transform'] = style.capitalization
  if (style.verticalAlign && style.verticalAlign !== 'baseline')
    out['vertical-align'] = style.verticalAlign
  if (style.baselineShiftPx != null) {
    out['position'] = 'relative'
    out['top'] = px(-style.baselineShiftPx)!
  }
  if (style.color) out['color'] = style.color
  if (style.highlightColor) out['background-color'] = style.highlightColor
  if (style.outlineColor && style.outlineWidthPx != null && style.outlineWidthPx > 0) {
    // -webkit-text-stroke is a Chromium/WebKit extension, not standard CSS — but this app ships
    // exclusively on Chromium (Electron + browsers that run the Server Edition), so it is a real,
    // reliably-supported mechanism here rather than a platform gamble.
    out['-webkit-text-stroke'] = `${style.outlineWidthPx}px ${style.outlineColor}`
  }
  const shadows: string[] = []
  if (style.shadowColor) {
    shadows.push(
      `${px(style.shadowOffsetXPx ?? 0)} ${px(style.shadowOffsetYPx ?? 0)} ${px(style.shadowBlurPx ?? 0)} ${style.shadowColor}`
    )
  }
  if (style.glowColor) {
    shadows.push(`0px 0px ${px(style.glowBlurPx ?? 8)} ${style.glowColor}`)
  }
  if (shadows.length) out['text-shadow'] = shadows.join(', ')
  if (style.letterSpacingPx != null) out['letter-spacing'] = px(style.letterSpacingPx)!
  if (style.wordSpacingPx != null) out['word-spacing'] = px(style.wordSpacingPx)!
  if (style.lineHeight != null) out['line-height'] = String(style.lineHeight)
  if (style.direction) out['direction'] = style.direction
  if (style.textAlign) out['text-align'] = style.textAlign
  if (style.backgroundColor) out['background-color'] = style.backgroundColor
  if (style.borderColor) out['border-color'] = style.borderColor
  if (style.borderRadiusPx != null) out['border-radius'] = px(style.borderRadiusPx)!
  // --- Compositing. Each is emitted only when set, so an entry that touches none of them
  // produces byte-identical CSS to before this existed.
  if (style.opacity != null) out['opacity'] = String(style.opacity)
  if (style.blendMode && style.blendMode !== 'normal') out['mix-blend-mode'] = style.blendMode

  // A filter STACK, composed in a fixed order. CSS filter is a single property, so two
  // independent controls writing it would clobber each other -- this is the one place they meet.
  const filters: string[] = []
  if (style.filterBrightness != null) filters.push(`brightness(${style.filterBrightness})`)
  if (style.filterContrast != null) filters.push(`contrast(${style.filterContrast})`)
  if (style.filterSaturate != null) filters.push(`saturate(${style.filterSaturate})`)
  if (style.filterHueRotateDeg != null) filters.push(`hue-rotate(${style.filterHueRotateDeg}deg)`)
  if (style.filterGrayscale != null) filters.push(`grayscale(${style.filterGrayscale})`)
  if (style.filterInvert != null) filters.push(`invert(${style.filterInvert})`)
  if (style.filterSepia != null) filters.push(`sepia(${style.filterSepia})`)
  if (style.filterBlurPx != null) filters.push(`blur(${style.filterBlurPx}px)`)
  if (filters.length) out['filter'] = filters.join(' ')

  if (style.backdropBlurPx != null) out['backdrop-filter'] = `blur(${style.backdropBlurPx}px)`

  // --- Transform, same reasoning: one CSS property, fixed composition order, so a saved entry
  // means exactly one thing. Order is translate, rotate, scale, skew.
  const tf: string[] = []
  if (style.translateXPx != null || style.translateYPx != null) {
    tf.push(`translate(${style.translateXPx ?? 0}px, ${style.translateYPx ?? 0}px)`)
  }
  if (style.rotateDeg != null) tf.push(`rotate(${style.rotateDeg}deg)`)
  if (style.scaleX != null || style.scaleY != null) {
    tf.push(`scale(${style.scaleX ?? 1}, ${style.scaleY ?? 1})`)
  }
  if (style.skewXDeg != null || style.skewYDeg != null) {
    tf.push(`skew(${style.skewXDeg ?? 0}deg, ${style.skewYDeg ?? 0}deg)`)
  }
  if (tf.length) out['transform'] = tf.join(' ')
  if (style.transformOrigin) out['transform-origin'] = style.transformOrigin

  return out
}

/** React inline-style object (camelCase-agnostic — React accepts a plain CSS-property-keyed
 *  object as long as the values are strings, which is exactly what `styleToCssProperties`
 *  returns; kebab-case custom properties and vendor-prefixed keys work in React's style prop). */
export function styleToReactStyle(style: AppearanceTextStyle): React.CSSProperties {
  return styleToCssProperties(style) as unknown as React.CSSProperties
}

function cssDeclarations(style: AppearanceTextStyle): string {
  const props = styleToCssProperties(style)
  return Object.entries(props)
    .map(([k, v]) => `${k}: ${v} !important;`)
    .join(' ')
}

function escapeSelector(id: string): string {
  // CSS.escape isn't available in every context this runs (it is, in Electron/Chromium — kept as
  // a defensive fallback so a malformed id can never break the WHOLE generated stylesheet).
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&')
}

/**
 * Resolves an entry's effective style, following ONE hop of `inheritFrom` for any property the
 * entry itself leaves unset. A self-reference or a missing target is treated as "no inheritance"
 * — this is deliberately not a full chain-walk (a cycle would hang it), one hop is what the editor
 * UI exposes and is enough to model "match another tab's look".
 */
export function resolveEffectiveStyle(
  id: string,
  entries: Record<string, ElementAppearanceEntry>
): AppearanceTextStyle {
  const entry = entries[id]
  if (!entry) return {}
  if (!entry.inheritFrom || entry.inheritFrom === id) return entry.style
  const parent = entries[entry.inheritFrom]
  if (!parent) return entry.style
  return { ...parent.style, ...entry.style }
}

/** Builds the full generated stylesheet text for every persisted element entry. */
export function buildAppearanceStylesheet(entries: Record<string, ElementAppearanceEntry>): string {
  const rules: string[] = []
  for (const id of Object.keys(entries)) {
    const style = resolveEffectiveStyle(id, entries)
    const decls = cssDeclarations(style)
    if (!decls) continue
    rules.push(`[data-appearance-id="${escapeSelector(id)}"] { ${decls} }`)
  }
  return rules.join('\n')
}

export function isStyleEmpty(style: AppearanceTextStyle): boolean {
  return Object.keys(style).length === 0
}
