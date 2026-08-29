/** Event used by an agent node's keyboard-accessible link control. The canvas owns the picker and
 * invokes the existing React Flow connection path, keeping pointer and keyboard semantics equal. */
export const OPEN_AGENT_LINK_PICKER_EVENT = 'nodeterm:open-agent-link-picker'

export interface AgentLinkPickerRequest {
  sourceNodeId: string
  anchorEl?: HTMLElement
}

export type AgentLinkSelectionResult =
  | { kind: 'success' }
  | { kind: 'duplicate'; targetId: string }
  | { kind: 'stale'; targetId: string }

export function requestAgentLinkPicker(
  sourceNodeId: string,
  anchorEl?: AgentLinkPickerRequest['anchorEl']
): void {
  if (!sourceNodeId) return
  window.dispatchEvent(
    new CustomEvent<AgentLinkPickerRequest>(OPEN_AGENT_LINK_PICKER_EVENT, {
      detail: { sourceNodeId, ...(anchorEl ? { anchorEl } : {}) }
    })
  )
}
