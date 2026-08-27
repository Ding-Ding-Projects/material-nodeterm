/** Optional bridge for the projection's secondary "open in owning project" action.
 * Canvas owns the actual project-switch and focus routine. Keeping the callback here avoids
 * passing navigation functions through React Flow node data, and a missing registration safely
 * degrades to no action when the component is rendered in isolation. */
let travelHandler: ((nodeId: string) => void) | null = null

export function setTravelNodeHandler(handler: ((nodeId: string) => void) | null): void {
  travelHandler = handler
}

export function travelToNode(nodeId: string): void {
  travelHandler?.(nodeId)
}
