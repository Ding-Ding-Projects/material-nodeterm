import type { AgentLaunchIntent, TerminalLaunchIntent } from '@shared/types'

export interface ArmedLaunchNodeData {
  initialCommand?: string
  agentLaunchIntent?: AgentLaunchIntent
  ssh?: unknown
  sshRemoteTmux?: unknown
}

export interface ArmedLaunchCapabilities {
  /** The renderer is a local Windows desktop that offers trusted terminal profiles. */
  offersTerminalProfiles: boolean
  /** The optional opaque local-desktop executor is present. */
  hasOpaqueExecutor: boolean
}

/**
 * Choose the machine-local launch representation held behind `--after` dependencies.
 *
 * Only a local Windows-profile pane may hold the semantic form. Server Edition, relay sessions,
 * and SSH panes deliberately keep their established renderer-authored command so their behavior
 * does not depend on a desktop-only planner. If Windows advertises profiles but its opaque
 * capability is missing, this returns the raw command only for compatibility storage; execution
 * still fails closed because `executePendingLaunchForSession` sees the Windows profile. This lets
 * the node surface a recoverable error without silently changing what it was asked to run.
 */
export function armedTerminalLaunchIntent(
  data: ArmedLaunchNodeData,
  capabilities: ArmedLaunchCapabilities
): TerminalLaunchIntent | undefined {
  const mayUseSemantic =
    capabilities.offersTerminalProfiles &&
    capabilities.hasOpaqueExecutor &&
    !data.ssh &&
    !data.sshRemoteTmux

  if (mayUseSemantic && data.agentLaunchIntent) return data.agentLaunchIntent
  return data.initialCommand
    ? { kind: 'shell-command', command: data.initialCommand }
    : undefined
}
