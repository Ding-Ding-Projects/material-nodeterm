/**
 * Typed contract for the guided Docker host manager.
 *
 * The renderer never sends a shell command, daemon URL, socket path, Compose file path, or
 * credential. It selects a discovered context, a discovered resource id, and one closed action.
 * Machine paths and Docker's live identifiers remain local runtime state and are intentionally
 * absent from portable project data.
 */

export type DockerHostContextKind = 'local' | 'ssh' | 'other'
export type DockerHostResourceKind = 'containers' | 'images' | 'volumes' | 'networks' | 'compose'

export interface DockerHostContext {
  name: string
  current: boolean
  endpointLabel: string
  kind: DockerHostContextKind
  available: boolean
  reason?: string
}

export interface DockerContainerRow {
  id: string
  name: string
  image: string
  state: string
  status: string
  ports: string
}

export interface DockerImageRow {
  id: string
  repository: string
  tag: string
  size: string
  createdSince: string
}

export interface DockerVolumeRow {
  name: string
  driver: string
  scope: string
}

export interface DockerNetworkRow {
  id: string
  name: string
  driver: string
  scope: string
  internal: boolean
}

export interface DockerComposeRow {
  name: string
  status: string
  configLabel: string
  profiles: string[]
}

export interface DockerContainerStats {
  id: string
  name: string
  cpu: string
  memory: string
  networkIo: string
  blockIo: string
  pids: string
}

export interface DockerHostAreaState<T> {
  rows: T[]
  error?: string
}

export interface DockerHostSnapshot {
  context: DockerHostContext
  capturedAt: number
  containers: DockerHostAreaState<DockerContainerRow>
  images: DockerHostAreaState<DockerImageRow>
  volumes: DockerHostAreaState<DockerVolumeRow>
  networks: DockerHostAreaState<DockerNetworkRow>
  compose: DockerHostAreaState<DockerComposeRow>
  stats: DockerHostAreaState<DockerContainerStats>
}

export const DOCKER_GUIDED_IMAGES = [
  { id: 'node-24', ref: 'node:24-bookworm-slim', label: 'Node 24, Debian slim' },
  { id: 'ubuntu-24', ref: 'ubuntu:24.04', label: 'Ubuntu 24.04' },
  { id: 'debian-bookworm', ref: 'debian:bookworm-slim', label: 'Debian Bookworm slim' }
] as const

export const DOCKER_TYPED_EXEC_TASKS = [
  { id: 'os', label: 'Operating system summary' },
  { id: 'cwd', label: 'Working directory' },
  { id: 'workspace', label: 'Workspace files' },
  { id: 'git-status', label: 'Git status' },
  { id: 'node-version', label: 'Node version' }
] as const

/**
 * Portable schema 3 intent for a newly created Docker host node. The destination context,
 * daemon endpoint, Compose paths, credentials, live ids, statistics, logs, and process state are
 * deliberately absent. Importing this value therefore cannot contact or mutate a host.
 */
export const DOCKER_HOST_PORTABLE_BLUEPRINT = {
  schemaVersion: 1,
  featureId: 'docker-host-manager',
  displayLabel: 'Docker host manager',
  requestedCapabilities: ['docker-context-selection', 'container-lifecycle'],
  safeSettings: {
    contextBinding: 'select-on-this-machine',
    imageCatalogId: 'node-24',
    networkPolicy: 'none',
    readOnlyRoot: true,
    cpuLimit: 1,
    memoryMiB: 512,
    pidsLimit: 128
  },
  relationships: []
} as const

export type DockerTypedExecTask = (typeof DOCKER_TYPED_EXEC_TASKS)[number]['id']

export type DockerHostAction =
  | { type: 'container-lifecycle'; context: string; containerId: string; action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause' }
  | { type: 'container-remove'; context: string; containerId: string }
  | { type: 'container-create'; context: string; image: string; namePrefix: string; network: string; readOnly: boolean }
  | { type: 'image-pull'; context: string; image: string }
  | { type: 'image-remove'; context: string; imageId: string }
  | { type: 'volume-create'; context: string; name: string }
  | { type: 'volume-remove'; context: string; name: string }
  | { type: 'network-create'; context: string; name: string; internal: boolean }
  | { type: 'network-remove'; context: string; networkId: string }
  | { type: 'compose-lifecycle'; context: string; project: string; profile?: string; action: 'start' | 'stop' | 'restart' }
  | { type: 'typed-exec'; context: string; containerId: string; task: DockerTypedExecTask }

export interface DockerHostJobProgress {
  jobId: string
  phase: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  label: string
  completedSteps: number
  totalSteps: number
  message: string
  output?: string
}

export interface DockerHostManagerApi {
  contexts(): Promise<DockerHostContext[]>
  snapshot(context: string): Promise<DockerHostSnapshot>
  logs(context: string, containerId: string): Promise<string>
  run(action: DockerHostAction): Promise<{ jobId: string }>
  cancel(jobId: string): void
  onProgress(listener: (progress: DockerHostJobProgress) => void): () => void
}
