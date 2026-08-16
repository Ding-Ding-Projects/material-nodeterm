import { agentConfig, type AgentId } from '@shared/agents/config'
import type { PtyRecycleTarget, WindowsTerminalProfile } from '@shared/types'
import type { SessionSource } from '../session/session'
import { agentColdRelaunchDecision } from '../terminal/agent-cold-relaunch'

/** Renderer-safe shape shared by context-menu, command-palette and kanban profile choices. */
export interface TerminalProfileChoice {
  id: string
  label: string
  disabled: boolean
  hint?: string
}

/**
 * Windows profiles are a desktop-local capability. A relay tab points at another core and an SSH
 * project already has a remote execution binding, so showing local profiles in either place would
 * offer a choice that cannot truthfully be honoured.
 */
export function canOfferTerminalProfiles(
  hasProfileApi: boolean,
  sessionSource: SessionSource,
  remoteExecutionProject: boolean
): boolean {
  return hasProfileApi && sessionSource === 'local' && !remoteExecutionProject
}

/** Keep unavailable detections visible and inert, with an actionable reason instead of hiding them. */
export function terminalProfileChoices(
  profiles: readonly WindowsTerminalProfile[],
  unavailableFallback = 'This profile is unavailable on this machine.'
): TerminalProfileChoice[] {
  return profiles.map((profile) => ({
    id: profile.id,
    label: profile.label,
    disabled: !profile.available,
    hint: profile.available ? undefined : profile.unavailableReason?.trim() || unavailableFallback
  }))
}

export type TerminalProfileExecutionEnvironment = 'windows' | 'unknown' | `wsl:${string}`

const NATIVE_WINDOWS_PROFILE_IDS = new Set([
  'auto',
  'pwsh',
  'windows-powershell',
  'cmd',
  'git-bash'
])

/**
 * Classify only the execution boundary relevant to agent continuity. Native Windows shells share
 * the host's CLI/session stores; each WSL distribution has its own home and installed programs.
 * A custom `wsl.exe` target has an unknown default distribution, so it is intentionally distinct
 * from every explicit `wsl:<distribution>` profile.
 */
export function terminalProfileExecutionEnvironment(
  profileId: string | undefined,
  customExecutable?: string
): TerminalProfileExecutionEnvironment {
  if (!profileId) return 'unknown'
  if (NATIVE_WINDOWS_PROFILE_IDS.has(profileId)) return 'windows'

  const wsl = /^wsl:([^\u0000-\u001f\u007f]{1,128})$/u.exec(profileId)
  if (wsl) return `wsl:${wsl[1]}`

  if (profileId !== 'custom') return 'unknown'
  const normalized = customExecutable?.trim().replace(/^"(.*)"$/u, '$1')
  const executableName = normalized?.split(/[\\/]/u).pop()?.toLowerCase()
  return executableName === 'wsl' || executableName === 'wsl.exe' ? 'wsl:custom' : 'windows'
}

export interface TerminalProfileRestartAgentContext {
  agentId: AgentId
  priorSessionId?: string | null
  customLaunchCmd?: string | null
}

export interface TerminalProfileRestartAssessmentInput {
  currentProfileId?: string
  targetProfileId: string
  currentCustomExecutable?: string
  targetCustomExecutable?: string
  agent?: TerminalProfileRestartAgentContext
}

export type TerminalProfileRestartReasonCode =
  'custom-agent-not-configured' | 'agent-cross-environment'

export type TerminalProfileRestartWarningCode =
  'new-built-in-conversation' | 'new-custom-conversation'

export interface TerminalProfileRestartAssessment {
  disabled: boolean
  reasonCode?: TerminalProfileRestartReasonCode
  reason?: string
  warningCode?: TerminalProfileRestartWarningCode
  warning?: string
}

/**
 * Decide whether a destructive profile restart can reconstruct an agent node truthfully. A plain
 * terminal has no extra constraint. Agent nodes fail closed when their command disappeared or the
 * requested profile crosses a Windows/WSL boundary whose CLI and conversation store cannot be
 * verified before teardown. Loss of conversation continuity remains allowed only with explicit
 * warning copy for the confirmation gate.
 */
