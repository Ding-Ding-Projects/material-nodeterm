/**
 * Typed contract for the guided Nextcloud All-in-One hosting profile.
 *
 * The renderer selects only discovered Docker contexts, bounded binding choices, and closed
 * operations. It never supplies an image, entrypoint, Compose document, shell command, socket
 * path, host path, credential, or arbitrary environment value. The portable blueprint contains
 * safe intent only; live bindings, container ids, backup handles, and process state stay local.
 */

export const NEXTCLOUD_AIO_SOURCE = 'https://github.com/nextcloud/all-in-one'
/** Deliberately pinned to a reviewed release tag, never the mutable `latest` tag. */
export const NEXTCLOUD_AIO_IMAGE = 'nextcloud/all-in-one:2025.8.0'
export const NEXTCLOUD_AIO_CONTAINER = 'nodeterm-nextcloud-aio'
export const NEXTCLOUD_AIO_CONFIG_VOLUME = 'nodeterm-nextcloud-aio-config'
export const NEXTCLOUD_AIO_DATA_VOLUME = 'nodeterm-nextcloud-aio-data'
export const NEXTCLOUD_AIO_BACKUP_VOLUME = 'nodeterm-nextcloud-aio-backups'

export type NextcloudAioBindingMode = 'loopback' | 'private-network'
export type NextcloudAioOperation = 'deploy' | 'start' | 'stop' | 'update' | 'backup' | 'restore' | 'rollback'
export type NextcloudAioPhase = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type NextcloudAioHealth = 'unknown' | 'starting' | 'healthy' | 'unhealthy' | 'stopped'

export interface NextcloudAioContext {
  name: string
  endpointLabel: string
  current: boolean
  available: boolean
  reason?: string
}

export interface NextcloudAioConfig {
  schemaVersion: 1
  contextBinding: 'select-on-this-machine'
  bindingMode: NextcloudAioBindingMode
  port: number
  image: typeof NEXTCLOUD_AIO_IMAGE
  containerName: typeof NEXTCLOUD_AIO_CONTAINER
  configVolume: typeof NEXTCLOUD_AIO_CONFIG_VOLUME
  dataVolume: typeof NEXTCLOUD_AIO_DATA_VOLUME
  backupVolume: typeof NEXTCLOUD_AIO_BACKUP_VOLUME
}

export interface NextcloudAioStatus {
  context: NextcloudAioContext | null
  capturedAt: number
  health: NextcloudAioHealth
  phase: NextcloudAioPhase
  message: string
  endpointLabel?: string
  socketAuthority: 'docker-socket-mounted-read-only'
  privileged: false
  image: typeof NEXTCLOUD_AIO_IMAGE
  containerName: typeof NEXTCLOUD_AIO_CONTAINER
  lastOperation?: NextcloudAioOperation
}

export interface NextcloudAioBackupRecord {
  id: string
  label: string
  createdAt: number
  sizeLabel: string
  available: boolean
}

export interface NextcloudAioSnapshot {
  status: NextcloudAioStatus
  backups: NextcloudAioBackupRecord[]
}

export interface NextcloudAioJobProgress {
  jobId: string
  operation: NextcloudAioOperation
  phase: NextcloudAioPhase
  completedSteps: number
  totalSteps: number
  message: string
  output?: string
}

export type NextcloudAioAction =
  | { type: 'deploy'; context: string; config: NextcloudAioConfig }
  | { type: 'start'; context: string }
  | { type: 'stop'; context: string }
  | { type: 'update'; context: string; config: NextcloudAioConfig }
  | { type: 'backup'; context: string; backupId: string }
  | { type: 'restore'; context: string; backupId: string }
  | { type: 'rollback'; context: string; backupId: string }

