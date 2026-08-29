/**
 * Portable intent and fixed launch policy for the official Nextcloud All-in-One image.
 *
 * This module is deliberately platform-free. It does not call Docker, parse Compose input, or
 * retain a host name, socket path, container id, credential, or process state. A profile can travel
 * with a project safely; the local connection and runtime state are hydrated separately by the
 * host shell.
 */

export const NEXTCLOUD_AIO_NODE_KIND = 'nextcloudaio' as const
export const NEXTCLOUD_AIO_PROFILE_SCHEMA_VERSION = 1 as const

/** Official image, pinned to the multi-architecture manifest digest observed from Docker Hub. */
export const NEXTCLOUD_AIO_IMAGE =
  'nextcloud/all-in-one@sha256:8ef360995740aecc18a471f51da76d4609d964adcbda2e7baefb1e7d1048d3b4' as const
export const NEXTCLOUD_AIO_IMAGE_SOURCE = 'https://hub.docker.com/r/nextcloud/all-in-one' as const

/** AIO's master container exposes these fixed control surfaces. The user may choose host ports. */
export const NEXTCLOUD_AIO_DEFAULT_PORTS = {
  setup: 8080,
  https: 8443
} as const

/** AIO needs this mount to create and manage its child containers. It is read-only at the mount. */
export const NEXTCLOUD_AIO_SOCKET_TARGET = '/var/run/docker.sock' as const

export interface HostingProfileCatalogEntry {
  id: typeof NEXTCLOUD_AIO_NODE_KIND
  title: 'Nextcloud AIO'
  category: 'hosted-services'
  image: typeof NEXTCLOUD_AIO_IMAGE
  source: typeof NEXTCLOUD_AIO_IMAGE_SOURCE
  capabilities: readonly ['files', 'calendar', 'contacts', 'collaboration']
  requires: readonly ['docker-engine', 'docker-cli']
}

/** The catalog entry is explicit so a future Shop or Node Catalog cannot silently omit this profile. */
export const NEXTCLOUD_AIO_CATALOG_ENTRY: HostingProfileCatalogEntry = {
  id: NEXTCLOUD_AIO_NODE_KIND,
  title: 'Nextcloud AIO',
  category: 'hosted-services',
  image: NEXTCLOUD_AIO_IMAGE,
  source: NEXTCLOUD_AIO_IMAGE_SOURCE,
  capabilities: ['files', 'calendar', 'contacts', 'collaboration'],
  requires: ['docker-engine', 'docker-cli']
}

/** Dependency discovery is host-owned. No dependency is accepted from PATH without a host probe. */
export const NEXTCLOUD_AIO_DEPENDENCIES = [
  {
    id: 'docker-engine',
    label: 'Docker Engine',
    source: 'Docker Desktop or a compatible Docker daemon',
    detection: 'host probe: Docker Engine API health'
  },
  {
    id: 'docker-cli',
    label: 'Docker CLI',
    source: 'Docker Desktop bundled CLI or the configured host runtime',
    detection: 'host probe: docker version'
  }
] as const

export type NextcloudAioBinding = 'loopback' | 'private-network'
export type NextcloudAioSetupState =
  | 'not-configured'
  | 'waiting-for-first-login'
  | 'ready'
  | 'needs-attention'

export interface NextcloudAioProfile {
  schemaVersion: typeof NEXTCLOUD_AIO_PROFILE_SCHEMA_VERSION
  image: typeof NEXTCLOUD_AIO_IMAGE
  /** A display-only label. It carries no host or account identity. */
  displayName: string
  /** Safe intent values, not observed runtime capacity. */
  storageGiB: number
  memoryMiB: number
  cpus: number
  setupPort: number
  httpsPort: number
  binding: NextcloudAioBinding
  automaticUpdates: boolean
  backupRetentionDays: number
}

export interface NextcloudAioCapacity {
  availableStorageGiB: number | null
  availableMemoryMiB: number | null
  availableCpus: number | null
}

export interface NextcloudAioCapacityVerdict {
  status: 'ready' | 'insufficient' | 'unknown'
  reasons: string[]
}

