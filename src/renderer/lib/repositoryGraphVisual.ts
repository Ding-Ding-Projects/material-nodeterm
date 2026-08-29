export interface GraphPoint { x: number; y: number }

/** Trim an edge to the visible node rectangles so arrowheads land at the border, not underneath
 * the target box. The graph preview renders 144×40 rectangles centred at each point. */
export function graphEdgeEndpoints(from: GraphPoint, to: GraphPoint, halfWidth = 72, halfHeight = 20): { source: GraphPoint; target: GraphPoint } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 0 && dy === 0) return { source: from, target: to }
  const scale = Math.min(
    halfWidth / Math.max(Math.abs(dx), Number.EPSILON),
    halfHeight / Math.max(Math.abs(dy), Number.EPSILON),
  )
  return {
    source: { x: from.x + dx * scale, y: from.y + dy * scale },
    target: { x: to.x - dx * scale, y: to.y - dy * scale },
  }
}
