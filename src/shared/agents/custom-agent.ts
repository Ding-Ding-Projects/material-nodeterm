/** Effective launch configuration for built-in agents and user-defined harnesses. This module
 * keeps the custom registry lookup in one place so prompt grammar, capability inheritance, and
 * display colour cannot drift between settings, launch, resume, and canvas controls. */
import type { CustomAgent } from '../types'
import {
  AGENT_CONFIG,
  FALLBACK_AGENT_COLOR,
  agentConfig,
  baseAgentOf,
  type AgentId,
  type BuiltinAgentId,
  type PromptInjectionMode
} from './config'

export interface EffectiveAgentConfig {
  label: string
  color: string
  launchCmd: string
  promptInjectionMode: PromptInjectionMode
  argvPromptSeparator?: string
  expectedProcess?: string
  custom: boolean
  baseAgent?: BuiltinAgentId
}

export function resolveAgentBase(
  id: AgentId,
  customAgent?: CustomAgent,
  persistedBaseAgent?: BuiltinAgentId
): BuiltinAgentId | undefined {
  if (agentConfig(id)) return id as BuiltinAgentId
  return persistedBaseAgent ?? customAgent?.baseAgent ?? baseAgentOf(id)
}

export function resolveAgentConfig(
  id: AgentId,
  customAgent?: CustomAgent,
  persistedBaseAgent?: BuiltinAgentId
): EffectiveAgentConfig {
  const builtin = agentConfig(id)
  if (builtin) return { ...builtin, custom: false }
  const resolvedBase = resolveAgentBase(id, customAgent, persistedBaseAgent)
  const base = resolvedBase ? AGENT_CONFIG[resolvedBase] : undefined
  return {
    label: customAgent?.label?.trim() || id,
    color: customAgent?.color || base?.color || FALLBACK_AGENT_COLOR,
    launchCmd: customAgent?.launchCmd?.trim() || base?.launchCmd || id,
    promptInjectionMode: base?.promptInjectionMode ?? customAgent?.promptInjectionMode ?? 'argv',
    argvPromptSeparator: base?.argvPromptSeparator,
    expectedProcess: base?.expectedProcess,
    custom: true,
    ...(resolvedBase ? { baseAgent: resolvedBase } : {})
  }
}

export function findCustomAgent(
  customAgents: readonly CustomAgent[],
  id: AgentId
): CustomAgent | undefined {
  if (agentConfig(id)) return undefined
  return customAgents.find((candidate) => candidate.id === id)
}

export function declaredBaseAgent(customAgent: CustomAgent | undefined): BuiltinAgentId | undefined {
  return customAgent?.baseAgent
}

export { baseAgentOf }
