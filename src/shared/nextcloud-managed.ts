/**
 * Typed contract for the managed Nextcloud profile.
 *
 * This profile deliberately owns the complete small service stack instead of accepting arbitrary
 * Compose text: PostgreSQL stores the database, Redis provides locking/cache, and the web service
 * serves Nextcloud. The stack never mounts a container-runtime socket, never uses privileged mode,
 * and publishes only a loopback binding chosen through the guided form.
 *
 * The intent is safe project data. A destination binding contains machine paths and opaque vault
 * keys and is kept in the machine-local workspace index. Secret values are generated or resolved
 * by the trusted host process and are written to temporary secret files, never placed in a project
 * file, action payload, command argument, log, export, or renderer state.
 */

export const NEXTCLOUD_MANAGED_BLUEPRINT_VERSION = 1 as const
export const NEXTCLOUD_MANAGED_BINDING_VERSION = 1 as const

export type NextcloudManagedOperation = 'deploy' | 'update' | 'backup' | 'restore' | 'rollback'
export type NextcloudManagedServiceId = 'database' | 'cache' | 'web'

export interface NextcloudManagedIntent {
  schemaVersion: typeof NEXTCLOUD_MANAGED_BLUEPRINT_VERSION
  featureId: 'nextcloud-managed-no-socket'
  profile: 'managed-no-socket'
  database: 'postgresql'
  cache: 'redis'
  web: 'apache'
  networkPolicy: 'private-bridge'
  socketMount: 'forbidden'
  privileged: false
  publishedBinding: 'loopback-only'
  updatePolicy: 'explicit-user-action'
  backupPolicy: 'versioned-local-snapshot'
}

export interface NextcloudManagedBinding {
  bindingVersion: typeof NEXTCLOUD_MANAGED_BINDING_VERSION
  context: string
  projectName: string
  dataDirectory: string
  backupDirectory: string
  /** Opaque names in the operating-system credential vault, never secret values. */
  secretKeys: string[]
  loopbackPort: number
  lastVerifiedAt?: number
}

export interface NextcloudManagedAction {
  operation: NextcloudManagedOperation
  context: string
  projectName: string
  dataDirectory: string
  backupDirectory: string
  loopbackPort: number
  /** Required for restore and rollback, selected from a host-discovered snapshot list. */
  snapshotId?: string
}

export interface NextcloudManagedProgress {
  jobId: string
  operation: NextcloudManagedOperation
  phase: 'queued' | 'preflight' | 'secrets' | 'database' | 'cache' | 'web' | 'backup' | 'restore' | 'rollback' | 'completed' | 'failed' | 'cancelled'
  completedSteps: number
  totalSteps: number
  message: string
  output?: string
}

export interface NextcloudManagedApi {
  snapshots(binding: NextcloudManagedBinding): Promise<string[]>
  run(action: NextcloudManagedAction): Promise<{ jobId: string }>
  cancel(jobId: string): void
  onProgress(listener: (progress: NextcloudManagedProgress) => void): () => void
}

export interface NextcloudManagedComposeService {
  id: NextcloudManagedServiceId
  image: string
  containerName: string
  secretFiles: string[]
  dependsOn: NextcloudManagedServiceId[]
}

/** Official image references are intentionally fixed. The user chooses a release channel, not an
 * arbitrary image or tag, so the host can keep the execution argument vector closed. */
export const NEXTCLOUD_MANAGED_IMAGES = {
  database: 'postgres:16-alpine',
  cache: 'redis:7-alpine',
  web: 'nextcloud:30-apache'
} as const

export const NEXTCLOUD_MANAGED_SECRET_FILES = [
  { id: 'database-password', fileName: 'postgres-password', consumer: 'database' as const },
  { id: 'admin-password', fileName: 'nextcloud-admin-password', consumer: 'web' as const },
  { id: 'instance-secret', fileName: 'nextcloud-instance-secret', consumer: 'web' as const }
] as const

