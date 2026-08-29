import { canSwitchModel, capabilityAgentId, type AgentId } from './config'
import { shellSingleQuote } from '../shell-quote'
import { expandEnvVars } from './expansion'

/** One gateway root shared by model-switch-capable agent harnesses. */
export interface ModelGatewaySettings {
  baseUrl: string
  /** An environment reference, the protected-storage sentinel, or a legacy literal. */
  apiKey: string
}

export const MODEL_GATEWAY_SECRET_REF = '${secret:model-gateway-api-key}'
export type ModelGatewayCredentialStorage = 'encrypted' | 'unavailable'

export interface ModelGatewayCredentialStatus {
  hasStoredKey: boolean
  storage: ModelGatewayCredentialStorage
}

export interface ModelGatewayEnvReference {
  name: string
}

const EXACT_ENV_REFERENCE = /^\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/
const MAX_GATEWAY_MODELS = 4096

export function parseModelGatewayEnvReference(value: string): ModelGatewayEnvReference | null {
  const match = EXACT_ENV_REFERENCE.exec(value.trim())
  return match ? { name: match[1] } : null
}

export type ModelGatewayCredentialKind = 'empty' | 'environment' | 'stored' | 'legacy-literal'

export function modelGatewayCredentialKind(value: string): ModelGatewayCredentialKind {
  const trimmed = value.trim()
  if (!trimmed) return 'empty'
  if (trimmed === MODEL_GATEWAY_SECRET_REF) return 'stored'
  if (parseModelGatewayEnvReference(trimmed)) return 'environment'
  return 'legacy-literal'
}

export interface GatewayModel {
  id: string
  name?: string
  provider?: string
  contextWindow?: number
  maxOutputTokens?: number
}

export interface ModelDiscoveryResult {
  models: GatewayModel[]
  error?: string
}

export interface ModelGatewayRoutes {
  discovery: string
  openai: string
  anthropic: string
}

export interface ModelGatewayApiKeyResolution {
  value: string
  missing: string[]
  storedSecretMissing: boolean
  invalidReference?: boolean
}

export function resolveModelGatewayApiKey(
  apiKey: string,
  env: Record<string, string | undefined>,
  storedSecret: string | null = null
): ModelGatewayApiKeyResolution {
  const trimmed = apiKey.trim()
  if (trimmed === MODEL_GATEWAY_SECRET_REF) {
    const value = storedSecret?.trim() ?? ''
    return { value, missing: [], storedSecretMissing: !value }
  }
  if (trimmed.includes('${env:')) {
    const reference = parseModelGatewayEnvReference(trimmed)
    if (!reference) return { value: '', missing: [], storedSecretMissing: false, invalidReference: true }
  }
  const reference = parseModelGatewayEnvReference(trimmed)
  if (!reference) return { value: trimmed, missing: [], storedSecretMissing: false }
  const expanded = expandEnvVars(trimmed, env)
  return { value: expanded.value.trim(), missing: expanded.missing, storedSecretMissing: false }
}

/** Derive provider routes from one validated gateway root. */
export function modelGatewayRoutes(baseUrl: string): ModelGatewayRoutes | null {
  const raw = baseUrl.trim().replace(/\/+$/, '')
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password || url.search || url.hash) return null
    const root = url.toString().replace(/\/+$/, '')
    return {
      discovery: `${root}/v1/models`,
      openai: `${root}/openai/v1`,
      anthropic: `${root}/anthropic`
    }
  } catch {
    return null
  }
}

function tokenLimit(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined
}

