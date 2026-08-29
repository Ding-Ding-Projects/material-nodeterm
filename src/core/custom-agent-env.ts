/** Merge custom-agent environment entries after account, hook, and gateway values. */
import type { CustomAgent } from '../shared/types'
import { expandEnvVars, preservesInheritedPath } from '../shared/agents/expansion'

export interface EnvMergeResult {
  env: Record<string, string>
  warnings: string[]
}

export function applyCustomAgentEnv(
  env: Record<string, string>,
  custom: CustomAgent | undefined,
  processEnv: Record<string, string | undefined>,
  opts: { skipPath?: boolean } = {}
): EnvMergeResult {
  const out = { ...env }
  const warnings: string[] = []
  if (!custom?.env) return { env: out, warnings }
  const label = custom.label || custom.id
  for (const [key, raw] of Object.entries(custom.env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(key)) {
      warnings.push(`[custom-agent] ${label}: an environment name was ignored because it is invalid.`)
      continue
    }
    if (typeof raw !== 'string' || raw.length > 16_384 || /[\u0000\r\n]/.test(raw)) {
      warnings.push(`[custom-agent] ${label}: an environment value was ignored because it is invalid.`)
      continue
    }
    if (key === 'PATH' && opts.skipPath) {
      warnings.push(`[custom-agent] ${label}: custom PATH is not applied to remote sessions.`)
      continue
    }
    const expanded = expandEnvVars(raw, processEnv)
    out[key] = expanded.value
    if (expanded.missing.length) warnings.push(`[custom-agent] ${label}: an environment reference is unset.`)
    if (key === 'PATH' && !preservesInheritedPath(raw)) warnings.push(`[custom-agent] ${label}: custom PATH does not preserve the inherited PATH.`)
  }
  return { env: out, warnings }
}

export function customAgentEnvArgs(
  custom: CustomAgent | undefined,
  processEnv: Record<string, string | undefined>,
  opts: { skipPath?: boolean } = {}
): { args: string[]; warnings: string[] } {
  const merged = applyCustomAgentEnv({}, custom, processEnv, opts)
  return { args: Object.entries(merged.env).map(([key, value]) => `${key}=${value}`), warnings: merged.warnings }
}
