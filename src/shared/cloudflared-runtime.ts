/**
 * Guided cloudflared connector runtime contracts.
 *
 * The renderer selects a typed runtime and discovered local resources. It never supplies a
 * command line, environment block, token, service account, or arbitrary Docker image. The
 * runtime binding is machine-local; only the safe intent belongs in a portable project file.
 */

export const CLOUDFLARED_RUNTIME_SCHEMA_VERSION = 1 as const
export const CLOUDFLARED_IMAGE = 'cloudflare/cloudflared:2025.8.1' as const
export const CLOUDFLARED_CONTAINER_PREFIX = 'nodeterm-cloudflared' as const
export const CLOUDFLARED_SERVICE_PREFIX = 'nodeterm-cloudflared-' as const

export type CloudflaredRuntimeKind = 'user-process' | 'windows-service' | 'docker'
export type CloudflaredRuntimeState =
  | 'unconfigured'
  | 'disabled'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed'

export type CloudflaredDisabledReason =
  | 'platform-unsupported'
  | 'executable-missing'
  | 'docker-unavailable'
  | 'context-unavailable'
  | 'network-unavailable'
  | 'credential-missing'
  | 'credential-store-unavailable'
  | 'service-permission-required'
  | 'service-unavailable'
  | 'invalid-selection'

export interface CloudflaredRuntimeIntent {
  schemaVersion: typeof CLOUDFLARED_RUNTIME_SCHEMA_VERSION
  featureId: 'cloudflared-runtimes'
  nodeId: string
  layout: { x: number; y: number; width: number; height: number }
  runtime: CloudflaredRuntimeKind
  tunnelRef: string
  autoStart: boolean
  dockerNetworkIntent: 'none' | 'selected-network'
  relationships: string[]
}

export interface CloudflaredRuntimeBinding {
  nodeId: string
  runtime: CloudflaredRuntimeKind
  tunnelRef: string
  credentialRef: string
  owner: 'current-user'
  executablePath?: string
  serviceName?: string
  dockerContext?: string
  dockerNetwork?: string
  tokenFile?: string
  containerName?: string
}

export interface CloudflaredRuntimeRecord {
  intent: CloudflaredRuntimeIntent
  binding: CloudflaredRuntimeBinding | null
  state: CloudflaredRuntimeState
  reason?: CloudflaredDisabledReason
  detail?: string
  updatedAt: number
}

export interface CloudflaredRuntimeOption {
  runtime: CloudflaredRuntimeKind
  available: boolean
  label: string
  reason?: CloudflaredDisabledReason
  detail?: string
  requiresElevation: boolean
  portable: boolean
}

export interface CloudflaredExecutable {
  path: string
  version: string
  source: 'discovered-path' | 'selected-file'
}

export interface CloudflaredDockerContext {
  name: string
  current: boolean
  endpointLabel: string
  available: boolean
  reason?: string
}

export interface CloudflaredDockerNetwork {
  id: string
  name: string
  driver: string
  internal: boolean
}

export interface CloudflaredRuntimeSelection {
  nodeId: string
  runtime: CloudflaredRuntimeKind
  tunnelRef: string
  credentialRef: string
  executablePath?: string
  serviceName?: string
  dockerContext?: string
  dockerNetwork?: string
}

export interface CloudflaredRuntimeProgress {
  nodeId: string
  operationId: string
  runtime: CloudflaredRuntimeKind
  phase: 'queued' | 'starting' | 'health-check' | 'running' | 'stopping' | 'completed' | 'failed' | 'cancelled'
  completedSteps: number
  totalSteps: number
  message: string
  detail?: string
}

export interface CloudflaredRuntimeHealth {
  state: 'healthy' | 'starting' | 'stopped' | 'failed' | 'unknown'
  detail: string
  checkedAt: number
}

export interface CloudflaredRuntimeApi {
  options(): Promise<CloudflaredRuntimeOption[]>
  executables(): Promise<CloudflaredExecutable[]>
  dockerContexts(): Promise<CloudflaredDockerContext[]>
  dockerNetworks(context: string): Promise<CloudflaredDockerNetwork[]>
  records(): Promise<CloudflaredRuntimeRecord[]>
  saveIntent(intent: CloudflaredRuntimeIntent): Promise<CloudflaredRuntimeRecord>
  saveCredential(credentialRef: string, token: string): Promise<void>
  clearCredential(credentialRef: string): Promise<void>
  credentialStatus(credentialRef: string): Promise<{ available: boolean; reason?: 'missing' | 'unavailable' | 'corrupt' }>
  start(selection: CloudflaredRuntimeSelection): Promise<{ operationId: string }>
  stop(nodeId: string): Promise<{ operationId: string }>
  restart(nodeId: string): Promise<{ operationId: string }>
  health(nodeId: string): Promise<CloudflaredRuntimeHealth>
  cancel(operationId: string): void
  onProgress(listener: (progress: CloudflaredRuntimeProgress) => void): () => void
}

