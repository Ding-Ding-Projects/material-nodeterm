/**
 * Registration bridge for a projection's open action. The canvas owns project switching and node
 * framing, while a React Flow node can request that behavior without receiving a stale callback.
 */
let handler: ((nodeId: string) => void) | null = null

export function setTravelNodeHandler(next: ((nodeId: string) => void) | null): void {
  handler = next
}

export function travelToNode(nodeId: string): void {
  handler?.(nodeId)
}
