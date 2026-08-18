import { parseAnyColor, toRgbString } from '@renderer/lib/color/convert'

/**
 * A translucent wash of `color`, for the sticky-note body/header and the group-frame fill.
 *
 * WHY this exists instead of the `` `${data.color}22` `` string trick it replaces: that trick is
 * only a colour when `data.color` is 6-digit hex. `data.color` is a plain `string` in `NodeData`
 * and the node context menu has offered the full picker for a while, so a note whose owner picked
 * from the RGB / HSL / OKLCH tabs stores `rgb(10, 132, 255)` — and `"rgb(10, 132, 255)22"` is not
 * a colour at all. CSS drops the whole declaration, so the note lost its tint and rendered on the
 * bare panel background while its border stayed correct: the exact "picked colour silently does
 * not apply" failure the infinite picker is supposed to make impossible.
 *
 * `undefined` (never a guessed substitute) for anything unparsable, so the element falls back to
 * its stylesheet background rather than to a wrong colour — hand-edited `project.json` is the
 * realistic source of such a value, and "degrade to nothing, never to something wrong" applies.
 */
export function alphaTint(color: string | undefined, alpha: number): string | undefined {
  if (!color) return undefined
  const rgba = parseAnyColor(color)
  if (!rgba) return undefined
  // Multiplied, not overwritten: a colour picked WITH alpha is already partly transparent, and a
  // wash of it must not become more opaque than the colour itself.
  return toRgbString({ ...rgba, a: Math.max(0, Math.min(1, rgba.a * alpha)) })
}
