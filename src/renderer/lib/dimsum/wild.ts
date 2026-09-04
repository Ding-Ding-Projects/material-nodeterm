import type { CanvasNode } from '../../state/workspace'
import { createWildDimSumNode } from '../../state/workspace'
import { resolvePublicDimSumCatalog } from './public-catalog'

const drawnFor = new Set<string>()
export function drawWildDimSumForNode(requestedNodeId: string, nodes: CanvasNode[], random = Math.random) {
  if (drawnFor.has(requestedNodeId) || nodes.some((n) => n.data.wildEventId === requestedNodeId)) return null
  drawnFor.add(requestedNodeId)
  if (random() >= 0.01) return null
  const source = nodes.find((n) => n.id === requestedNodeId)
  if (!source) return null
  const eventId = globalThis.crypto?.randomUUID?.() ?? `wild-event-${requestedNodeId}`
  const position = { x: source.position.x + (source.width ?? 360) + 32, y: source.position.y }
  return { node: createWildDimSumNode(nodes.length, position, undefined, eventId), resolve: resolvePublicDimSumCatalog }
}
export function resetWildDimSumDrawsForTests(): void { drawnFor.clear() }
