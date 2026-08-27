import { canContextLink, type AgentId } from '@shared/agents/config'

/** Namespaced payload for the explicit agent-to-agent collaboration gesture. */
export const AGENT_COLLABORATION_DRAG_MIME = 'application/x-nodeterm-agent-collaboration'
export const AGENT_COLLABORATION_PICK_EVENT = 'nodeterm:pick-agent-collaboration'
export const AGENT_COLLABORATION_MODE_EVENT = 'nodeterm:agent-collaboration-mode'

export interface AgentCollaborationDragPayload {
  version: 1
  nodeId: string
  agentId: AgentId
}

type DragData = Pick<DataTransfer, 'setData'>

const MAX_ID_LENGTH = 256

const bounded = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** Write only the two opaque identities needed to resolve the pair on the active canvas. */
export function writeAgentCollaborationDrag(
  transfer: DragData,
  nodeId: string,
  agentId: AgentId
): void {
  if (!bounded(nodeId) || !bounded(agentId) || !canContextLink(agentId)) return
  transfer.setData(
    AGENT_COLLABORATION_DRAG_MIME,
    JSON.stringify({ version: 1, nodeId, agentId })
  )
}

export function readAgentCollaborationDrag(
  transfer: Pick<DataTransfer, 'getData' | 'types'> | null
): AgentCollaborationDragPayload | null {
  if (!transfer || !Array.from(transfer.types).includes(AGENT_COLLABORATION_DRAG_MIME)) return null
  try {
    const raw = transfer.getData(AGENT_COLLABORATION_DRAG_MIME)
    if (!raw || raw.length > MAX_ID_LENGTH * 2 + 64) return null
    const value: unknown = JSON.parse(raw)
    if (!record(value) || value.version !== 1 || !bounded(value.nodeId) || !bounded(value.agentId)) {
      return null
    }
    if (!canContextLink(value.agentId)) return null
    return { version: 1, nodeId: value.nodeId, agentId: value.agentId }
  } catch {
    return null
  }
}

/** The drop target is valid only when both existing sessions can read linked context. */
export function canLinkAgentPair(
  sourceNodeId: string,
  sourceAgentId: AgentId,
  targetNodeId: string,
  targetAgentId: AgentId
): boolean {
  return (
    bounded(sourceNodeId) &&
    bounded(targetNodeId) &&
    sourceNodeId !== targetNodeId &&
    canContextLink(sourceAgentId) &&
    canContextLink(targetAgentId)
  )
}
