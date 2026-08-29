/** Shared command assembly for fresh and resumed agent sessions. The renderer uses it for previews
 * and node creation, while the trusted core uses the same semantic fields before committing to a
 * concrete shell. Environment expansion is bounded and quoted per token. */
import type { CustomAgent } from '../types'
import { shellQuoteIfNeeded, shellSingleQuote, shellSplit } from '../shell-quote'
import { expandEnvVars } from './expansion'
import {
  agentLaunchProgram,
  capabilityAgentId,
  mintsSessionId,
  resumeCommandWith,
  withSessionId,
  type AgentId,
  type AgentPermissionMode,
  type BuiltinAgentId
} from './config'
import { withPermissionMode } from './approval-mode'
import { resolveAgentBase, resolveAgentConfig } from './custom-agent'
import { withAgentModel } from './model-gateway'

export interface LaunchInputs {
  agentId: AgentId
  baseAgentId?: BuiltinAgentId
  customAgent?: CustomAgent
  launchCmdOverride?: string
  initialPrompt?: string
  permissionMode?: AgentPermissionMode
  model?: string
  sessionId?: string
  sessionIdFlagSupported?: boolean
  sharedIdentity?: boolean
}

export interface ResumeInputs {
  agentId: AgentId
  baseAgentId?: BuiltinAgentId
  customAgent?: CustomAgent
  launchCmdOverride?: string
  sessionId?: string
  permissionMode?: AgentPermissionMode
  model?: string
  sharedIdentity?: boolean
}

export interface AssembledCommand {
  command: string
  missingEnv: string[]
}

function expandedArgs(raw: string, env: Record<string, string | undefined>): { fragment: string; missing: string[] } {
  if (!raw?.trim()) return { fragment: '', missing: [] }
  const missing: string[] = []
  const tokens: string[] = []
  for (const token of shellSplit(raw)) {
    const expanded = expandEnvVars(token, env)
    missing.push(...expanded.missing)
    if (expanded.value === '' && token !== '') continue
    tokens.push(shellSingleQuote(expanded.value))
  }
  return { fragment: tokens.join(' '), missing }
}

function expandedProgram(raw: string, env: Record<string, string | undefined>): { value: string; missing: string[] } {
  if (!raw.includes('${env:')) return { value: raw, missing: [] }
  const missing: string[] = []
  const tokens: string[] = []
  for (const token of shellSplit(raw)) {
    const expanded = expandEnvVars(token, env)
    missing.push(...expanded.missing)
    if (expanded.value === '' && token !== '') continue
    tokens.push(shellQuoteIfNeeded(expanded.value))
  }
  return { value: tokens.join(' '), missing }
}

function effectiveCapabilityId(
  agentId: AgentId,
  customAgent: CustomAgent | undefined,
  baseAgentId: BuiltinAgentId | undefined
): AgentId {
  return resolveAgentBase(agentId, customAgent, baseAgentId) ?? capabilityAgentId(agentId)
}

export function assembleLaunchCommand(
  inputs: LaunchInputs,
  env: Record<string, string | undefined>
): AssembledCommand {
  const effective = resolveAgentConfig(inputs.agentId, inputs.customAgent, inputs.baseAgentId)
  const capability = effectiveCapabilityId(inputs.agentId, inputs.customAgent, inputs.baseAgentId)
  const override = inputs.launchCmdOverride?.trim()
  const expanded = expandedProgram(override || effective.launchCmd, env)
  const program = override
    ? expanded.value
    : agentLaunchProgram(inputs.customAgent ? inputs.agentId : capability, expanded.value, inputs.sharedIdentity)
  const args = expandedArgs(inputs.customAgent?.args ?? '', env)
  const base = args.fragment ? `${program} ${args.fragment}` : program
  const prompt = inputs.initialPrompt ? shellSingleQuote(inputs.initialPrompt.replace(/\s+/g, ' ').trim()) : null
  const modeFlag = effective.promptInjectionMode === 'flag-prompt'
    ? '--prompt'
    : effective.promptInjectionMode === 'flag-interactive'
      ? '--interactive'
      : null
  const usesSeparator = !!prompt && !!effective.argvPromptSeparator && !modeFlag
  const withPrompt = prompt
    ? modeFlag
      ? `${base} ${modeFlag} ${prompt}`
      : `${base} ${prompt}`
    : base
  const flagged = (value: string): string => {
    const withMode = inputs.permissionMode ? withPermissionMode(value, capability, inputs.permissionMode) : value
    const withId = inputs.sessionId && mintsSessionId(capability) && inputs.sessionIdFlagSupported
      ? withSessionId(withMode, capability, inputs.sessionId)
      : withMode
    return withAgentModel(withId, capability, inputs.model)
  }
  return {
    command: usesSeparator ? `${flagged(base)} ${effective.argvPromptSeparator} ${prompt}` : flagged(withPrompt),
    missingEnv: [...expanded.missing, ...args.missing]
  }
}

export function assembleResumeCommand(
  inputs: ResumeInputs,
  env: Record<string, string | undefined>
): AssembledCommand {
  const effective = resolveAgentConfig(inputs.agentId, inputs.customAgent, inputs.baseAgentId)
  const capability = effectiveCapabilityId(inputs.agentId, inputs.customAgent, inputs.baseAgentId)
  const override = inputs.launchCmdOverride?.trim()
  const expanded = expandedProgram(override || effective.launchCmd, env)
  const program = override
    ? expanded.value
    : agentLaunchProgram(inputs.customAgent ? inputs.agentId : capability, expanded.value, inputs.sharedIdentity)
  const args = expandedArgs(inputs.customAgent?.args ?? '', env)
  const base = args.fragment ? `${program} ${args.fragment}` : program
  const resumed = inputs.sessionId ? resumeCommandWith(base, capability, inputs.sessionId) : null
  const withMode = inputs.permissionMode
    ? withPermissionMode(resumed ?? base, capability, inputs.permissionMode)
    : resumed ?? base
  return {
    command: withAgentModel(withMode, capability, inputs.model),
    missingEnv: [...expanded.missing, ...args.missing]
  }
}