export const CLOUDFLARED_RUNTIME_SEARCH_FIELDS = [
  { id: 'runtime-options', scope: 'runtime options', regexBuilder: 'anchored-full' },
  { id: 'executable-picker', scope: 'discovered cloudflared executables', regexBuilder: 'anchored-full' },
  { id: 'service-picker', scope: 'owned Windows services', regexBuilder: 'anchored-full' },
  { id: 'docker-context-picker', scope: 'discovered Docker contexts', regexBuilder: 'anchored-full' },
  { id: 'docker-network-picker', scope: 'discovered Docker networks', regexBuilder: 'anchored-full' },
  { id: 'runtime-records', scope: 'configured connector runtimes', regexBuilder: 'anchored-full' }
] as const

/** Safe portable project projection. It contains no path, credential, host id, process state, or cache. */
export const CLOUDFLARED_RUNTIME_PORTABLE_BLUEPRINT = {
  schemaVersion: CLOUDFLARED_RUNTIME_SCHEMA_VERSION,
  featureId: 'cloudflared-runtimes',
  nodeId: 'selected-at-node-creation',
  layout: { x: 0, y: 0, width: 420, height: 320 },
  runtime: 'user-process',
  tunnelRef: 'selected-tunnel-reference',
  autoStart: false,
  dockerNetworkIntent: 'none',
  relationships: []
} as const

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_PATH = /^(?:[A-Za-z]:[\\/][^\r\n\0]+|[\\/][^\r\n\0]+)$/

