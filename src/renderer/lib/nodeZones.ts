// Canvas placement zones for issue #394. The gesture is viewport-relative, while the resulting
// geometry is ordinary flow coordinates that survives panning, reloads, and project sharing.

import type { Viewport } from '@xyflow/system'
import { NODE_MAXIMIZE_MARGIN_PX, type FlowRect } from './nodeMaximize'

export const ZONE_MARGIN_PX = NODE_MAXIMIZE_MARGIN_PX
export const ZONE_GUTTER_PX = 12
const ZONE_MIN_PX = 120

export type ZoneId =
  | 'left-half'
  | 'right-half'
  | 'top-half'
  | 'bottom-half'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'left-third'
  | 'center-third'
  | 'right-third'

interface ZoneFraction {
  x0: number
  y0: number
  x1: number
  y1: number
}

export const ZONES: readonly { id: ZoneId; label: string; frac: ZoneFraction }[] = [
  { id: 'left-half', label: 'Left half', frac: { x0: 0, y0: 0, x1: 0.5, y1: 1 } },
  { id: 'right-half', label: 'Right half', frac: { x0: 0.5, y0: 0, x1: 1, y1: 1 } },
  { id: 'top-half', label: 'Top half', frac: { x0: 0, y0: 0, x1: 1, y1: 0.5 } },
  { id: 'bottom-half', label: 'Bottom half', frac: { x0: 0, y0: 0.5, x1: 1, y1: 1 } },
  { id: 'top-left', label: 'Top left quarter', frac: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 } },
  { id: 'top-right', label: 'Top right quarter', frac: { x0: 0.5, y0: 0, x1: 1, y1: 0.5 } },
  { id: 'bottom-left', label: 'Bottom left quarter', frac: { x0: 0, y0: 0.5, x1: 0.5, y1: 1 } },
  { id: 'bottom-right', label: 'Bottom right quarter', frac: { x0: 0.5, y0: 0.5, x1: 1, y1: 1 } },
  { id: 'left-third', label: 'Left third', frac: { x0: 0, y0: 0, x1: 1 / 3, y1: 1 } },
  { id: 'center-third', label: 'Center third', frac: { x0: 1 / 3, y0: 0, x1: 2 / 3, y1: 1 } },
  { id: 'right-third', label: 'Right third', frac: { x0: 2 / 3, y0: 0, x1: 1, y1: 1 } }
]

const ZONES_BY_ID: ReadonlyMap<ZoneId, ZoneFraction> = new Map(ZONES.map((zone) => [zone.id, zone.frac]))

export const ZONE_ARROW_KEYS: Readonly<Record<string, ZoneId>> = {
  ArrowLeft: 'left-half',
  ArrowRight: 'right-half',
  ArrowUp: 'top-half',
  ArrowDown: 'bottom-half'
}

/** Return every usable zone in flow coordinates for the current viewport. */
export function zoneTargetRects(
  viewport: Viewport,
  containerWidth: number,
  containerHeight: number,
  marginPx: number = ZONE_MARGIN_PX,
  gutterPx: number = ZONE_GUTTER_PX
): ReadonlyMap<ZoneId, FlowRect> {
  const result = new Map<ZoneId, FlowRect>()
  for (const zone of ZONES) {
    const rect = zoneTargetRect(viewport, containerWidth, containerHeight, zone.id, marginPx, gutterPx)
    if (rect) result.set(zone.id, rect)
  }
  return result
}

/**
 * Resolve an edge or corner drag to a zone. The outer 22 percent of an edge is an intentional
 * affordance, leaving the middle of the canvas available for an ordinary node drag.
 */
export function zoneForPointer(
  clientX: number,
  clientY: number,
  containerWidth: number,
  containerHeight: number,
  edgeFraction = 0.22
): ZoneId | null {
  if (!(containerWidth > 0) || !(containerHeight > 0)) return null
  const edgeX = Math.min(clientX, containerWidth - clientX) / containerWidth
  const edgeY = Math.min(clientY, containerHeight - clientY) / containerHeight
  const nearX = edgeX <= edgeFraction
  const nearY = edgeY <= edgeFraction
  if (!nearX && !nearY) return null
  if (nearX && nearY) {
    const left = clientX < containerWidth / 2
    const top = clientY < containerHeight / 2
    if (top && left) return 'top-left'
    if (top) return 'top-right'
    if (left) return 'bottom-left'
    return 'bottom-right'
  }
  if (nearX) return clientX < containerWidth / 2 ? 'left-half' : 'right-half'
  return clientY < containerHeight / 2 ? 'top-half' : 'bottom-half'
}

/**
 * Resolve one zone to a flow-space rectangle. Null means the viewport is not usable yet or the
 * result would be too small to hold a node header.
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
  if (!frac || !(viewport.zoom > 0) || !(containerWidth > 0) || !(containerHeight > 0)) return null
  const innerW = containerWidth - marginPx * 2
  const innerH = containerHeight - marginPx * 2
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
