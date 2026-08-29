/**
 * Pure geometry for the canvas's two drawn annotation tools (issue #145): a colored area (an
 * empty group frame, drawn on empty canvas instead of only around a selection) and a standalone
 * line/arrow.
 *
 * Kept free of React/React-Flow imports — and, above all, free of any `source`/`target` concept —
 * so it stays unit-testable and so the SEPARATION from the app's semantic edges (context-link
 * "bridges", spawn-lineage "ropes", and canvas-control dependency edges — all persisted `BridgeLink`s
 * connecting two real node ids, see @shared/types) is a structural fact of this module's own types,
 * not a rule someone has to remember to keep true elsewhere. An `AnnotationRect` never carries a
 * node id: it is a shape in space, not a relationship between two things on the canvas.
 */

export interface FlowPoint {
  x: number
  y: number
}

/** 'line' has no arrowhead; 'arrow' has one at its END point (see `annotationEndpoints`). */
export type AnnotationVariant = 'line' | 'arrow'

/** Which corner-to-corner diagonal of a bounding box the line/arrow follows. */
export type AnnotationDiagonal = 'tl-br' | 'tr-bl'

export interface FlowRect {
  position: FlowPoint
  size: { width: number; height: number }
}

export interface AnnotationRect extends FlowRect {
  dir: AnnotationDiagonal
}

/**
 * Minimum drag distance (flow px, along at least one axis) before a draw gesture becomes a real
 * annotation. Below this a "drag" reads as a stray click — the tool cancels rather than stamping a
 * degenerate zero-size node, same principle as `hasArrangeableNodes`/`hasRestartableAgents` hiding
 * an action that could only ever be a no-op.
 */
export const ANNOTATION_MIN_DRAG_PX = 12

/**
 * Axis-aligned bounding rect of two freely-ordered points (a drag start and end, in flow/canvas
 * coordinates — NOT screen pixels). Returns `null` when the drag is too small on BOTH axes to be
 * an intentional gesture; a straight horizontal or vertical drag (one axis at/near 0) is still
 * accepted as long as the OTHER axis clears the threshold, since a horizontal or vertical line is
 * a legitimate line, not a click.
 */
export function rectFromDragPoints(
  a: FlowPoint,
  b: FlowPoint,
  minDrag: number = ANNOTATION_MIN_DRAG_PX
): FlowRect | null {
  const width = Math.abs(b.x - a.x)
  const height = Math.abs(b.y - a.y)
  if (width < minDrag && height < minDrag) return null
  return {
    position: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
    size: { width, height }
  }
}

/**
 * Which diagonal of the drag's bounding box the gesture traced. A drag from top-left toward
 * bottom-right (or the reverse — dragging FROM the bottom-right corner back TO the top-left one
 * traces the identical diagonal, just walked backwards) is 'tl-br'; top-right↔bottom-left is
 * 'tr-bl'. Degenerate axis-aligned drags (one delta is 0) return 'tl-br' arbitrarily — both
 * diagonals of a zero-height or zero-width box are the same segment, so the choice is unobservable.
 */
export function annotationDiagonalFromPoints(a: FlowPoint, b: FlowPoint): AnnotationDiagonal {
  return (b.x - a.x) * (b.y - a.y) >= 0 ? 'tl-br' : 'tr-bl'
}

/**
 * The full geometry (bounding rect + diagonal) for a line/arrow drawn from `a` to `b`, or `null`
 * below the minimum-drag threshold (see `rectFromDragPoints`). This is the ONE function the draw
 * tool calls on mouse-up — the sole place a mouse gesture becomes annotation geometry.
 */
export function annotationRectFromPoints(
  a: FlowPoint,
  b: FlowPoint,
  minDrag?: number
): AnnotationRect | null {
  const rect = rectFromDragPoints(a, b, minDrag)
  if (!rect) return null
  return { ...rect, dir: annotationDiagonalFromPoints(a, b) }
}

/**
 * The line's two endpoints, in coordinates LOCAL to the node's own box (0,0 = top-left corner,
 * (width,height) = bottom-right corner) — i.e. exactly what an SVG inside the node renders. `to`
 * is the arrowhead end for an 'arrow' variant. Resizing the node (NodeResizer) changes `size` and
 * this recomputes accordingly — the stored `dir` is untouched by a resize, only stretched.
 */
export function annotationEndpoints(
  size: { width: number; height: number },
  dir: AnnotationDiagonal
): { from: FlowPoint; to: FlowPoint } {
  return dir === 'tl-br'
    ? { from: { x: 0, y: 0 }, to: { x: size.width, y: size.height } }
    : { from: { x: size.width, y: 0 }, to: { x: 0, y: size.height } }
}
