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

interface ExistingNodeAppend {
  nodes: CanvasNode[]
  result: { node: CanvasNode | null; error?: string }
}

export interface WslGroupPairReceipt {
  ok: boolean
  groupNodeId?: string
  terminalNodeId?: string
  reason?: string
}

export type NewWslBindingVerification =
  | { ok: true }
  | { ok: false; reason: string; facts: readonly string[] }

/** Fail closed unless the refreshed machine facts contain the newly created app-owned instance. */
export function verifyNewWslBinding(input: {
  name: string
  enumeratedNames: ReadonlySet<string>
  ownedByApp: boolean
  refreshError?: string | null
}): NewWslBindingVerification {
  if (input.refreshError) {
    return {
      ok: false,
      reason: `The refreshed WSL list failed: ${input.refreshError}`,
      facts: [input.name, input.refreshError]
    }
  }
  if (!input.enumeratedNames.has(input.name) || !input.ownedByApp) {
    return {
      ok: false,
      reason: `The refreshed WSL list did not confirm the app-owned instance ${input.name}.`,
      facts: [input.name]
    }
  }
  return { ok: true }
}

/** Commit the frame and first terminal as one transaction, or preserve the original canvas. */
export function appendWslGroupPair(
  existing: readonly CanvasNode[],
  assembled: WslGroupCreation,
  eventIds: { group: string; terminal: string },
  appendNode: (
    nodes: readonly CanvasNode[],
    node: CanvasNode,
    eventId: string,
    options?: { prepend?: boolean }
  ) => ExistingNodeAppend
): { nodes: CanvasNode[]; result: WslGroupPairReceipt } {
  const original = [...existing]
  const group = appendNode(original, assembled.group, eventIds.group, { prepend: true })
  if (!group.result.node || group.result.error) {
    return {
      nodes: original,
      result: { ok: false, reason: group.result.error ?? 'The WSL frame placement was not acknowledged.' }
    }
  }
  const terminal = appendNode(group.nodes, assembled.terminal, eventIds.terminal)
  if (!terminal.result.node || terminal.result.error) {
    return {
      nodes: original,
      result: { ok: false, reason: terminal.result.error ?? 'The first WSL terminal placement was not acknowledged.' }
    }
  }
  return {
    nodes: terminal.nodes,
    result: {
      ok: true,
      groupNodeId: group.result.node.id,
      terminalNodeId: terminal.result.node.id
    }
  }
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