export function assessTerminalProfileRestart({
  currentProfileId,
  targetProfileId,
  currentCustomExecutable,
  targetCustomExecutable,
  agent
}: TerminalProfileRestartAssessmentInput): TerminalProfileRestartAssessment {
  if (!agent) return { disabled: false }

  const relaunch = agentColdRelaunchDecision(agent)
  if (!relaunch.reconstructable) {
    return {
      disabled: true,
      reasonCode: 'custom-agent-not-configured',
      reason:
        'This custom agent is no longer configured. Restore its launch command before restarting; the live process was not changed.'
    }
  }

  const currentEnvironment = terminalProfileExecutionEnvironment(
    currentProfileId,
    currentCustomExecutable
  )
  const targetEnvironment = terminalProfileExecutionEnvironment(
    targetProfileId,
    targetCustomExecutable
  )
  if (
    currentEnvironment !== 'unknown' &&
    targetEnvironment !== 'unknown' &&
    currentEnvironment !== targetEnvironment
  ) {
    return {
      disabled: true,
      reasonCode: 'agent-cross-environment',
      reason:
        'Agent profile switching between Windows and WSL, or between WSL distributions, is unavailable because the target CLI and conversation store cannot be verified before ending this session.'
    }
  }

  if (relaunch.continuity === 'fresh') {
    return {
      disabled: false,
      warningCode: agentConfig(agent.agentId)
        ? 'new-built-in-conversation'
        : 'new-custom-conversation',
      warning: agentConfig(agent.agentId)
        ? 'No recoverable agent session ID is available. Restarting will start a new conversation.'
        : 'Custom agents cannot resume a prior conversation. Restarting will start a new conversation with the current custom launch command.'
    }
  }

  return { disabled: false }
}

/**
 * Renderer-side serialization closes the destructive gate's async gap: it marks the node pending
 * synchronously before the first await, so two immediate confirmations cannot recycle and stamp
 * competing profiles. Core serialization remains authoritative across clients/processes.
 */
export async function runExclusiveTerminalProfileRestart(
  pendingNodeIds: Set<string>,
  nodeId: string,
  onPendingChange: (pendingNodeIds: ReadonlySet<string>) => void,
  transaction: () => Promise<void>
): Promise<void> {
  if (pendingNodeIds.has(nodeId)) {
    throw new Error('A profile restart is already in progress for this node.')
  }

  pendingNodeIds.add(nodeId)
  onPendingChange(new Set(pendingNodeIds))
  try {
    await transaction()
  } finally {
    pendingNodeIds.delete(nodeId)
    onPendingChange(new Set(pendingNodeIds))
  }
}

/**
 * A destructive gate can outlive a project switch. Node ids are project-local, so checking the
 * active project alone is insufficient: the currently hydrated node collection must still belong
 * to the same captured origin before the confirmation may recycle anything.
 */
export function terminalProfileRestartOriginMatches(
  originProjectId: string | null,
  activeProjectId: string | null,
  nodesProjectId: string | null,
): boolean {
  return activeProjectId === originProjectId && nodesProjectId === originProjectId;
}

/**
 * The destructive half of a profile restart is deliberately sequenced before the state change.
 * If recycling fails, `applyProfileAndRespawn` is never called, so the node keeps its old profile
 * and respawn nonce. This small seam is behavioral-testable without reading Canvas source text.
 */
export async function recycleThenApplyTerminalProfile(
  nodeId: string,
  profileId: string,
  target: PtyRecycleTarget,
  recycleConfirmed: (persistKey: string, target: PtyRecycleTarget) => Promise<void>,
  applyProfileAndRespawn: (persistKey: string, selectedProfileId: string) => void
): Promise<void> {
  await recycleConfirmed(nodeId, target)
  applyProfileAndRespawn(nodeId, profileId)
}
