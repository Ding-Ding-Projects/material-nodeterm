/**
 * Cloudflare connector runtime contract. The renderer only sees opaque status and lifecycle
 * operations. Connector tokens are written by the desktop shell to a protected local file and
 * are never included in this contract, a process argument, or an environment variable.
 */

export const CLOUDFLARED_DEFAULT_IMAGE = 'cloudflare/cloudflared:2025.8.1'
export const CLOUDFLARED_TOKEN_FILE_NAME = 'cloudflared-connector.token'

export type CloudflaredRuntimeKind = 'process' | 'windows-service' | 'docker'

export type CloudflaredRuntimePhase =
  | 'unconfigured'
  | 'dependency-missing'
  | 'ready'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'degraded'
  | 'failed'

export interface CloudflaredRuntimeSettings {
  runtime: CloudflaredRuntimeKind
  /** A validated absolute origin URL. The tunnel token remains separate. */
  origin: string
  /** Optional pinned Docker image. Tags are resolved to a digest before launch. */
  image: string
  /** Bounded resources applied to Docker connectors. */
  cpus: number
  memoryMb: number
  pidsLimit: number
}

/** Re-validates the machine-local overlay before a node can use it after restart. */
export function safeCloudflaredRuntimeSettings(value: unknown): CloudflaredRuntimeSettings | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (raw.runtime !== 'process' && raw.runtime !== 'windows-service' && raw.runtime !== 'docker') return undefined
  if (typeof raw.origin !== 'string' || raw.origin.length > 2048) return undefined
  let parsed: URL
  try { parsed = new URL(raw.origin) } catch { return undefined }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return undefined
  if (typeof raw.image !== 'string' || !/^cloudflare\/cloudflared(?::[A-Za-z0-9._-]+|@sha256:[a-f0-9]{64})$/.test(raw.image)) return undefined
  const finite = (v: unknown, fallback: number): number => typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return {
    runtime: raw.runtime,
    origin: parsed.href,
    image: raw.image,
    cpus: Math.min(4, Math.max(0.25, finite(raw.cpus, 1))),
    memoryMb: Math.min(4096, Math.max(128, Math.round(finite(raw.memoryMb, 512)))),
    pidsLimit: Math.min(1024, Math.max(32, Math.round(finite(raw.pidsLimit, 128))))
  }
}

export interface CloudflaredRuntimeStatus {
  phase: CloudflaredRuntimePhase
  runtime: CloudflaredRuntimeKind
  pid: number | null
  containerName: string | null
  imageDigest: string | null
  tokenFile: string | null
  startedAt: number | null
  lastHealthAt: number | null
  health: 'unknown' | 'healthy' | 'unhealthy'
  detail: string | null
  /** Connector output is bounded and redacted before it crosses the IPC boundary. */
  recentLog: string[]
}

export interface CloudflaredRuntimeApi {
  status(nodeId: string, runtime?: CloudflaredRuntimeKind): Promise<CloudflaredRuntimeStatus>
  /** Stores a token in the OS-protected app-data location. The value is not persisted in settings. */
  setToken(nodeId: string, token: string): Promise<{ ok: true } | { ok: false; error: string }>
  clearToken(nodeId: string): Promise<void>
  start(nodeId: string, settings: CloudflaredRuntimeSettings): Promise<CloudflaredRuntimeStatus>
  stop(nodeId: string): Promise<CloudflaredRuntimeStatus>
  uninstall(nodeId: string): Promise<{ ok: true } | { ok: false; error: string }>
  reconcile(nodeId: string, runtime?: CloudflaredRuntimeKind): Promise<CloudflaredRuntimeStatus>
  /** Opens the Windows service manager with an explicit UAC consent step when required. */
  installWindowsService(nodeId: string, settings: CloudflaredRuntimeSettings): Promise<CloudflaredRuntimeStatus>
  onStatus(listener: (event: { nodeId: string; status: CloudflaredRuntimeStatus }) => void): () => void
}
