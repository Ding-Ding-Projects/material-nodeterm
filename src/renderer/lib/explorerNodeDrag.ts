import type { Project } from '@shared/types'
import { createdAgentId } from '@shared/agents/config'
import type { ActiveAgentLaunchPlan } from '../state/permissionMode'
import {
  type CanvasNode,
  type TerminalNodeCreationOptions,
  createAgentNode,
  createTerminalNode,
  nodeSshFor
} from '../state/workspace'

export const AGENT_NODE_DRAG_MIME = 'application/x-nodeterm-agent-node'
export const EXPLORER_FOLDER_DRAG_MIME = 'application/x-nodeterm-folder'
export const OPEN_EXPLORER_FOR_AGENT_EVENT = 'nodeterm:open-explorer-for-agent'

export interface AgentNodeDragPayload {
  version: 1
  nodeId: string
}

export interface ExplorerFolderDragPayload {
  version: 1
  projectId: string
  path: string
}

type DragData = Pick<DataTransfer, 'getData' | 'setData' | 'types'>

const MAX_NODE_ID_LENGTH = 256
const MAX_PROJECT_ID_LENGTH = 256
const MAX_PATH_LENGTH = 4096

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parsePayload(transfer: Pick<DataTransfer, 'getData' | 'types'> | null, type: string): unknown {
  if (!transfer || !hasDragType(transfer, type)) return null
  try {
    const raw = transfer.getData(type)
    if (!raw || raw.length > MAX_PATH_LENGTH + MAX_PROJECT_ID_LENGTH + 128) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function hasDragType(transfer: Pick<DataTransfer, 'types'> | null, type: string): boolean {
  return !!transfer && Array.from(transfer.types).includes(type)
}

export function writeAgentNodeDrag(transfer: DragData, nodeId: string): void {
  if (!boundedString(nodeId, MAX_NODE_ID_LENGTH)) return
  transfer.setData(AGENT_NODE_DRAG_MIME, JSON.stringify({ version: 1, nodeId }))
}

export function readAgentNodeDrag(
  transfer: Pick<DataTransfer, 'getData' | 'types'> | null
): AgentNodeDragPayload | null {
  const value = parsePayload(transfer, AGENT_NODE_DRAG_MIME)
  if (
    !plainRecord(value) ||
    value.version !== 1 ||
    !boundedString(value.nodeId, MAX_NODE_ID_LENGTH)
  ) {
    return null
  }
  return { version: 1, nodeId: value.nodeId }
}

export function writeExplorerFolderDrag(
  transfer: DragData,
  payload: Omit<ExplorerFolderDragPayload, 'version'>
): void {
  if (
    !boundedString(payload.projectId, MAX_PROJECT_ID_LENGTH) ||
    !boundedString(payload.path, MAX_PATH_LENGTH)
  ) {
    return
  }
  transfer.setData(EXPLORER_FOLDER_DRAG_MIME, JSON.stringify({ version: 1, ...payload }))
}

export function readExplorerFolderDrag(
  transfer: Pick<DataTransfer, 'getData' | 'types'> | null
): ExplorerFolderDragPayload | null {
  const value = parsePayload(transfer, EXPLORER_FOLDER_DRAG_MIME)
  if (
    !plainRecord(value) ||
    value.version !== 1 ||
    !boundedString(value.projectId, MAX_PROJECT_ID_LENGTH) ||
    !boundedString(value.path, MAX_PATH_LENGTH)
  ) {
    return null
  }
  return { version: 1, projectId: value.projectId, path: value.path }
}

export function createAgentNodeForExplorerFolder(args: {
  source: CanvasNode
  index: number
  project: Pick<Project, 'ssh'>
  path: string
  center?: { x: number; y: number }
  accountId?: string
  launchPlan: ActiveAgentLaunchPlan
  options?: TerminalNodeCreationOptions
}): CanvasNode | null {
  const agentId = createdAgentId(args.source.data)
  if (!agentId) return null
  const ssh = nodeSshFor(args.project.ssh, args.path)
  return createAgentNode(
    agentId,
    args.index,
    args.path,
    args.center,
    undefined,
    ssh,
    args.accountId,
    args.launchPlan,
    args.options
  )
}

export function createTerminalNodeForExplorerFolder(args: {
  index: number
  project: Pick<Project, 'ssh'>
  path: string
  center?: { x: number; y: number }
  options?: TerminalNodeCreationOptions
}): CanvasNode {
  return createTerminalNode(
    args.index,
    args.path,
    args.center,
    undefined,
    nodeSshFor(args.project.ssh, args.path),
    args.options
  )
}
