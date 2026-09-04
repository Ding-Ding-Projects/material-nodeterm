/**
 * The managed Nextcloud profile. This is deliberately an allowlisted control surface rather
 * than a general container editor: callers can select a supported release and capacity values,
 * but cannot provide an image, entrypoint, Compose document, shell command, or arbitrary env.
 */

export const NEXTCLOUD_PROFILE_ID = 'nextcloud-managed-no-socket'

export const NEXTCLOUD_SUPPORTED_RELEASES = ['29-apache', '30-apache', '31-apache'] as const
export type NextcloudRelease = (typeof NEXTCLOUD_SUPPORTED_RELEASES)[number]

export const NEXTCLOUD_IMAGES = {
  web: 'nextcloud:31-apache',
  postgres: 'postgres:16-alpine',
  redis: 'redis:7-alpine'
} as const

export const NEXTCLOUD_WEB_IMAGES: Record<NextcloudRelease, string> = {
  '29-apache': 'nextcloud:29-apache',
  '30-apache': 'nextcloud:30-apache',
  '31-apache': 'nextcloud:31-apache'
}

export type NextcloudPhase =
  | 'unconfigured'
  | 'installing'
  | 'starting'
  | 'healthy'
  | 'stopped'
  | 'updating'
  | 'backing-up'
  | 'restoring'
  | 'rolling-back'
  | 'error'

export type NextcloudServiceName = 'web' | 'postgres' | 'redis'

export interface NextcloudServiceStatus {
  name: NextcloudServiceName
  containerName: string
  image: string
  running: boolean
  healthy: boolean | null
  reason: string | null
}

/** Git-shared profile choices. It contains no host, path, credential, container id, or state. */
export interface NextcloudManagedProfile {
  profileId: typeof NEXTCLOUD_PROFILE_ID
  release: NextcloudRelease
  port: number
  dataVolume: string
  databaseVolume: string
  configVolume: string
  network: string
  privateOnly: true
  dockerSocket: false
}

/** Machine-local deployment state. Secret values are only represented by file keys. */
export interface NextcloudLocalBinding {
  profileId: typeof NEXTCLOUD_PROFILE_ID
  nodeId: string
  rootDir: string
  secretFiles: {
    databasePassword: string
    adminPassword: string
  }
  containers: Record<NextcloudServiceName, string>
  previousRelease: NextcloudRelease | null
  currentRelease: NextcloudRelease
  tunnelHandoff: 'not-requested' | 'eligible' | 'handed-off'
}

export interface NextcloudBackupSummary {
  id: string
  createdAt: number
  path: string
  sizeBytes: number
  release: NextcloudRelease
  includes: readonly ['database', 'data', 'config']
}

export interface NextcloudStatus {
  id: string
  phase: NextcloudPhase
  profile: NextcloudManagedProfile | null
  services: NextcloudServiceStatus[]
  privateEndpoint: string | null
  readiness: {
    database: boolean
    redis: boolean
    web: boolean
    all: boolean
  }
  activeOperation: string | null
  error: string | null
  lastBackupAt: number | null
  tunnelHandoff: NextcloudLocalBinding['tunnelHandoff']
}

export interface NextcloudInstallInput {
  id: string
  release?: NextcloudRelease
  port?: number
}

export interface NextcloudApi {
  status(id: string): Promise<NextcloudStatus>
  install(input: NextcloudInstallInput): Promise<NextcloudStatus>
  update(id: string, release: NextcloudRelease): Promise<NextcloudStatus>
  listBackups(id: string): Promise<NextcloudBackupSummary[]>
  backup(id: string): Promise<NextcloudBackupSummary>
  restore(id: string, backupId: string): Promise<NextcloudStatus>
  rollback(id: string): Promise<NextcloudStatus>
  requestTunnelHandoff(id: string): Promise<NextcloudStatus>
  remove(id: string, deleteData: boolean): Promise<void>
  onEvent(listener: (event: NextcloudEvent) => void): () => void
}

export type NextcloudEvent = { kind: 'status'; id: string; status: NextcloudStatus }

export const DEFAULT_NEXTCLOUD_PROFILE: NextcloudManagedProfile = {
  profileId: NEXTCLOUD_PROFILE_ID,
  release: '31-apache',
  port: 8180,
  dataVolume: 'nodeterm-nextcloud-data',
  databaseVolume: 'nodeterm-nextcloud-postgres',
  configVolume: 'nodeterm-nextcloud-config',
  network: 'nodeterm-nextcloud-private',
  privateOnly: true,
  dockerSocket: false
}

export function isNextcloudRelease(value: unknown): value is NextcloudRelease {
  return typeof value === 'string' && (NEXTCLOUD_SUPPORTED_RELEASES as readonly string[]).includes(value)
}

export function safeNextcloudPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 65535
}

export function normalizeNextcloudProfile(value: unknown): NextcloudManagedProfile {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const release = isNextcloudRelease(raw.release) ? raw.release : DEFAULT_NEXTCLOUD_PROFILE.release
  const port = safeNextcloudPort(raw.port) ? raw.port : DEFAULT_NEXTCLOUD_PROFILE.port
  const safeName = (candidate: unknown, fallback: string): string =>
    typeof candidate === 'string' && /^[a-z0-9][a-z0-9_.-]{0,62}$/.test(candidate) ? candidate : fallback
  return {
    profileId: NEXTCLOUD_PROFILE_ID,
    release,
    port,
    dataVolume: safeName(raw.dataVolume, DEFAULT_NEXTCLOUD_PROFILE.dataVolume),
    databaseVolume: safeName(raw.databaseVolume, DEFAULT_NEXTCLOUD_PROFILE.databaseVolume),
    configVolume: safeName(raw.configVolume, DEFAULT_NEXTCLOUD_PROFILE.configVolume),
    network: safeName(raw.network, DEFAULT_NEXTCLOUD_PROFILE.network),
    privateOnly: true,
    dockerSocket: false
  }
}