export interface NextcloudAioRuntimeState {
  phase: 'unbound' | 'checking' | 'stopped' | 'starting' | 'ready' | 'updating' | 'backing-up' | 'restoring' | 'failed'
  setup: NextcloudAioSetupState
  progress: number | null
  detail: string
  /** Runtime facts are local-only and must never enter the project projection. */
  containerName?: string
  lastBackupAt?: string
  lastError?: string
}

export interface NextcloudAioRunPlan {
  image: typeof NEXTCLOUD_AIO_IMAGE
  containerName: string
  args: string[]
  socketAuthority: 'docker-daemon-control'
  privileged: false
  network: 'bridge'
  ports: { setup: number; https: number }
  volumeName: string
}

export const NEXTCLOUD_AIO_DEFAULT_PROFILE: NextcloudAioProfile = {
  schemaVersion: NEXTCLOUD_AIO_PROFILE_SCHEMA_VERSION,
  image: NEXTCLOUD_AIO_IMAGE,
  displayName: 'Nextcloud AIO',
  storageGiB: 100,
  memoryMiB: 4096,
  cpus: 2,
  setupPort: NEXTCLOUD_AIO_DEFAULT_PORTS.setup,
  httpsPort: NEXTCLOUD_AIO_DEFAULT_PORTS.https,
  binding: 'loopback',
  automaticUpdates: true,
  backupRetentionDays: 7
}

const PROFILE_LIMITS = {
  minStorageGiB: 10,
  maxStorageGiB: 1024 * 1024,
  minMemoryMiB: 2048,
  maxMemoryMiB: 1024 * 1024,
  minCpus: 1,
  maxCpus: 128,
  minPort: 1024,
  maxPort: 65535,
  minBackupRetentionDays: 1,
  maxBackupRetentionDays: 3650,
  maxDisplayNameLength: 128
} as const

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function boundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function safeDisplayName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= PROFILE_LIMITS.maxDisplayNameLength &&
    [...value].every((char) => char >= ' ' && char !== '\u007f')
}

/** Validate portable intent before it is written to project.json or accepted from an import. */
export function validateNextcloudAioProfile(value: unknown): NextcloudAioProfile | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const keys = new Set([
    'schemaVersion', 'image', 'displayName', 'storageGiB', 'memoryMiB', 'cpus', 'setupPort',
    'httpsPort', 'binding', 'automaticUpdates', 'backupRetentionDays'
  ])
  if (Object.keys(raw).some((key) => !keys.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key))) return undefined
  if (
    raw.schemaVersion !== NEXTCLOUD_AIO_PROFILE_SCHEMA_VERSION ||
    raw.image !== NEXTCLOUD_AIO_IMAGE ||
    !safeDisplayName(raw.displayName) ||
    !boundedInteger(raw.storageGiB, PROFILE_LIMITS.minStorageGiB, PROFILE_LIMITS.maxStorageGiB) ||
    !boundedInteger(raw.memoryMiB, PROFILE_LIMITS.minMemoryMiB, PROFILE_LIMITS.maxMemoryMiB) ||
    !boundedNumber(raw.cpus, PROFILE_LIMITS.minCpus, PROFILE_LIMITS.maxCpus) ||
    !boundedInteger(raw.setupPort, PROFILE_LIMITS.minPort, PROFILE_LIMITS.maxPort) ||
    !boundedInteger(raw.httpsPort, PROFILE_LIMITS.minPort, PROFILE_LIMITS.maxPort) ||
    raw.setupPort === raw.httpsPort ||
    (raw.binding !== 'loopback' && raw.binding !== 'private-network') ||
    typeof raw.automaticUpdates !== 'boolean' ||
    !boundedInteger(raw.backupRetentionDays, PROFILE_LIMITS.minBackupRetentionDays, PROFILE_LIMITS.maxBackupRetentionDays)
  ) return undefined
  return {
    schemaVersion: 1,
    image: NEXTCLOUD_AIO_IMAGE,
    displayName: raw.displayName,
    storageGiB: raw.storageGiB,
    memoryMiB: raw.memoryMiB,
    cpus: raw.cpus,
    setupPort: raw.setupPort,
    httpsPort: raw.httpsPort,
    binding: raw.binding,
    automaticUpdates: raw.automaticUpdates,
    backupRetentionDays: raw.backupRetentionDays
  }
}