export const NEXTCLOUD_AIO_DEFAULT_CONFIG: NextcloudAioConfig = {
  schemaVersion: 1,
  contextBinding: 'select-on-this-machine',
  bindingMode: 'loopback',
  port: 8080,
  image: NEXTCLOUD_AIO_IMAGE,
  containerName: NEXTCLOUD_AIO_CONTAINER,
  configVolume: NEXTCLOUD_AIO_CONFIG_VOLUME,
  dataVolume: NEXTCLOUD_AIO_DATA_VOLUME,
  backupVolume: NEXTCLOUD_AIO_BACKUP_VOLUME
}

/** Portable schema 3 intent. No local host, socket, process, credential, or backup bytes. */
export const NEXTCLOUD_AIO_PORTABLE_BLUEPRINT = {
  schemaVersion: 1,
  featureId: 'nextcloud-aio-hosting',
  displayLabel: 'Nextcloud AIO hosting',
  requestedCapabilities: ['private-hosting', 'docker-socket-management', 'backup-restore-rollback'],
  safeSettings: {
    imageSource: NEXTCLOUD_AIO_SOURCE,
    image: NEXTCLOUD_AIO_IMAGE,
    bindingMode: 'loopback',
    port: 8080,
    noPrivilegedMode: true,
    socketDisclosure: 'docker-socket-mounted-read-only',
    localBinding: 'select-on-this-machine'
  },
  relationships: []
} as const

const SAFE_CONTEXT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_BACKUP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export function isSafeNextcloudAioContext(value: unknown): value is string {
  return typeof value === 'string' && SAFE_CONTEXT.test(value.trim())
}

export function isSafeNextcloudAioBackupId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_BACKUP_ID.test(value.trim())
}

export function isSafeNextcloudAioPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 65535
}

export function normalizeNextcloudAioConfig(value: unknown): NextcloudAioConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== 1 || raw.contextBinding !== 'select-on-this-machine') return undefined
  if (raw.bindingMode !== 'loopback' && raw.bindingMode !== 'private-network') return undefined
  if (!isSafeNextcloudAioPort(raw.port)) return undefined
  if (raw.image !== NEXTCLOUD_AIO_IMAGE || raw.containerName !== NEXTCLOUD_AIO_CONTAINER) return undefined
  if (raw.configVolume !== NEXTCLOUD_AIO_CONFIG_VOLUME || raw.dataVolume !== NEXTCLOUD_AIO_DATA_VOLUME || raw.backupVolume !== NEXTCLOUD_AIO_BACKUP_VOLUME) return undefined
  return { ...NEXTCLOUD_AIO_DEFAULT_CONFIG, bindingMode: raw.bindingMode, port: raw.port }
}

export function validateNextcloudAioAction(value: unknown): NextcloudAioAction | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (raw.type === 'deploy') {
    const config = normalizeNextcloudAioConfig(raw.config)
    return config && isSafeNextcloudAioContext(raw.context) ? { type: 'deploy', context: raw.context.trim(), config } : undefined
  }
  if (!['start', 'stop', 'update', 'backup', 'restore', 'rollback'].includes(String(raw.type))) return undefined
  if (!isSafeNextcloudAioContext(raw.context)) return undefined
  if (raw.type === 'backup') {
    return isSafeNextcloudAioBackupId(raw.backupId) ? { type: 'backup', context: raw.context.trim(), backupId: raw.backupId.trim() } : undefined
  }
  if (raw.type === 'restore' || raw.type === 'rollback') {
    return isSafeNextcloudAioBackupId(raw.backupId) ? { type: raw.type, context: raw.context.trim(), backupId: raw.backupId.trim() } : undefined
  }
  if (raw.type === 'update') {
    const config = normalizeNextcloudAioConfig(raw.config)
    return config ? { type: 'update', context: raw.context.trim(), config } : undefined
  }
  return { type: raw.type as 'start' | 'stop' | 'update', context: raw.context.trim() }
}

export interface NextcloudAioManagerApi {
  contexts(): Promise<NextcloudAioContext[]>
  snapshot(context?: string): Promise<NextcloudAioSnapshot>
  run(action: NextcloudAioAction): Promise<{ jobId: string }>
  cancel(jobId: string): void
  onProgress(listener: (progress: NextcloudAioJobProgress) => void): () => void
}
