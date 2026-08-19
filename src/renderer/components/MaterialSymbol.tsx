import { MATERIAL_SYMBOLS, type MaterialSymbolName } from './materialSymbols.generated'

export type { MaterialSymbolName }

export type MaterialSymbolProps = {
  /** Glyph name -- must be one of the 92 icons bundled in the subsetted Material Symbols
   *  Rounded font (see scripts/material-symbols-glyphs.json). Typed against the generated
   *  codepoint map, so an unknown name is a TypeScript compile error rather than invisible
   *  tofu in a shipped build. */
  name: MaterialSymbolName
  /** Rendered size in px. Also drives the `opsz` (optical size) variable axis, clamped to the
   *  font's declared range (20-48), so a tiny icon doesn't inherit strokes tuned for 48px. */
  size?: number
  /** Filled ('FILL' 1) vs outlined ('FILL' 0) rendering -- the design uses the filled variant
   *  for active/emphasis states (e.g. the current nav destination). */
  fill?: boolean
  /** 'wght' variable axis, clamped to the font's declared range (100-700). */
  weight?: number
  /** Accessible name. When provided, the icon is exposed to assistive tech as `role="img"`
   *  with this label. When omitted (the common case -- most icons sit beside a labelled
   *  control), the icon is purely decorative and hidden from assistive tech
   *  (`aria-hidden="true"`), matching the rest of this app's icon components (see
   *  components/icons.tsx). */
  label?: string
  className?: string
  style?: React.CSSProperties
}

const OPSZ_MIN = 20
const OPSZ_MAX = 48
const WGHT_MIN = 100
const WGHT_MAX = 700

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Renders a single Material Symbols Rounded glyph from the app's locally bundled, subsetted
 * icon font (src/renderer/assets/fonts/material-symbols/material-symbols-rounded-subset.woff2
 * -- see src/renderer/fonts.css for the @font-face and scripts/build-fonts.mjs for how the
 * subset is regenerated).
 *
 * Renders the glyph's raw private-use-area CODEPOINT character, never the ligature name as
 * text -- the subset was built with GSUB/ligature substitutions stripped
 * (--layout-features=''), so a name rendered as literal text ("settings") would show as plain
 * Latin letters, not an icon.
 */
export function MaterialSymbol({
  name,
  size = 20,
  fill = false,
  weight = 400,
  label,
  className,
  style,
}: MaterialSymbolProps) {
  const char = MATERIAL_SYMBOLS[name]
  const opsz = clamp(size, OPSZ_MIN, OPSZ_MAX)
  const wght = clamp(weight, WGHT_MIN, WGHT_MAX)
  const classes = ['msr', fill ? 'msrf' : null, className ?? null].filter(Boolean).join(' ')

  return (
    <span
      className={classes}
      style={{
        fontSize: size,
        lineHeight: 1,
        direction: 'ltr',
        whiteSpace: 'nowrap',
        fontFeatureSettings: "'liga'",
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${wght}, 'GRAD' 0, 'opsz' ${opsz}`,
        userSelect: 'none',
        ...style,
      }}
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      {char}
    </span>
  )
}