/** Parse an OpenAI-compatible model response and retain only bounded, unique ids. */
export function parseGatewayModels(payload: unknown): GatewayModel[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { data?: unknown }).data)) return []
  const byId = new Map<string, GatewayModel>()
  for (const candidate of (payload as { data: unknown[] }).data) {
    if (!candidate || typeof candidate !== 'object') continue
    const row = candidate as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    if (!id || id.length > 500 || /[\u0000-\u001f\u007f]/.test(id)) continue
    if (byId.size >= MAX_GATEWAY_MODELS && !byId.has(id)) continue
    const explicitProvider = typeof row.provider === 'string'
      ? row.provider.trim()
      : typeof row.owned_by === 'string'
        ? row.owned_by.trim()
        : ''
    const slash = id.indexOf('/')
    const contextWindow = tokenLimit(row.context_length) ?? tokenLimit(row.max_context_length) ?? tokenLimit(row.context_window)
    const maxOutputTokens = tokenLimit(row.max_output_tokens) ?? tokenLimit(row.max_completion_tokens)
    byId.set(id, {
      id,
      ...(typeof row.name === 'string' && row.name.trim() ? { name: row.name.trim() } : {}),
      ...(explicitProvider || slash > 0 ? { provider: explicitProvider || id.slice(0, slash) } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxOutputTokens ? { maxOutputTokens } : {})
    })
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function modelsForAgent(models: GatewayModel[], agentId: AgentId): GatewayModel[] {
  return canSwitchModel(agentId) ? models : []
}

/** Names copied into tmux's environment so gateway values never travel in argv. */
export const MODEL_GATEWAY_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'COPILOT_PROVIDER_BASE_URL',
  'COPILOT_PROVIDER_TYPE',
  'COPILOT_PROVIDER_API_KEY',
  'COPILOT_PROVIDER_MODEL_ID',
  'COPILOT_PROVIDER_WIRE_MODEL',
  'COPILOT_PROVIDER_WIRE_API',
  'COPILOT_PROVIDER_MAX_PROMPT_TOKENS',
  'COPILOT_PROVIDER_MAX_OUTPUT_TOKENS'
] as const

const TMUX_STOCK_UPDATE_ENV = [
  'DISPLAY',
  'KRB5CCNAME',
  'SSH_ASKPASS',
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'SSH_CONNECTION',
  'WINDOWID',
  'XAUTHORITY'
]

export function tmuxUpdateEnvironmentLine(): string {
  return `set -g update-environment "${[...TMUX_STOCK_UPDATE_ENV, ...MODEL_GATEWAY_ENV_KEYS].join(' ')}"`
}

export function normalizedAgentModel(agentId: AgentId, model: string | undefined): string | null {
  const value = model?.trim()
  if (!value || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value) || !canSwitchModel(agentId)) return null
  return value
}

export function withAgentModel(cmd: string, agentId: AgentId, model: string | undefined): string {
  const value = normalizedAgentModel(agentId, model)
  if (!value || capabilityAgentId(agentId) === 'copilot') return cmd
  return `${cmd} --model ${shellSingleQuote(value)}`
}

export function modelGatewayEnv(
  settings: ModelGatewaySettings,
  agentId: AgentId,
  model?: string,
  processEnv: Record<string, string | undefined> = {},
  storedSecret: string | null = null,
  models: GatewayModel[] = []
): Record<string, string> {
  const routes = modelGatewayRoutes(settings.baseUrl)
  const resolved = resolveModelGatewayApiKey(settings.apiKey, processEnv, storedSecret)
  if (!routes || !resolved.value || resolved.missing.length || resolved.storedSecretMissing || !canSwitchModel(agentId)) return {}
  switch (capabilityAgentId(agentId)) {
    case 'claude':
      return { ANTHROPIC_BASE_URL: routes.anthropic, ANTHROPIC_AUTH_TOKEN: resolved.value }
    case 'codex':
      return { OPENAI_BASE_URL: routes.openai, OPENAI_API_KEY: resolved.value }
    case 'copilot': {
      const wireModel = normalizedAgentModel(agentId, model)
      if (!wireModel) return {}
      const slash = wireModel.indexOf('/')
      const provider = slash > 0 ? wireModel.slice(0, slash).toLowerCase() : ''
      const modelId = slash > 0 ? wireModel.slice(slash + 1) : wireModel
      const anthropic = provider === 'anthropic'
      const discovered = models.find((entry) => entry.id === wireModel)
      return {
        COPILOT_PROVIDER_BASE_URL: anthropic ? routes.anthropic : routes.openai,
        COPILOT_PROVIDER_TYPE: anthropic ? 'anthropic' : 'openai',
        COPILOT_PROVIDER_API_KEY: resolved.value,
        COPILOT_PROVIDER_MODEL_ID: modelId,
        COPILOT_PROVIDER_WIRE_MODEL: wireModel,
        ...(!anthropic && /^gpt-5(?:[.-]|$)/i.test(modelId) ? { COPILOT_PROVIDER_WIRE_API: 'responses' } : {}),
        ...(discovered?.contextWindow ? { COPILOT_PROVIDER_MAX_PROMPT_TOKENS: String(discovered.contextWindow) } : {}),
        ...(discovered?.maxOutputTokens ? { COPILOT_PROVIDER_MAX_OUTPUT_TOKENS: String(discovered.maxOutputTokens) } : {})
      }
    }
    default:
      return {}
  }
}
