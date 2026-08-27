/**
 * Safe intent and host-side operation contracts for the Open WebUI hosting node.
 *
 * The project file carries only the user's chosen provider mode and model. Docker context names,
 * container and volume identifiers, URLs, paths, process state, and credential references belong
 * to the machine-local execution overlay. Importing this shape therefore cannot contact a host or
 * start a process.
 */

export const OPEN_WEBUI_IMAGE = 'ghcr.io/open-webui/open-webui:v0.6.37'
export const OPEN_WEBUI_DEFAULT_PORT = 3000
export const OPEN_WEBUI_DATA_MOUNT = '/app/backend/data'
export const OPEN_WEBUI_SCHEMA_VERSION = 1 as const

export type OpenWebUiProviderKind = 'ollama' | 'openai-compatible'
export type OpenWebUiHealth = 'unbound' | 'checking' | 'running' | 'needs-setup' | 'stopped' | 'unreachable' | 'failed'
export type OpenWebUiOperation = 'deploy' | 'backup' | 'restore' | 'update' | 'rollback'

export interface OpenWebUiIntent {
  schemaVersion: typeof OPEN_WEBUI_SCHEMA_VERSION
  featureId: 'open-webui-hosting'
  provider: OpenWebUiProviderKind
  model: string
  reuseOllama: boolean
  port: number
}

export interface OpenWebUiLocalBinding {
  context: string
  containerName: string
  volumeName: string
  endpoint: string
  providerEndpoint?: string
  providerCredentialKey?: string
  image: string
  previousImage?: string
  lastBackupAt?: number
  updatedAt: number
}

export interface OpenWebUiState {
  health: OpenWebUiHealth
  endpoint: string | null
  context: string | null
  containerName: string | null
  volumeName: string | null
  providerEndpoint?: string
  image: string | null
  provider: OpenWebUiProviderKind
  model: string
  setupRequired: boolean
  detail: string
  checkedAt: number
}

export interface OpenWebUiContext {
  name: string
  current: boolean
  kind: 'local' | 'ssh' | 'other'
  available: boolean
  endpointLabel: string
  reason?: string
}

export interface OpenWebUiJobProgress {
  jobId: string
  nodeId: string
  operation: OpenWebUiOperation
  phase: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  completedSteps: number
  totalSteps: number
  message: string
  detail?: string
}

export type OpenWebUiOperationInput =
  | { operation: 'deploy'; nodeId: string; intent: OpenWebUiIntent; context: string; providerEndpoint?: string; providerCredentialKey?: string }
  | { operation: 'backup'; nodeId: string; destination: string }
  | { operation: 'restore'; nodeId: string; source: string }
  | { operation: 'update'; nodeId: string; intent: OpenWebUiIntent }
  | { operation: 'rollback'; nodeId: string; intent: OpenWebUiIntent }

export interface OpenWebUiApi {
  contexts(): Promise<OpenWebUiContext[]>
  state(nodeId: string, intent: OpenWebUiIntent): Promise<OpenWebUiState>
  run(input: OpenWebUiOperationInput): Promise<{ jobId: string }>
  health(nodeId: string, intent: OpenWebUiIntent): Promise<OpenWebUiState>
  cancel(jobId: string): void
  onProgress(listener: (progress: OpenWebUiJobProgress) => void): () => void
}

export const OPEN_WEBUI_DEFAULT_INTENT: OpenWebUiIntent = {
  schemaVersion: OPEN_WEBUI_SCHEMA_VERSION,
  featureId: 'open-webui-hosting',
  provider: 'ollama',
  model: 'llama3.2',
  reuseOllama: true,
  port: OPEN_WEBUI_DEFAULT_PORT
}

const SAFE_MODEL = /^[a-z0-9][a-z0-9._-]{0,90}(?::[a-z0-9._-]{1,40})?$/i
const SAFE_CONTEXT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_CREDENTIAL_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/

export function isSafeOpenWebUiModel(value: unknown): value is string {
  return typeof value === 'string' && SAFE_MODEL.test(value.trim())
}

export function isSafeOpenWebUiContext(value: unknown): value is string {
  return typeof value === 'string' && SAFE_CONTEXT.test(value.trim())
}

export function isSafeOpenWebUiCredentialKey(value: unknown): value is string {
  return typeof value === 'string' && SAFE_CREDENTIAL_KEY.test(value.trim())
}

export function isSafeOpenWebUiPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 65535
}

export function safeOpenWebUiIntent(value: unknown): OpenWebUiIntent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== OPEN_WEBUI_SCHEMA_VERSION || raw.featureId !== 'open-webui-hosting') return undefined
  if (raw.provider !== 'ollama' && raw.provider !== 'openai-compatible') return undefined
  if (!isSafeOpenWebUiModel(raw.model) || !isSafeOpenWebUiPort(raw.port) || typeof raw.reuseOllama !== 'boolean') return undefined
  if (raw.provider === 'ollama' && !raw.reuseOllama) return undefined
  return {
    schemaVersion: OPEN_WEBUI_SCHEMA_VERSION,
    featureId: 'open-webui-hosting',
    provider: raw.provider,
    model: raw.model.trim(),
    reuseOllama: raw.reuseOllama,
    port: raw.port
  }
}

export function safeOpenWebUiEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) return false
    return !/[\u0000-\u001f\u007f]/.test(value)
  } catch {
    return false
  }
}

export function safeOpenWebUiCredentialRef(value: unknown): string | undefined {
  return isSafeOpenWebUiCredentialKey(value) ? value.trim() : undefined
}

const SAFE_DOCKER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

export function safeOpenWebUiLocalBinding(value: unknown): OpenWebUiLocalBinding | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (!isSafeOpenWebUiContext(raw.context) || !SAFE_DOCKER_NAME.test(String(raw.containerName ?? '')) || !SAFE_DOCKER_NAME.test(String(raw.volumeName ?? ''))) return undefined
  if (!safeOpenWebUiEndpoint(raw.endpoint) || raw.image !== OPEN_WEBUI_IMAGE || typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)) return undefined
  if (raw.providerEndpoint !== undefined && !safeOpenWebUiEndpoint(raw.providerEndpoint)) return undefined
  if (raw.providerCredentialKey !== undefined && !isSafeOpenWebUiCredentialKey(raw.providerCredentialKey)) return undefined
  if (raw.previousImage !== undefined && (typeof raw.previousImage !== 'string' || raw.previousImage.length > 256)) return undefined
  return {
    context: raw.context.trim(),
    containerName: String(raw.containerName),
    volumeName: String(raw.volumeName),
    endpoint: raw.endpoint,
    ...(raw.providerEndpoint ? { providerEndpoint: raw.providerEndpoint } : {}),
    ...(raw.providerCredentialKey ? { providerCredentialKey: raw.providerCredentialKey } : {}),
    image: OPEN_WEBUI_IMAGE,
    ...(raw.previousImage ? { previousImage: raw.previousImage } : {}),
    ...(typeof raw.lastBackupAt === 'number' && Number.isFinite(raw.lastBackupAt) ? { lastBackupAt: raw.lastBackupAt } : {}),
    updatedAt: raw.updatedAt
  }
}
