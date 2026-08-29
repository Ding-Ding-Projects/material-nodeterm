/**
 * Small registration bridge for node-local controls that need to focus a node in the canvas.
 * React Flow creates node components itself, so passing the canvas callback through every node
 * prop would be fragile. Canvas installs the current callback and clears it on unmount.
 */
let handler: ((nodeId: string) => void) | null = null

export function setFocusNodeHandler(next: ((nodeId: string) => void) | null): void {
  handler = next
}

export function focusNode(nodeId: string): void {
  handler?.(nodeId)
}

export function hasFocusHandler(): boolean {
  return handler !== null
}
