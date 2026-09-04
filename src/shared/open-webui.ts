/**
 * Typed Open WebUI hosting contract.
 *
 * The renderer can choose a Docker context, port, Ollama reuse, and an
 * OpenAI-compatible endpoint. It cannot choose an image, command, entrypoint,
 * arbitrary environment, or socket. Secrets are represented only by an
 * operating-system credential key and never cross this boundary.
 */

export const OPEN_WEBUI_IMAGE = 'ghcr.io/open-webui/open-webui:v0.8.3' as const
export const OPEN_WEBUI_IMAGE_SOURCE = 'https://docs.openwebui.com/getting-started/quick-start/' as const
export const OPEN_WEBUI_CONTAINER_PORT = 8080
export const OPEN_WEBUI_DEFAULT_PORT = 3000
export const OPEN_WEBUI_VOLUME_PREFIX = 'nodeterm-open-webui-'

export type OpenWebUiProviderKind = 'ollama' | 'openai-compatible'

export interface OpenWebUiProvider {
  kind: OpenWebUiProviderKind
  /** HTTPS or explicitly loopback HTTP only. */
  endpoint?: string
  /** Opaque key for the OS credential vault, never a token or API key. */
  credentialKey?: string
  model?: string
}

export interface OpenWebUiConfigureInput {
  id: string
  /** Existing named Docker context. Empty means the current context. */
  context: string
  /** Host port bound to loopback only. */
  port: number
  /** Reuse the host's already-running Ollama service through host.docker.internal. */
  reuseExistingOllama: boolean
  provider: OpenWebUiProvider
}

export interface OpenWebUiConfig extends OpenWebUiConfigureInput {
  schemaVersion: 1
  dataVolume: string
  image: typeof OPEN_WEBUI_IMAGE
  createdAt: number
  previousImage?: string
}

export type OpenWebUiPhase =
  | 'unconfigured'
  | 'docker-unavailable'
  | 'ollama-unavailable'
  | 'stopped'
  | 'starting'
  | 'awaiting-first-user'
  | 'ready'
  | 'backing-up'
  | 'restoring'
  | 'updating'
  | 'rolling-back'
  | 'error'

export interface OpenWebUiBackupSummary {
  id: string
  createdAt: number
  sizeBytes: number
  image: string
  /** True when created automatically before restore/update/rollback. */
  automatic: boolean
}

export interface OpenWebUiStatus {
  id: string
  phase: OpenWebUiPhase
  context: string | null
  port: number | null
  localUrl: string | null
  image: string | null
  dataVolume: string | null
  containerName: string | null
  /** Docker's observed container state, not a locally assumed state. */
  containerState: 'running' | 'exited' | 'missing' | 'unknown'
  health: 'ready' | 'starting' | 'unhealthy' | 'unreachable' | 'unknown'
  bootstrap: 'not-created' | 'first-user-required' | 'configured' | 'unknown'
  reusedOllama: boolean
  provider: OpenWebUiProviderKind | null
  backups: OpenWebUiBackupSummary[]
  progress: number | null
  message: string | null
  error: string | null
}

export interface OpenWebUiApi {
  configure(input: OpenWebUiConfigureInput): Promise<OpenWebUiStatus>
  status(id: string): Promise<OpenWebUiStatus>
  start(id: string): Promise<OpenWebUiStatus>
  stop(id: string): Promise<OpenWebUiStatus>
  listBackups(id: string): Promise<OpenWebUiBackupSummary[]>
  createBackup(id: string): Promise<OpenWebUiStatus>
  restoreBackup(id: string, backupId: string): Promise<OpenWebUiStatus>
  update(id: string): Promise<OpenWebUiStatus>
  rollback(id: string): Promise<OpenWebUiStatus>
  /** Returns the safe handoff intent. It never creates a tunnel or publishes a port. */
  tunnelHandoff(id: string): Promise<{ ok: boolean; localUrl: string | null; reason: string }>
  onEvent(listener: (status: OpenWebUiStatus) => void): () => void
}
