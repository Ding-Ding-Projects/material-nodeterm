// Zone snapping (issue #394, v1, ported from upstream): place ONE node into a chosen region of
// the visible canvas — halves and quarters — at that region's position and size. The
// MacsyZones/FancyZones idea, scoped to the deliberate keyboard/menu gesture (a drag-time overlay
// is a later phase, not this one).
//
// The gesture is viewport-relative ("left half of what I am looking at right now"); the result is
// plain absolute node geometry that persists — a zone is a placement verb, not a live constraint.
// Pan away and the node stays where it was put.
//
// Unlike the upstream original, this module does not depend on a "maximize/restore" feature (this
// fork has none): it is self-contained, with its own margin constant and rect type.

import type { Viewport } from '@xyflow/system'

/** Screen-pixel inset kept between the viewport edge and the outermost zones. */
export const ZONE_MARGIN_PX = 24

/** Screen-pixel gap between two adjacent zones, so side-by-side nodes don't touch. */
export const ZONE_GUTTER_PX = 12

/** Below this, a "zone" is smaller than a node header — a comic strip the user has to fish back out. */
const ZONE_MIN_PX = 120

export interface FlowRect {
  x: number
  y: number
  width: number
  height: number
}

export type ZoneId =
  | 'left-half'
  | 'right-half'
  | 'top-half'
  | 'bottom-half'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

interface ZoneFraction {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Each zone as fractions of the usable (margin-inset) viewport. The menu renders in this order. */
export const ZONES: readonly { id: ZoneId; label: string; frac: ZoneFraction }[] = [
  { id: 'left-half', label: 'Left half', frac: { x0: 0, y0: 0, x1: 0.5, y1: 1 } },
  { id: 'right-half', label: 'Right half', frac: { x0: 0.5, y0: 0, x1: 1, y1: 1 } },
  { id: 'top-half', label: 'Top half', frac: { x0: 0, y0: 0, x1: 1, y1: 0.5 } },
  { id: 'bottom-half', label: 'Bottom half', frac: { x0: 0, y0: 0.5, x1: 1, y1: 1 } },
  { id: 'top-left', label: 'Top left quarter', frac: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 } },
  { id: 'top-right', label: 'Top right quarter', frac: { x0: 0.5, y0: 0, x1: 1, y1: 0.5 } },
  { id: 'bottom-left', label: 'Bottom left quarter', frac: { x0: 0, y0: 0.5, x1: 0.5, y1: 1 } },
  { id: 'bottom-right', label: 'Bottom right quarter', frac: { x0: 0.5, y0: 0.5, x1: 1, y1: 1 } }
]

const ZONES_BY_ID: ReadonlyMap<ZoneId, ZoneFraction> = new Map(ZONES.map((z) => [z.id, z.frac]))

/** Arrow-key -> zone for the keyboard chord (halves only; quarters live in the menu). */
export const ZONE_ARROW_KEYS: Readonly<Record<string, ZoneId>> = {
  ArrowLeft: 'left-half',
  ArrowRight: 'right-half',
  ArrowUp: 'top-half',
  ArrowDown: 'bottom-half'
}

/**
 * The zone's rect in FLOW coordinates, or null when the container has no usable size, the zoom is
 * degenerate, or the resulting zone is below the minimum useful size. Internal zone edges are
 * inset by half the gutter each, so two adjacent zones share one `ZONE_GUTTER_PX` gap; outer edges
 * keep the margin.
 */
export function zoneTargetRect(
  viewport: Viewport,
  containerWidth: number,
  containerHeight: number,
  zone: ZoneId,
  marginPx: number = ZONE_MARGIN_PX,
  gutterPx: number = ZONE_GUTTER_PX
): FlowRect | null {
  const frac = ZONES_BY_ID.get(zone)
  if (!frac || !(viewport.zoom > 0)) return null
  const innerW = containerWidth - marginPx * 2
  const innerH = containerHeight - marginPx * 2
  // Screen-px edges inside the margin-inset area, with internal edges pulled in by gutter/2.
  const left = marginPx + frac.x0 * innerW + (frac.x0 > 0 ? gutterPx / 2 : 0)
  const right = marginPx + frac.x1 * innerW - (frac.x1 < 1 ? gutterPx / 2 : 0)
  const top = marginPx + frac.y0 * innerH + (frac.y0 > 0 ? gutterPx / 2 : 0)
  const bottom = marginPx + frac.y1 * innerH - (frac.y1 < 1 ? gutterPx / 2 : 0)
  if (!(right - left >= ZONE_MIN_PX) || !(bottom - top >= ZONE_MIN_PX)) return null
  return {
    x: (left - viewport.x) / viewport.zoom,
    y: (top - viewport.y) / viewport.zoom,
    width: (right - left) / viewport.zoom,
    height: (bottom - top) / viewport.zoom
  }
}
