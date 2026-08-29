/**
 * Typed Docker host management contracts shared by the desktop, Server Edition and renderer.
 *
 * The manager deliberately models Docker operations as data. Callers never provide a shell
 * command or Compose source; the core turns these values into a validated argv list for either the
 * local Docker CLI or an SSH transport.
 */

export type DockerHostTransport =
  | { kind: 'local'; context?: string }
  | { kind: 'ssh'; serverId: string }

export interface DockerHostTarget {
  id: string
  label: string
  transport: DockerHostTransport
  /** Machine-local display metadata. It is never written to a portable project projection. */
  endpoint: string
  configuredAt: number
}

export interface DockerHostVerification {
  hostId: string
  reachable: boolean
  serverVersion: string | null
  apiVersion: string | null
  operatingSystem: string | null
  architecture: string | null
  containers: number | null
  images: number | null
  checkedAt: number
  error: string | null
}

export interface DockerContextInfo {
  name: string
  current: boolean
  endpoint: string
}

export interface DockerContainerSummary {
  id: string
  name: string
  image: string
  command: string
  createdAt: string
  status: string
  state: 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead' | 'unknown'
  ports: string
  labels: Record<string, string>
}

export interface DockerImageSummary {
  id: string
  repository: string
  tag: string
  digest: string | null
  createdAt: string
  sizeBytes: number | null
}

export interface DockerVolumeSummary {
  name: string
  driver: string
  mountpoint: string
  scope: string
  labels: Record<string, string>
}

export interface DockerNetworkSummary {
  id: string
  name: string
  driver: string
  scope: string
  ipv6: boolean | null
  internal: boolean | null
  labels: Record<string, string>
}

export interface DockerComposeProfile {
  id: string
  label: string
  /** Absolute machine-local Compose file path, intentionally never portable. */
  filePath: string
  projectName: string
  services: string[]
  updatedAt: number
}

export interface DockerComposeSummary {
  service: string
  container: string
  image: string
  state: string
  ports: string
}

export interface DockerContainerStats {
  containerId: string
  name: string
  cpuPercent: number | null
  memoryUsageBytes: number | null
  memoryLimitBytes: number | null
  memoryPercent: number | null
  netInputBytes: number | null
  netOutputBytes: number | null
  blockInputBytes: number | null
  blockOutputBytes: number | null
  pids: number | null
}

export interface DockerLogOptions {
  containerId: string
  tail: number
  timestamps: boolean
  since?: string
}

export interface DockerExecRequest {
  containerId: string
  program: 'sh' | 'bash' | 'node' | 'python' | 'env'
  args: string[]
  tty?: boolean
}

export interface DockerExecResult {
  exitCode: number
  stdout: string
  stderr: string
  truncated: boolean
}

export type DockerDestructiveKind = 'container-remove' | 'image-remove' | 'volume-remove' | 'network-remove' | 'compose-down'

export interface DockerDestructivePreview {
  kind: DockerDestructiveKind
  hostId: string
  targetIds: string[]
  title: string
  detail: string
  irreversible: boolean
  requiresConfirmation: true
}

export interface DockerHostSnapshot {
  host: DockerHostTarget
  verification: DockerHostVerification | null
  containers: DockerContainerSummary[]
  images: DockerImageSummary[]
  volumes: DockerVolumeSummary[]
  networks: DockerNetworkSummary[]
  compose: DockerComposeSummary[]
  readAt: number
}

export interface DockerHostApi {
  listHosts(): Promise<DockerHostTarget[]>
  saveHost(input: { id?: string; label: string; transport: DockerHostTransport }): Promise<DockerHostTarget>
  removeHost(id: string): Promise<void>
  verify(hostId: string): Promise<DockerHostVerification>
  listContexts(hostId: string): Promise<DockerContextInfo[]>
  inventory(hostId: string): Promise<DockerHostSnapshot>
  listContainers(hostId: string): Promise<DockerContainerSummary[]>
  listImages(hostId: string): Promise<DockerImageSummary[]>
  listVolumes(hostId: string): Promise<DockerVolumeSummary[]>
  listNetworks(hostId: string): Promise<DockerNetworkSummary[]>
  listCompose(hostId: string, profile: DockerComposeProfile): Promise<DockerComposeSummary[]>
  startContainer(hostId: string, id: string): Promise<void>
  stopContainer(hostId: string, id: string, timeoutSeconds?: number): Promise<void>
  restartContainer(hostId: string, id: string, timeoutSeconds?: number): Promise<void>
  pauseContainer(hostId: string, id: string): Promise<void>
  unpauseContainer(hostId: string, id: string): Promise<void>
  stats(hostId: string, ids?: string[]): Promise<DockerContainerStats[]>
  logs(hostId: string, options: DockerLogOptions): Promise<string>
  exec(hostId: string, request: DockerExecRequest): Promise<DockerExecResult>
  previewDestructive(input: { hostId: string; kind: DockerDestructiveKind; ids: string[] }): Promise<DockerDestructivePreview>
  removeContainers(hostId: string, ids: string[], confirmed: boolean): Promise<void>
  removeImages(hostId: string, ids: string[], confirmed: boolean): Promise<void>
  removeVolumes(hostId: string, ids: string[], confirmed: boolean): Promise<void>
  removeNetworks(hostId: string, ids: string[], confirmed: boolean): Promise<void>
  composeUp(hostId: string, profile: DockerComposeProfile, services?: string[]): Promise<void>
  composeDown(hostId: string, profile: DockerComposeProfile, confirmed: boolean): Promise<void>
}

export const DOCKER_HOST_DEFAULT_EXEC_PROGRAMS: readonly DockerExecRequest['program'][] = [
  'sh', 'bash', 'node', 'python', 'env'
]