export const NEXTCLOUD_MANAGED_SERVICES: readonly NextcloudManagedComposeService[] = [
  {
    id: 'database',
    image: NEXTCLOUD_MANAGED_IMAGES.database,
    containerName: 'nextcloud-managed-db',
    secretFiles: ['postgres-password'],
    dependsOn: []
  },
  {
    id: 'cache',
    image: NEXTCLOUD_MANAGED_IMAGES.cache,
    containerName: 'nextcloud-managed-redis',
    secretFiles: [],
    dependsOn: []
  },
  {
    id: 'web',
    image: NEXTCLOUD_MANAGED_IMAGES.web,
    containerName: 'nextcloud-managed-web',
    secretFiles: ['nextcloud-admin-password', 'nextcloud-instance-secret'],
    dependsOn: ['database', 'cache']
  }
] as const

export const DEFAULT_NEXTCLOUD_MANAGED_INTENT: NextcloudManagedIntent = {
  schemaVersion: 1,
  featureId: 'nextcloud-managed-no-socket',
  profile: 'managed-no-socket',
  database: 'postgresql',
  cache: 'redis',
  web: 'apache',
  networkPolicy: 'private-bridge',
  socketMount: 'forbidden',
  privileged: false,
  publishedBinding: 'loopback-only',
  updatePolicy: 'explicit-user-action',
  backupPolicy: 'versioned-local-snapshot'
}

export const NEXTCLOUD_MANAGED_BLUEPRINT = {
  schemaVersion: 1,
  featureId: 'nextcloud-managed-no-socket',
  displayLabel: 'Managed Nextcloud, no socket',
  requestedCapabilities: ['postgresql', 'redis', 'nextcloud-web', 'secret-files', 'updates', 'backups', 'restore', 'rollback'],
  safeSettings: {
    profile: 'managed-no-socket',
    database: 'postgresql',
    cache: 'redis',
    web: 'apache',
    networkPolicy: 'private-bridge',
    socketMount: 'forbidden',
    privileged: false,
    publishedBinding: 'loopback-only',
    updatePolicy: 'explicit-user-action',
    backupPolicy: 'versioned-local-snapshot'
  },
  relationships: []
} as const

const SAFE_CONTEXT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_PROJECT = /^[a-z0-9][a-z0-9._-]{0,62}$/
const SAFE_SNAPSHOT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_SECRET_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const CONTROL = /[\u0000-\u001f\u007f]/

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || CONTROL.test(value)) {
    throw new Error(`${label} is invalid.`)
  }
  const normalized = value.replaceAll('\\', '/')
  const absolute = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')
  if (!absolute || normalized.split('/').some((part) => part === '..')) throw new Error(`${label} must be an absolute local folder without traversal.`)
  return value
}

export function validateNextcloudManagedIntent(value: unknown): NextcloudManagedIntent {
  if (!record(value)) throw new Error('Nextcloud managed intent is invalid.')
  const expected: NextcloudManagedIntent = DEFAULT_NEXTCLOUD_MANAGED_INTENT
  const keys = Object.keys(expected)
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) throw new Error('Nextcloud managed intent contains an unknown or missing field.')
  for (const key of keys) if (value[key] !== expected[key]) throw new Error(`Nextcloud managed intent ${key} is invalid.`)
  return { ...expected }
}

