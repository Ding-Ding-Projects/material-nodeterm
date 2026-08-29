import { agentConfig, agentLaunchProgram, resumeCommand, type AgentId } from '@shared/agents/config'
import type { PtyRecycleTarget } from '@shared/types'

export type AgentColdRelaunchDecision =
  | {
      reconstructable: true
      command: string
      continuity: 'resume' | 'fresh'
    }
  | {
      reconstructable: false
      reason: 'custom-agent-not-configured'
    }

export interface AgentColdRelaunchInput {
  agentId: AgentId
  priorSessionId?: string | null
  customLaunchCmd?: string | null
  sharedIdentity?: boolean
  /** The user's launch-command override for this builtin agent (Settings → Agents → Launch
   *  commands), or undefined/null when unset. Wins over both the resumed and the fresh-start
   *  program — see `agentLaunchOverride` in state/workspace.ts, the one place it is read. */
  launchOverride?: string | null
}

export type AgentColdRelaunchRecoveryErrorCode =
  | 'custom-agent-not-configured'
  | 'launch-intent-failed'
  | 'confirmed-recycle-unavailable'
  | 'confirmed-recycle-failed'

export interface AgentColdRelaunchRecoveryError {
  code: AgentColdRelaunchRecoveryErrorCode
  detail?: string
}

export type AgentColdRelaunchRecoveryResult =
  { recovered: true } | { recovered: false; error: AgentColdRelaunchRecoveryError }

export function agentColdRelaunchRecoveryMessage(error: AgentColdRelaunchRecoveryError): string {
  switch (error.code) {
    case 'custom-agent-not-configured':
      return 'This custom agent is no longer configured. Restore its launch command, then try again. No agent was launched in the replacement shell.'
    case 'launch-intent-failed':
      return error.detail || 'The trusted agent launch could not be completed.'
    case 'confirmed-recycle-unavailable':
      return 'This host cannot confirm that the blank replacement session ended. Nothing was restarted.'
    case 'confirmed-recycle-failed':
      return `Could not safely replace the blank terminal session${error.detail ? `: ${error.detail}` : '.'} Nothing was restarted.`
  }
}

/**
 * Reconstruct the command for an agent node after its persistent terminal session was replaced.
 *
 * Built-ins are trusted declarations: resume when a safe provider session id is available, or
 * start the configured CLI fresh when it is not. Custom agents are different — their id is only
 * an opaque settings key, never an executable — so a missing current settings entry must fail
 * closed instead of writing that id into the shell.
 *
 * The returned continuity bit is deliberately separate from reconstructability. A built-in can
 * always be relaunched, but without a valid provider session id it cannot preserve the prior
 * conversation; callers that offer a destructive profile switch need to surface that distinction.
 */
export function agentColdRelaunchDecision({
  agentId,
  priorSessionId,
  customLaunchCmd,
  sharedIdentity = false,
  launchOverride
}: AgentColdRelaunchInput): AgentColdRelaunchDecision {
  const builtin = agentConfig(agentId)
  if (builtin) {
    const override = typeof launchOverride === 'string' ? launchOverride.trim() || undefined : undefined
    const resume = priorSessionId
      ? resumeCommand(agentId, priorSessionId, { sharedIdentity, base: override })
      : null
    if (resume) return { reconstructable: true, command: resume, continuity: 'resume' }

    return {
      reconstructable: true,
      command: override ?? agentLaunchProgram(agentId, builtin.launchCmd, sharedIdentity),
      continuity: 'fresh'
    }
  }

  if (typeof customLaunchCmd !== 'string' || !customLaunchCmd.trim()) {
    return { reconstructable: false, reason: 'custom-agent-not-configured' }
  }

  return {
    reconstructable: true,
    command: agentLaunchProgram(agentId, customLaunchCmd, sharedIdentity),
    continuity: 'fresh'
  }
}

/**
 * Recover a fresh terminal generation that could not reconstruct its agent. Re-check current
 * agent settings before touching the blank replacement, then use awaited confirmed recycling so
 * uncertainty leaves that generation and the node's respawn state untouched. A Windows profile
 * target is forwarded exactly for trusted core preflight; other hosts keep the legacy call.
 */
export async function retryAgentColdRelaunch(
  input: AgentColdRelaunchInput & {
    persistKey: string
    profileId?: string
    cwd: string
  },
  recycleConfirmed: ((persistKey: string, target?: PtyRecycleTarget) => Promise<void>) | undefined,
  respawn: () => void
): Promise<AgentColdRelaunchRecoveryResult> {
  const decision = agentColdRelaunchDecision(input)
  if (!decision.reconstructable) {
    return {
      recovered: false,
      error: { code: 'custom-agent-not-configured' }
    }
  }
  if (!recycleConfirmed) {
    return {
      recovered: false,
      error: { code: 'confirmed-recycle-unavailable' }
    }
  }

  try {
    if (input.profileId === undefined) {
      await recycleConfirmed(input.persistKey)
    } else {
      await recycleConfirmed(input.persistKey, {
        profileId: input.profileId,
        cwd: input.cwd
      })
    }
  } catch (error) {
    return {
      recovered: false,
      error: {
        code: 'confirmed-recycle-failed',
        detail: error instanceof Error ? error.message : String(error)
      }
    }
  }

  respawn()
  return { recovered: true }
}