export function normalizeNextcloudAioProfile(value: unknown): NextcloudAioProfile {
  return validateNextcloudAioProfile(value) ?? { ...NEXTCLOUD_AIO_DEFAULT_PROFILE }
}

export function assessNextcloudAioCapacity(
  profile: NextcloudAioProfile,
  capacity: NextcloudAioCapacity
): NextcloudAioCapacityVerdict {
  const reasons: string[] = []
  if (capacity.availableStorageGiB === null || capacity.availableMemoryMiB === null || capacity.availableCpus === null) {
    return { status: 'unknown', reasons: ['Docker host capacity is not available yet; deployment stays private and unstarted.'] }
  }
  if (capacity.availableStorageGiB < profile.storageGiB) reasons.push(`Needs ${profile.storageGiB} GiB storage, but only ${capacity.availableStorageGiB} GiB is available.`)
  if (capacity.availableMemoryMiB < profile.memoryMiB) reasons.push(`Needs ${profile.memoryMiB} MiB memory, but only ${capacity.availableMemoryMiB} MiB is available.`)
  if (capacity.availableCpus < profile.cpus) reasons.push(`Needs ${profile.cpus} CPUs, but only ${capacity.availableCpus} are available.`)
  return reasons.length > 0 ? { status: 'insufficient', reasons } : { status: 'ready', reasons: ['Requested storage, memory, and CPU fit the observed host capacity.'] }
}

function safeRuntimeName(value: string): string {
  const name = value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-')
  return name.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').slice(0, 52) || 'nextcloud-aio'
}

/**
 * Build the only supported master-container invocation. There is no Compose editor or shell
 * escape hatch: every argument is derived from validated profile values and fixed constants.
 */
export function buildNextcloudAioRunPlan(
  profileInput: unknown,
  options: { containerName?: string; volumeName?: string } = {}
): NextcloudAioRunPlan {
  const profile = validateNextcloudAioProfile(profileInput)
  if (!profile) throw new Error('Nextcloud AIO profile is invalid.')
  const containerName = safeRuntimeName(options.containerName ?? 'nextcloud-aio-mastercontainer')
  const volumeName = safeRuntimeName(options.volumeName ?? 'nextcloud_aio_mastercontainer')
  // Even the private-network choice stays loopback-bound here. A later tunnel or private reverse
  // proxy owns any broader exposure, after health verification; the fixed AIO plan never opens a
  // host port to every interface by accident.
  const bind = '127.0.0.1'
  const args = [
    'run', '--detach', '--init', '--restart', 'always', '--name', containerName,
    '--label', 'dev.nodeterm.owner=nextcloud-aio',
    '--cpus', String(profile.cpus), '--memory', `${profile.memoryMiB}m`,
    '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL',
    '--network', 'bridge',
    '--publish', `${bind}:${profile.setupPort}:8080`,
    '--publish', `${bind}:${profile.httpsPort}:8443`,
    '--mount', `type=volume,source=${volumeName},target=/mnt/docker-aio-config`,
    '--mount', `type=bind,source=${NEXTCLOUD_AIO_SOCKET_TARGET},target=${NEXTCLOUD_AIO_SOCKET_TARGET},readonly`,
    NEXTCLOUD_AIO_IMAGE
  ]
  return {
    image: NEXTCLOUD_AIO_IMAGE,
    containerName,
    args,
    socketAuthority: 'docker-daemon-control',
    privileged: false,
    network: 'bridge',
    ports: { setup: profile.setupPort, https: profile.httpsPort },
    volumeName
  }
}

export function nextcloudAioSetupUrl(endpoint: string, setupPort: number): string | undefined {
  try {
    const url = new URL(endpoint)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hostname === '') return undefined
    url.port = String(setupPort)
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return undefined
  }
}

export function nextcloudAioReadinessUrl(endpoint: string, httpsPort: number): string | undefined {
  const url = nextcloudAioSetupUrl(endpoint, httpsPort)
  return url?.replace(/^http:/, 'https:')
}
