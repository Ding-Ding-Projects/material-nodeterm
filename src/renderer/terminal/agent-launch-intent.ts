import {
  agentConfig,
  canResume,
  hasPermissionMode,
  type AgentId,
  type AgentPermissionMode
} from '@shared/agents/config'
import type { AgentLaunchIntent } from '@shared/types'

export interface ColdAgentLaunchIntentInput {
  agentId: AgentId
  priorSessionId?: string | null
  /** Exact current machine-local custom-agent match; an opaque id alone is never executable. */
  customAgentConfigured: boolean
  permissionMode?: AgentPermissionMode
}

/**
 * Reconstruct shell-independent launch semantics for a fresh terminal generation.
 *
 * Built-ins resume when they have a provider id and otherwise start a new conversation. A custom
 * agent may only start when its exact id still exists in machine-local settings. The trusted core
 * repeats every validation and resolves the actual executable/config immediately before use.
 */
export function coldAgentLaunchIntent({
  agentId,
  priorSessionId,
  customAgentConfigured,
  permissionMode
}: ColdAgentLaunchIntentInput): AgentLaunchIntent | null {
  const builtin = agentConfig(agentId)
  if (!builtin && !customAgentConfigured) return null

  const mode = hasPermissionMode(agentId) ? permissionMode : undefined
  const sessionId = typeof priorSessionId === 'string' ? priorSessionId.trim() : ''
  if (builtin && sessionId && canResume(agentId)) {
    return {
      kind: 'agent',
      action: 'resume',
      agentId,
      sessionId,
      ...(mode ? { permissionMode: mode } : {})
    }
  }

  return {
    kind: 'agent',
    action: 'start',
    agentId,
    ...(mode ? { permissionMode: mode } : {})
  }
}
