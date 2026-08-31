import type { GroupWsl } from '@shared/wsl-binding'
import { wslProfileIdFor } from '@shared/wsl-binding'
import {
  createGroupNode,
  createTerminalNode,
  WORKTREE_GROUP_SIZE,
  type CanvasNode,
  type TerminalNodeCreationOptions
} from '../state/workspace'

/** The in-frame inset keeps the first terminal clear of the group label and inside its bounds. */
export const WSL_TERMINAL_INSET = { x: 24, y: 76 }

export interface WslGroupCreationInput {
  distroName: string
  bindingId: string
  cwd?: string
  position: { x: number; y: number }
  index: number
  sessionSource: TerminalNodeCreationOptions['sessionSource']
  groupSize?: { width: number; height: number }
}

export interface WslGroupCreation {
  group: CanvasNode
  terminal: CanvasNode
  profileId: string
  binding: GroupWsl
}

/**
 * Assemble the WSL frame and its first terminal before either is published to React Flow.
 * React Flow requires parents to precede children, so callers should append `group` first and
 * `terminal` second in one state update. The profile id is stable and distribution-specific.
 */
export function createWslGroupWithTerminal(input: WslGroupCreationInput): WslGroupCreation {
  const size = input.groupSize ?? WORKTREE_GROUP_SIZE
  const binding: GroupWsl = { bindingId: input.bindingId, distroName: input.distroName }
  const profileId = wslProfileIdFor(input.distroName)
  const group = createGroupNode(input.position, size, input.index)
  group.data = { ...group.data, title: input.distroName, wsl: binding }

  const terminal = createTerminalNode(
    input.index + 1,
    input.cwd,
    undefined,
    undefined,
    undefined,
    { sessionSource: input.sessionSource, terminalProfileId: profileId }
  )
  // WSL creation is only offered on the local Windows surface. Keep the identity explicit even
  // when this pure factory is exercised in a non-Windows test host where profile discovery is off.
  terminal.data = { ...terminal.data, terminalProfileId: profileId }
  terminal.position = WSL_TERMINAL_INSET
  terminal.parentId = group.id
  terminal.extent = 'parent'
  terminal.selected = true

  return { group, terminal, profileId, binding }
}
