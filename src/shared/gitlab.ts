/**
 * GitLab Server hosting node contracts.
 *
 * The renderer can choose only a catalog entry. Image references, container names, volume names,
 * secret paths, and Docker argv are produced by the trusted core. This keeps a project file useful
 * on another machine without turning it into a recipe for arbitrary container execution.
 */

export type GitLabEdition = 'ce' | 'ee'
export type GitLabPhase =
  | 'unconfigured'
  | 'preflight'
  | 'starting'
  | 'ready'
  | 'stopped'
  | 'updating'
  | 'backing-up'
  | 'restoring'
  | 'error'

export interface GitLabImageProfile {
  id: string
  edition: GitLabEdition
  label: string
  image: string
  version: string
  digest: `sha256:${string}`
  containerPort: 80
}

/** Official GitLab images, pinned by release tag and immutable registry digest. */
export const GITLAB_IMAGE_CATALOG: readonly GitLabImageProfile[] = [
  {
    id: 'gitlab-ce-18.2.1',
    edition: 'ce',
    label: 'GitLab Community Edition 18.2.1',
    image: 'gitlab/gitlab-ce:18.2.1-ce.0',
    version: '18.2.1-ce.0',
    digest: 'sha256:3db5de3ce9fba4511345bb67731a1787e316f73029cdbd309ee947f860d9ff00',
    containerPort: 80
  },
  {
    id: 'gitlab-ce-18.3.1',
    edition: 'ce',
    label: 'GitLab Community Edition 18.3.1',
    image: 'gitlab/gitlab-ce:18.3.1-ce.0',
    version: '18.3.1-ce.0',
    digest: 'sha256:eb7f8158e9e39c61ac8a0955a64432460dfddfb1966c6ad5f4d08c75002e6cd6',
    containerPort: 80
  },
  {
    id: 'gitlab-ee-18.2.1',
    edition: 'ee',
    label: 'GitLab Enterprise Edition 18.2.1',
    image: 'gitlab/gitlab-ee:18.2.1-ee.0',
    version: '18.2.1-ee.0',
    digest: 'sha256:ee860fa256e791d74e947dc63b41a6e226f0a423fee629a44299c076b98af1e9',
    containerPort: 80
  },
  {
    id: 'gitlab-ee-18.3.1',
    edition: 'ee',
    label: 'GitLab Enterprise Edition 18.3.1',
    image: 'gitlab/gitlab-ee:18.3.1-ee.0',
    version: '18.3.1-ee.0',
    digest: 'sha256:88f0a6a23bed70c75d1bf32cb7e4ba3c8aa12a8f85ee3e45596163b9a5d5f768',
    containerPort: 80
  }
] as const

export interface GitLabManagedVolumes {
  config: string
  logs: string
  data: string
  backups: string
}

export interface GitLabServerStatus {
  id: string
  phase: GitLabPhase
  edition: GitLabEdition | null
  profileId: string | null
  version: string | null
  image: string | null
  containerName: string | null
  bindAddress: string
  hostPort: number
  volumes: GitLabManagedVolumes | null
  ready: boolean
  credentialReady: boolean
  credentialHandedOff: boolean
  backupCount: number
  lastBackupAt: number | null
  lastError: string | null
  checkedAt: number
}

export interface GitLabCreateInput {
  id: string
  profileId: string
  hostPort?: number
}

export interface GitLabBackupSummary {
  id: string
  filename: string
  createdAt: number
  sizeBytes: number | null
}

export interface GitLabInitialCredential {
  username: 'root'
  password: string
  handedOffAt: number
  warning: string
}

export interface GitLabTunnelHandoff {
  id: string
  origin: string
  bindAddress: '127.0.0.1'
  port: number
  ready: true
  note: string
}

export interface GitLabApi {
  catalog(): Promise<GitLabImageProfile[]>
  status(id: string): Promise<GitLabServerStatus>
  create(input: GitLabCreateInput): Promise<GitLabServerStatus>
  handoffCredential(id: string): Promise<GitLabInitialCredential | null>
  listBackups(id: string): Promise<GitLabBackupSummary[]>
  createBackup(id: string): Promise<GitLabBackupSummary>
  restoreBackup(id: string, backupId: string): Promise<GitLabServerStatus>
  update(id: string, profileId: string): Promise<GitLabServerStatus>
  rollback(id: string): Promise<GitLabServerStatus>
  start(id: string): Promise<GitLabServerStatus>
  stop(id: string): Promise<GitLabServerStatus>
  tunnelHandoff(id: string): Promise<GitLabTunnelHandoff>
}

const PROFILE_IDS = new Set(GITLAB_IMAGE_CATALOG.map((profile) => profile.id))
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/

export function gitlabProfile(profileId: string): GitLabImageProfile | undefined {
  return GITLAB_IMAGE_CATALOG.find((profile) => profile.id === profileId)
}

export function isGitLabProfileId(value: string): boolean {
  return PROFILE_IDS.has(value)
}

export function validateGitLabId(value: string): string {
  if (!SAFE_ID.test(value)) throw new Error('GitLab node id is invalid.')
  return value
}

export function validateGitLabPort(value: number | undefined): number {
  const port = value ?? 8929
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('GitLab host port must be an integer from 1024 through 65535.')
  }
  return port
}

export function gitlabImageReference(profile: GitLabImageProfile): string {
  return `${profile.image}@${profile.digest}`
}

export function gitlabVolumes(id: string): GitLabManagedVolumes {
  validateGitLabId(id)
  const prefix = `nodeterm-gitlab-${id}`
  return {
    config: `${prefix}-config`,
    logs: `${prefix}-logs`,
    data: `${prefix}-data`,
    backups: `${prefix}-backups`
  }
}

export function gitlabContainerName(id: string): string {
  validateGitLabId(id)
  return `nodeterm-gitlab-${id}`
}

/** Fixed argv for `docker run`; no caller-provided command, entrypoint, image, or environment. */
export function buildGitLabRunArgs(input: {
  id: string
  profile: GitLabImageProfile
  hostPort: number
  secretPath: string
}): string[] {
  const volumes = gitlabVolumes(input.id)
  const container = gitlabContainerName(input.id)
  return [
    'run',
    '--detach',
    '--restart',
    'unless-stopped',
    '--name',
    container,
    '--label',
    'dev.nodeterm.owner=nodeterm-gitlab',
    '--label',
    `dev.nodeterm.gitlab.id=${input.id}`,
    '--publish',
    `127.0.0.1:${input.hostPort}:${input.profile.containerPort}`,
    '--volume',
    `${volumes.config}:/etc/gitlab`,
    '--volume',
    `${volumes.logs}:/var/log/gitlab`,
    '--volume',
    `${volumes.data}:/var/opt/gitlab`,
    '--volume',
    `${volumes.backups}:/var/opt/gitlab/backups`,
    '--mount',
    `type=bind,source=${input.secretPath},target=/run/secrets/gitlab_root_password,readonly`,
    '--env',
    'GITLAB_ROOT_PASSWORD_FILE=/run/secrets/gitlab_root_password',
    '--shm-size',
    '256m',
    gitlabImageReference(input.profile)
  ]
}

export function buildGitLabFixedExecArgs(container: string, operation: 'backup' | 'restore', backup?: string): string[] {
  if (operation === 'backup') return ['exec', container, 'gitlab-backup', 'create', 'CRON=1']
  if (!backup || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.tar$/.test(backup)) {
    throw new Error('GitLab backup name is invalid.')
  }
  return ['exec', container, 'gitlab-backup', 'restore', `BACKUP=${backup.slice(0, -4)}`]
}
