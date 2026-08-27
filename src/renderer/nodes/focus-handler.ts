/**
 * Node-focus handler bridge for project-aware navigation.
 *
 * React Flow creates node components itself, so Canvas cannot pass its focus callback through
 * node props. Canvas registers the callback here and node headers call `focusNode` from their
 * focus control. Clearing the registration on unmount prevents a stale node from targeting a
 * canvas that no longer exists.
 */
let focusHandler: ((nodeId: string) => void) | null = null

/** Register the live Canvas focus callback. */
export function setFocusNodeHandler(fn: ((nodeId: string) => void) | null): void {
  focusHandler = fn
}

/** Request a single-node canvas focus. Nodes rendered outside Canvas safely do nothing. */
export function focusNode(nodeId: string): void {
  focusHandler?.(nodeId)
}

/** Whether Canvas currently exposes a focus target callback. */
export function hasFocusHandler(): boolean {
  return focusHandler !== null
}