export function assertCloudflaredId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value) || /[<>|&;$`]/.test(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

export function assertCloudflaredName(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_NAME.test(value)) throw new Error(`${label} is invalid.`)
  return value
}

export function assertCloudflaredPath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_PATH.test(value) || /[,\r\n\0]/.test(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

export function validateCloudflaredIntent(value: unknown): CloudflaredRuntimeIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Cloudflared portable intent is invalid.')
  const input = value as Record<string, unknown>
  const allowed = new Set(['schemaVersion', 'featureId', 'nodeId', 'layout', 'runtime', 'tunnelRef', 'autoStart', 'dockerNetworkIntent', 'relationships'])
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error('Cloudflared portable intent contains an unknown field.')
  if (input.schemaVersion !== CLOUDFLARED_RUNTIME_SCHEMA_VERSION || input.featureId !== 'cloudflared-runtimes') {
    throw new Error('Cloudflared portable intent version is unsupported.')
  }
  if (!['user-process', 'windows-service', 'docker'].includes(String(input.runtime))) throw new Error('Cloudflared runtime selection is invalid.')
  if (typeof input.autoStart !== 'boolean' || !['none', 'selected-network'].includes(String(input.dockerNetworkIntent))) throw new Error('Cloudflared portable settings are invalid.')
  if (!input.layout || typeof input.layout !== 'object' || Array.isArray(input.layout)) throw new Error('Cloudflared layout is invalid.')
  const layout = input.layout as Record<string, unknown>
  if (!['x', 'y', 'width', 'height'].every((key) => typeof layout[key] === 'number' && Number.isFinite(layout[key]))) throw new Error('Cloudflared layout is invalid.')
  if (Math.abs(Number(layout.x)) > 1_000_000 || Math.abs(Number(layout.y)) > 1_000_000 || Number(layout.width) < 160 || Number(layout.width) > 4_000 || Number(layout.height) < 120 || Number(layout.height) > 4_000) throw new Error('Cloudflared layout is outside the supported bounds.')
  if (!Array.isArray(input.relationships) || input.relationships.length > 256 || input.relationships.some((item) => typeof item !== 'string' || !SAFE_ID.test(item))) throw new Error('Cloudflared relationships are invalid.')
  return {
    schemaVersion: CLOUDFLARED_RUNTIME_SCHEMA_VERSION,
    featureId: 'cloudflared-runtimes',
    nodeId: assertCloudflaredId(input.nodeId, 'Cloudflared node id'),
    layout: { x: Number(layout.x), y: Number(layout.y), width: Number(layout.width), height: Number(layout.height) },
    runtime: input.runtime as CloudflaredRuntimeKind,
    tunnelRef: assertCloudflaredId(input.tunnelRef, 'Cloudflared tunnel reference'),
    autoStart: input.autoStart,
    dockerNetworkIntent: input.dockerNetworkIntent as 'none' | 'selected-network',
    relationships: input.relationships.map((item) => String(item))
  }
}

export function validateCloudflaredSelection(value: unknown): CloudflaredRuntimeSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Cloudflared runtime selection is invalid.')
  const input = value as Record<string, unknown>
  if (!['user-process', 'windows-service', 'docker'].includes(String(input.runtime))) throw new Error('Choose a supported cloudflared runtime.')
  const selection: CloudflaredRuntimeSelection = {
    nodeId: assertCloudflaredId(input.nodeId, 'Cloudflared node id'),
    runtime: input.runtime as CloudflaredRuntimeKind,
    tunnelRef: assertCloudflaredId(input.tunnelRef, 'Cloudflared tunnel reference'),
    credentialRef: assertCloudflaredId(input.credentialRef, 'Cloudflared credential reference')
  }
  if (input.runtime !== 'docker') {
    if (input.executablePath !== undefined) selection.executablePath = assertCloudflaredPath(input.executablePath, 'Cloudflared executable path')
    if (input.serviceName !== undefined) selection.serviceName = assertCloudflaredName(input.serviceName, 'Cloudflared service name')
  }
  if (input.runtime === 'docker') {
    if (input.dockerContext !== undefined) selection.dockerContext = assertCloudflaredName(input.dockerContext, 'Docker context')
    if (input.dockerNetwork !== undefined) selection.dockerNetwork = assertCloudflaredName(input.dockerNetwork, 'Docker network')
  }
  return selection
}

/** Fixed argv for the user-process connector. The token value is never an argument or environment value. */
export function cloudflaredRunArgs(tunnelRef: string, tokenFile: string): string[] {
  return ['tunnel', '--no-autoupdate', 'run', '--token-file', assertCloudflaredPath(tokenFile, 'Cloudflared token file'), assertCloudflaredId(tunnelRef, 'Cloudflared tunnel reference')]
}

/** `sc.exe` receives one fixed service command string, built only from validated values. */
export function cloudflaredWindowsServiceArgs(serviceName: string, executablePath: string, tunnelRef: string, tokenFile: string): string[] {
  const name = assertCloudflaredName(serviceName, 'Cloudflared service name')
  const executable = assertCloudflaredPath(executablePath, 'Cloudflared executable path')
  const tunnel = assertCloudflaredId(tunnelRef, 'Cloudflared tunnel reference')
  const token = assertCloudflaredPath(tokenFile, 'Cloudflared token file')
  const binPath = `"${executable}" tunnel --no-autoupdate run --token-file "${token}" ${tunnel}`
  return ['create', name, 'binPath=', binPath, 'start=', 'auto', 'DisplayName=', `nodeterm cloudflared ${name}`]
}

/** Fixed Docker connector invocation. The image is pinned and the token is a read-only file mount. */
export function cloudflaredDockerArgs(context: string, network: string, containerName: string, tokenSource: string, tunnelRef: string): string[] {
  const selectedContext = context ? assertCloudflaredName(context, 'Docker context') : ''
  const selectedNetwork = network === 'none' ? 'none' : assertCloudflaredName(network, 'Docker network')
  const name = assertCloudflaredName(containerName, 'Cloudflared container name')
  const source = assertCloudflaredPath(tokenSource, 'Cloudflared token file')
  return [
    ...(selectedContext ? ['--context', selectedContext] : []),
    'run', '--detach', '--rm', '--name', name,
    '--label', 'dev.nodeterm.owner=cloudflared-runtime',
    '--label', 'dev.nodeterm.runtime=cloudflared',
    '--cpus', '1', '--memory', '256m', '--pids-limit', '128',
    '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL', '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--network', selectedNetwork,
    '--mount', `type=bind,source=${source},target=/run/secrets/cloudflared/token,readonly`,
    CLOUDFLARED_IMAGE, ...cloudflaredRunArgs(tunnelRef, '/run/secrets/cloudflared/token')
  ]
}
