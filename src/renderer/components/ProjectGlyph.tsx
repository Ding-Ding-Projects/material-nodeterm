import type { ProjectIcon } from '@shared/project-icon'
import { PROJECT_SYMBOL_IDS } from '@shared/project-icon'
import { MaterialSymbol, type MaterialSymbolName } from './MaterialSymbol'
import { MATERIAL_SYMBOLS } from './materialSymbols.generated'

// Compile-time proof that `@shared/project-icon`'s curated allowlist names only glyphs that
// really exist in this app's subsetted Material Symbols font. `@shared` can't import from
// `src/renderer` (wrong direction), so the shared module keeps `PROJECT_SYMBOL_IDS` as plain
// string literals and this file — which can see both types — is where the two are proven to
// agree. If a future edit to `PROJECT_SYMBOL_IDS` names a glyph that isn't in the generated
// codepoint map (the font was re-subsetted without it, or the id was mistyped), this line stops
// compiling instead of shipping a project badge that renders as nothing.
type _AssertSymbolIdsAreValid = (typeof PROJECT_SYMBOL_IDS)[number] extends MaterialSymbolName
  ? true
  : never
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _assertSymbolIdsAreValid: _AssertSymbolIdsAreValid = true

export interface ProjectGlyphProps {
  /** The project's icon, when it has one. Absent → render the site's pre-icon fallback. */
  icon?: ProjectIcon
  /** The project's own color — tints the icon and drives both fallbacks. Optional so a caller
   *  can suppress the fallback tint entirely. */
  color?: string
  /** Project display name — the monogram fallback's first initial. */
  name: string
  /** Content sizing (emoji font-size / MaterialSymbol size). Fallback/icon box size comes from
   *  `className`'s own CSS, same as every render site did before this component existed — this
   *  only sizes the glyph drawn inside that box. */
  size?: number
  /** Fallback shape when `icon` is absent: a plain colored dot, or a colored circle with the
   *  name's first initial. Default 'monogram' — the more common site. */
  variant?: 'dot' | 'monogram'
  /** The render site's own class — keeps that site's existing box size/position CSS in charge, so
   *  swapping in `ProjectGlyph` doesn't move or resize anything when `icon` is absent. */
  className?: string
  title?: string
}

const DEFAULT_SIZE = 16

/**
 * Runtime companion to the compile-time assertion above: even though every name
 * `sanitizeProjectIcon` accepts is drawn from `PROJECT_SYMBOL_IDS` (which the assertion proves is
 * a subset of the font), `ProjectIcon.name` is typed as a plain `string` — the persisted value
 * crossed a `project.json` boundary, so its precise literal type is gone by the time it reaches a
 * component. This looks the value up defensively rather than casting blindly, so a hypothetical
 * future drift between the allowlist and the font degrades to the plain fallback square instead
 * of `MaterialSymbol` receiving a key it doesn't have.
 */
function resolveSymbolName(name: string): MaterialSymbolName | undefined {
  return Object.prototype.hasOwnProperty.call(MATERIAL_SYMBOLS, name)
    ? (name as MaterialSymbolName)
    : undefined
}

/**
 * A project's small badge, used wherever the UI shows one beside a project's name: its custom
 * icon when it has one (emoji or a curated Material Symbol), else the fallback that render site
 * already showed before project icons existed — a plain colored dot or a colored-circle monogram
 * of the name's first letter. Every wired call site passes its own `className`, so an absent
 * `icon` reproduces that site's pre-icon markup exactly: same element, same class, same
 * conditional style.
 *
 * Ported from upstream's `feat/project-icons` branch (eneskirca/nodeterm), reworked onto this
 * fork's own Material Symbols icon set rather than upstream's `lucide-react` — see
 * `@shared/project-icon`'s header comment. The `image` icon variant is also intentionally not
 * ported here.
 */
export function ProjectGlyph({
  icon,
  color,
  name,
  size = DEFAULT_SIZE,
  variant = 'monogram',
  className,
  title
}: ProjectGlyphProps): JSX.Element {
  if (icon?.type === 'emoji') {
    return (
      <span
        className={className}
        title={title}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: Math.round(size * 0.8),
          lineHeight: 1
        }}
      >
        {icon.emoji}
      </span>
    )
  }

  if (icon?.type === 'material-symbol') {
    const symbolName = resolveSymbolName(icon.name)
    if (symbolName) {
      return (
        <span
          className={className}
          title={title}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color }}
        >
          <MaterialSymbol name={symbolName} size={size} />
        </span>
      )
    }
    // Defensive only — sanitizeProjectIcon already restricts stored names to PROJECT_SYMBOL_IDS,
    // which the module-level assertion above proves is a subset of the font. Falls through to the
    // monogram fallback below rather than rendering nothing.
  }

  if (variant === 'dot') {
    return <span className={className} style={color ? { background: color } : undefined} title={title} />
  }

  return (
    <span className={className} style={{ background: color }} title={title}>
      {(name.trim() || '?').charAt(0).toUpperCase()}
    </span>
  )
}
