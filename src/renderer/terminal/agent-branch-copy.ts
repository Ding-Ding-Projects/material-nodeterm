import type { AgentPermissionMode } from '@shared/agents/config'
import { withPermissionMode } from '@shared/agents/approval-mode'
import {
  claudeLaunchCommand,
  duplicateNode,
  type CanvasNode
} from '../state/workspace'

/**
 * Build the new node created by Claude's `/branch` action.
 *
 * `duplicateNode` first removes every consumed or machine-local launch from the source. The branch
 * then installs one newly-authorized resume intent for the ORIGINAL conversation. Keeping that
 * order prevents a source node's pending launch, stale minted id, or already-consumed command from
 * riding into the clone beside the intended resume.
 */
export function createClaudeBranchCopy(
  source: CanvasNode,
  originalSessionId: string,
  permissionMode: AgentPermissionMode
): CanvasNode {
  const copy = duplicateNode(source)
  copy.data = {
    ...copy.data,
    initialCommand: withPermissionMode(
      `${claudeLaunchCommand()} -r ${originalSessionId}`,
      'claude',
      permissionMode
    ),
    agentLaunchIntent: {
      kind: 'agent',
      action: 'resume',
      agentId: 'claude',
      sessionId: originalSessionId,
      permissionMode
    },
    agentSessionId: originalSessionId,
    title: `${source.data.title} (original)`
  }
  return copy
}
