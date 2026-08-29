// Maximize-to-viewport geometry. The camera stays put while the node is resized, so terminal
// content reflows instead of merely being magnified.
import type { Viewport } from '@xyflow/system'

export const NODE_MAXIMIZE_MARGIN_PX = 24

export interface FlowRect { x: number; y: number; width: number; height: number }

export function maximizeTargetRect(
  viewport: Viewport,
  containerWidth: number,
  containerHeight: number,
  marginPx: number = NODE_MAXIMIZE_MARGIN_PX
): FlowRect | null {
  if (!(viewport.zoom > 0)) return null
  const width = containerWidth - marginPx * 2
  const height = containerHeight - marginPx * 2
  if (!(width >= 120) || !(height >= 120)) return null
  return {
    x: (marginPx - viewport.x) / viewport.zoom,
    y: (marginPx - viewport.y) / viewport.zoom,
    width: width / viewport.zoom,
    height: height / viewport.zoom
  }
}
