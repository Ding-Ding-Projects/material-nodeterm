import {
  BACKUP_RESTORE_SCHEMA,
  BACKUP_RESTORE_SCHEMA_VERSION,
  type BackupRestoreResourceDescriptor
} from './backup-restore'

/**
 * Typed, guided contract for the local GitLab Server hosting node.
 *
 * The project file carries only safe hosting intent. Docker context names, container ids,
 * volume names, backup files, credentials, and process state stay on the machine that owns
 * the hosting binding. The renderer can select one of the pinned official images and one of
 * the closed operations below, but it can never provide a shell command or raw Docker args.
 */

export type GitLabEdition = 'ce' | 'ee'
export type GitLabHostingBinding = 'loopback'

export interface GitLabHostingImage {
  edition: GitLabEdition
  version: string
  ref: string
  label: string
}

/** Resolved from Docker Hub's official image manifests on 2026-08-27. */
export const GITLAB_HOSTING_IMAGES: readonly GitLabHostingImage[] = [
  {
    edition: 'ce',
    version: '17.11.3-ce.0',
    ref: 'gitlab/gitlab-ce@sha256:c7c87778c3380e4f93843f7329e3f2dc4aed1b90f29d05e56d8834ce50dccc54',
    label: 'GitLab Community Edition 17.11.3'
  },
  {
    edition: 'ee',
    version: '17.11.3-ee.0',
    ref: 'gitlab/gitlab-ee@sha256:f49d8adfcaed1f80d90a2aa6e10bc46c362bcb907312e3cae5914bbe996505d0',
    label: 'GitLab Enterprise Edition 17.11.3'
  }
] as const

export const GITLAB_HOSTING_VOLUME_ROLES = ['config', 'logs', 'data', 'backups'] as const
export type GitLabHostingVolumeRole = (typeof GITLAB_HOSTING_VOLUME_ROLES)[number]

export interface GitLabHostingConfig {
  schemaVersion: 1
  edition: GitLabEdition
  image: string
  binding: GitLabHostingBinding
  httpPort: number
  sshPort: number
}

export const DEFAULT_GITLAB_HOSTING_CONFIG: GitLabHostingConfig = {
  schemaVersion: 1,
  edition: 'ce',
  image: GITLAB_HOSTING_IMAGES[0].ref,
  binding: 'loopback',
  httpPort: 8929,
  sshPort: 2224
}

export function gitlabHostingImage(edition: GitLabEdition): GitLabHostingImage {
  return GITLAB_HOSTING_IMAGES.find((image) => image.edition === edition) ?? GITLAB_HOSTING_IMAGES[0]
}

/** Shared hosted-resource metadata used to review GitLab backups before restore. */
export const GITLAB_BACKUP_FRAMEWORK = {
  schema: BACKUP_RESTORE_SCHEMA,
  schemaVersion: BACKUP_RESTORE_SCHEMA_VERSION
} as const

export function gitlabBackupResourceDescriptor(
  nodeId: string,
  edition: GitLabEdition,
  version: string
): BackupRestoreResourceDescriptor {
  return {
    resourceId: `gitlab:${nodeId}`,
    displayLabel: 'GitLab Server',
    kind: 'service',
    edition: edition === 'ee' ? 'enterprise' : 'community',
    version: { product: 'GitLab', version, schema: 1 },
    source: 'host',
    ownership: 'owned',
    ownerId: `nodeterm:${nodeId}`
  }
}

export function isGitLabHostingConfig(value: unknown): value is GitLabHostingConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<GitLabHostingConfig>
  return candidate.schemaVersion === 1 &&
    (candidate.edition === 'ce' || candidate.edition === 'ee') &&
    GITLAB_HOSTING_IMAGES.some((image) => image.edition === candidate.edition && image.ref === candidate.image) &&
    candidate.binding === 'loopback' &&
    Number.isInteger(candidate.httpPort) && candidate.httpPort >= 1024 && candidate.httpPort <= 65535 &&
    Number.isInteger(candidate.sshPort) && candidate.sshPort >= 1024 && candidate.sshPort <= 65535 &&
    candidate.httpPort !== candidate.sshPort
}

export type GitLabHostingOperation = 'deploy' | 'backup' | 'restore' | 'update' | 'rollback'

export type GitLabHostingAction =
  | { type: 'deploy'; context: string; nodeId: string; config: GitLabHostingConfig }
  | { type: 'backup'; context: string; nodeId: string }
  | { type: 'restore'; context: string; nodeId: string; backupId: string }
  | { type: 'update'; context: string; nodeId: string; config: GitLabHostingConfig }
  | { type: 'rollback'; context: string; nodeId: string }

export type GitLabHostingPhase =
  | 'unconfigured'
  | 'missing'
  | 'starting'
  | 'ready'
  | 'stopped'
  | 'unready'
  | 'error'

export interface GitLabHostingStatus {
  nodeId: string
  phase: GitLabHostingPhase
  ready: boolean
  context: string
  containerName: string
  edition: GitLabEdition | null
  image: string | null
  endpoint: string | null
  volumes: Partial<Record<GitLabHostingVolumeRole, string>>
  detail: string
  checkedAt: number
}

export interface GitLabBackupSummary {
  id: string
  filename: string
  createdAt: number | null
  sizeBytes: number | null
  resource: BackupRestoreResourceDescriptor
}

/** The first root password is returned only to the active UI and never persisted or broadcast. */
export interface GitLabCredentialHandoff {
  username: 'root'
  password: string
  expiresAt: number
}

export interface GitLabHostingApi {
  status(context: string, nodeId: string): Promise<GitLabHostingStatus>
  backups(context: string, nodeId: string): Promise<GitLabBackupSummary[]>
  handoffInitialCredential(context: string, nodeId: string): Promise<GitLabCredentialHandoff>
  run(action: GitLabHostingAction): Promise<{ jobId: string }>
}