export function validateNextcloudManagedBinding(value: unknown): NextcloudManagedBinding {
  if (!record(value)) throw new Error('Nextcloud managed binding is invalid.')
  const allowed = new Set(['bindingVersion', 'context', 'projectName', 'dataDirectory', 'backupDirectory', 'secretKeys', 'loopbackPort', 'lastVerifiedAt'])
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('Nextcloud managed binding contains an unknown field.')
  if (value.bindingVersion !== NEXTCLOUD_MANAGED_BINDING_VERSION || typeof value.context !== 'string' || !SAFE_CONTEXT.test(value.context)) throw new Error('Nextcloud managed context is invalid.')
  if (typeof value.projectName !== 'string' || !SAFE_PROJECT.test(value.projectName)) throw new Error('Nextcloud managed project name is invalid.')
  const dataDirectory = safePath(value.dataDirectory, 'Nextcloud data directory')
  const backupDirectory = safePath(value.backupDirectory, 'Nextcloud backup directory')
  if (!Array.isArray(value.secretKeys) || value.secretKeys.length !== NEXTCLOUD_MANAGED_SECRET_FILES.length || value.secretKeys.some((key) => typeof key !== 'string' || !SAFE_SECRET_KEY.test(key))) throw new Error('Nextcloud managed secret keys are invalid.')
  if (typeof value.loopbackPort !== 'number' || !Number.isInteger(value.loopbackPort) || value.loopbackPort < 1024 || value.loopbackPort > 65535) throw new Error('Nextcloud managed loopback port is invalid.')
  const result: NextcloudManagedBinding = { bindingVersion: 1, context: value.context, projectName: value.projectName, dataDirectory, backupDirectory, secretKeys: [...value.secretKeys], loopbackPort: value.loopbackPort }
  if (value.lastVerifiedAt !== undefined) {
    if (typeof value.lastVerifiedAt !== 'number' || !Number.isSafeInteger(value.lastVerifiedAt) || value.lastVerifiedAt < 0) throw new Error('Nextcloud managed verification time is invalid.')
    result.lastVerifiedAt = value.lastVerifiedAt
  }
  return result
}

export function validateNextcloudManagedAction(value: unknown): NextcloudManagedAction {
  if (!record(value)) throw new Error('Nextcloud managed action is invalid.')
  const operation = value.operation
  if (!['deploy', 'update', 'backup', 'restore', 'rollback'].includes(String(operation))) throw new Error('Nextcloud managed operation is unsupported.')
  if (typeof value.context !== 'string' || !SAFE_CONTEXT.test(value.context)) throw new Error('Nextcloud managed context is invalid.')
  if (typeof value.projectName !== 'string' || !SAFE_PROJECT.test(value.projectName)) throw new Error('Nextcloud managed project name is invalid.')
  const dataDirectory = safePath(value.dataDirectory, 'Nextcloud data directory')
  const backupDirectory = safePath(value.backupDirectory, 'Nextcloud backup directory')
  if (typeof value.loopbackPort !== 'number' || !Number.isInteger(value.loopbackPort) || value.loopbackPort < 1024 || value.loopbackPort > 65535) throw new Error('Nextcloud managed loopback port is invalid.')
  const result: NextcloudManagedAction = { operation: operation as NextcloudManagedOperation, context: value.context, projectName: value.projectName, dataDirectory, backupDirectory, loopbackPort: value.loopbackPort }
  if (operation === 'restore' || operation === 'rollback') {
    if (typeof value.snapshotId !== 'string' || !SAFE_SNAPSHOT.test(value.snapshotId)) throw new Error('A verified snapshot must be selected for this operation.')
    result.snapshotId = value.snapshotId
  } else if (value.snapshotId !== undefined) throw new Error('Snapshot selection is not valid for this operation.')
  return result
}

export const NEXTCLOUD_MANAGED_OPERATION_STEPS: Record<NextcloudManagedOperation, readonly string[]> = {
  deploy: ['preflight', 'secrets', 'database', 'cache', 'web'],
  update: ['preflight', 'backup', 'web'],
  backup: ['preflight', 'backup'],
  restore: ['preflight', 'restore', 'database', 'cache', 'web'],
  rollback: ['preflight', 'rollback', 'database', 'cache', 'web']
}

/** The only allowed sequencing. Callers can show this plan before any operation starts. */
export function nextcloudManagedOperationPlan(operation: NextcloudManagedOperation): readonly string[] {
  const steps = NEXTCLOUD_MANAGED_OPERATION_STEPS[operation]
  if (!steps) throw new Error('Nextcloud managed operation is unsupported.')
  return [...steps]
}

export function nextcloudManagedComposeServices(): readonly NextcloudManagedComposeService[] {
  return NEXTCLOUD_MANAGED_SERVICES.map((service) => ({ ...service, secretFiles: [...service.secretFiles], dependsOn: [...service.dependsOn] }))
}
