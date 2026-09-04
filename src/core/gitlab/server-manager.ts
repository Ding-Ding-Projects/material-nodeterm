/** GitLab Server CE/EE hosting manager. All container execution stays in this trusted core. */

import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, statfs, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  buildGitLabFixedExecArgs,
  buildGitLabRunArgs,
  gitlabContainerName,
  gitlabImageReference,
  gitlabProfile,
  gitlabVolumes,
  GITLAB_IMAGE_CATALOG,
  validateGitLabId,
  validateGitLabPort,
  type GitLabApi,
  type GitLabBackupSummary,
  type GitLabCreateInput,
  type GitLabInitialCredential,
  type GitLabServerStatus
} from '../../shared/gitlab'

const execFileAsync = promisify(execFile)
const MIN_FREE_BYTES = 8 * 1024 * 1024 * 1024
const RECORD_VERSION = 1

interface GitLabRecord {
  version: 1
  id: string
  profileId: string
  hostPort: number
  containerName: string
  secretFile: string
  credentialHandedOff: boolean
  createdAt: number
  lastBackupAt: number | null
  backups: GitLabBackupSummary[]
  previousProfileId: string | null
}

function isRecord(value: unknown): value is GitLabRecord {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return (
    r.version === RECORD_VERSION &&
    typeof r.id === 'string' &&
    typeof r.profileId === 'string' &&
    typeof r.hostPort === 'number' &&
    typeof r.containerName === 'string' &&
    typeof r.secretFile === 'string' &&
    typeof r.credentialHandedOff === 'boolean' &&
    typeof r.createdAt === 'number' &&
    (r.lastBackupAt === null || typeof r.lastBackupAt === 'number') &&
    Array.isArray(r.backups) &&
    (r.previousProfileId === null || typeof r.previousProfileId === 'string')
  )
}

type DockerRunner = (args: string[]) => Promise<string>

export interface GitLabServerManagerOptions {
  userDataDir: string
  runDocker?: DockerRunner
  fetchImpl?: typeof fetch
  now?: () => number
  minFreeBytes?: number
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function defaultDocker(args: string[]): Promise<string> {
  const result = await execFileAsync('docker', args, { windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
  return result.stdout
}

async function canBind(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close(() => resolve(true))
    })
  })
}

export class GitLabServerManager implements GitLabApi {
  private readonly root: string
  private readonly recordsDir: string
  private readonly runDocker: DockerRunner
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly minFreeBytes: number

  constructor(options: GitLabServerManagerOptions) {
    this.root = path.join(options.userDataDir, 'gitlab-servers')
    this.recordsDir = path.join(this.root, 'records')
    this.runDocker = options.runDocker ?? defaultDocker
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
    this.minFreeBytes = options.minFreeBytes ?? MIN_FREE_BYTES
  }

  async catalog() {
    return [...GITLAB_IMAGE_CATALOG]
  }

  private recordPath(id: string): string {
    return path.join(this.recordsDir, `${validateGitLabId(id)}.json`)
  }

  private async load(id: string): Promise<GitLabRecord | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.recordPath(id), 'utf8'))
      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  private async save(record: GitLabRecord): Promise<void> {
    await mkdir(this.recordsDir, { recursive: true })
    const target = this.recordPath(record.id)
    const temporary = `${target}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
    // The record is private application state. A rename is intentionally kept in this manager's
    // narrow write path so no credential can leak into the shared project document.
    const fs = await import('node:fs/promises')
    await fs.rename(temporary, target)
  }

  private emptyStatus(id: string): GitLabServerStatus {
    return {
      id,
      phase: 'unconfigured',
      edition: null,
      profileId: null,
      version: null,
      image: null,
      containerName: null,
      bindAddress: '127.0.0.1',
      hostPort: 8929,
      volumes: null,
      ready: false,
      credentialReady: false,
      credentialHandedOff: false,
      backupCount: 0,
      lastBackupAt: null,
      lastError: null,
      checkedAt: this.now()
    }
  }

  async status(id: string): Promise<GitLabServerStatus> {
    validateGitLabId(id)
    const record = await this.load(id)
    if (!record) return this.emptyStatus(id)
    const profile = gitlabProfile(record.profileId)
    if (!profile) return { ...this.emptyStatus(id), lastError: 'The stored GitLab profile is no longer in the catalog.' }
    let running = false
    let ready = false
    let lastError: string | null = null
    try {
      running = (await this.runDocker(['inspect', '--format={{.State.Running}}', record.containerName])).trim() === 'true'
      if (running) ready = await this.checkReady(record.hostPort)
    } catch (error) {
      lastError = `Docker status could not be read: ${errorText(error)}`
    }
    return {
      id: record.id,
      phase: lastError ? 'error' : running ? (ready ? 'ready' : 'starting') : 'stopped',
      edition: profile.edition,
      profileId: profile.id,
      version: profile.version,
      image: gitlabImageReference(profile),
      containerName: record.containerName,
      bindAddress: '127.0.0.1',
      hostPort: record.hostPort,
      volumes: gitlabVolumes(record.id),
      ready,
      credentialReady: true,
      credentialHandedOff: record.credentialHandedOff,
      backupCount: record.backups.length,
      lastBackupAt: record.lastBackupAt,
      lastError,
      checkedAt: this.now()
    }
  }

  private async preflight(port: number): Promise<void> {
    await this.runDocker(['info', '--format={{.ServerVersion}}'])
    if (!(await canBind(port))) throw new Error(`Port ${port} is already in use on 127.0.0.1.`)
    const disk = await statfs(this.root).catch(async () => statfs(path.dirname(this.root)))
    const free = Number(disk.bavail) * Number(disk.bsize)
    if (!Number.isSafeInteger(free) || free < this.minFreeBytes) {
      throw new Error(`GitLab needs at least ${this.minFreeBytes} bytes free; only ${free} bytes are available.`)
    }
  }

  private async ensureVolumes(id: string): Promise<void> {
    const volumes = gitlabVolumes(id)
    for (const name of Object.values(volumes)) {
      await this.runDocker(['volume', 'create', '--label', 'dev.nodeterm.owner=nodeterm-gitlab', '--label', `dev.nodeterm.gitlab.id=${id}`, name])
    }
  }

  async create(input: GitLabCreateInput): Promise<GitLabServerStatus> {
    validateGitLabId(input.id)
    const profile = gitlabProfile(input.profileId)
    if (!profile) throw new Error('Choose a GitLab CE or EE profile from the shipped catalog.')
    const hostPort = validateGitLabPort(input.hostPort)
    if (await this.load(input.id)) throw new Error('This GitLab node already has a managed instance.')
    try {
      await this.preflight(hostPort)
      await mkdir(path.join(this.root, 'secrets'), { recursive: true })
      const secretFile = path.join(this.root, 'secrets', `${input.id}.root-password`)
      await writeFile(secretFile, `${randomBytes(24).toString('base64url')}\n`, { mode: 0o600, flag: 'wx' })
      await this.ensureVolumes(input.id)
      const record: GitLabRecord = {
        version: RECORD_VERSION,
        id: input.id,
        profileId: profile.id,
        hostPort,
        containerName: gitlabContainerName(input.id),
        secretFile,
        credentialHandedOff: false,
        createdAt: this.now(),
        lastBackupAt: null,
        backups: [],
        previousProfileId: null
      }
      await this.runDocker(buildGitLabRunArgs({ id: input.id, profile, hostPort, secretPath: secretFile }))
      await this.save(record)
      return this.status(input.id)
    } catch (error) {
      throw new Error(`GitLab ${profile.edition.toUpperCase()} start was not completed: ${errorText(error)}`)
    }
  }

  async handoffCredential(id: string): Promise<GitLabInitialCredential | null> {
    const record = await this.load(id)
    if (!record || record.credentialHandedOff) return null
    const password = (await readFile(record.secretFile, 'utf8')).trim()
    if (!password) throw new Error('The initial GitLab credential file is empty.')
    record.credentialHandedOff = true
    await this.save(record)
    return {
      username: 'root',
      password,
      handedOffAt: this.now(),
      warning: 'This credential is shown once. Store it in your password manager before closing this panel.'
    }
  }

  async listBackups(id: string): Promise<GitLabBackupSummary[]> {
    const record = await this.load(id)
    return record ? [...record.backups].sort((a, b) => b.createdAt - a.createdAt) : []
  }

  async createBackup(id: string): Promise<GitLabBackupSummary> {
    const record = await this.load(id)
    if (!record) throw new Error('Create the GitLab instance before making a backup.')
    await this.runDocker(buildGitLabFixedExecArgs(record.containerName, 'backup'))
    const backup: GitLabBackupSummary = {
      id: `backup-${this.now()}-${randomBytes(3).toString('hex')}`,
      filename: `gitlab-backup-${this.now()}.tar`,
      createdAt: this.now(),
      sizeBytes: null
    }
    record.backups = [backup, ...record.backups].slice(0, 100)
    record.lastBackupAt = backup.createdAt
    await this.save(record)
    return backup
  }

  async restoreBackup(id: string, backupId: string): Promise<GitLabServerStatus> {
    const record = await this.load(id)
    if (!record) throw new Error('Create the GitLab instance before restoring a backup.')
    const backup = record.backups.find((entry) => entry.id === backupId)
    if (!backup) throw new Error('That GitLab backup is not managed by this node.')
    await this.runDocker(buildGitLabFixedExecArgs(record.containerName, 'restore', backup.filename))
    return this.status(id)
  }

  async update(id: string, profileId: string): Promise<GitLabServerStatus> {
    const record = await this.load(id)
    const profile = gitlabProfile(profileId)
    if (!record || !profile) throw new Error('Choose an available GitLab catalog profile for the update.')
    if (record.profileId === profile.id) return this.status(id)
    await this.preflight(record.hostPort)
    await this.runDocker(['pull', gitlabImageReference(profile)])
    await this.runDocker(['stop', record.containerName])
    await this.runDocker(['rm', record.containerName])
    await this.runDocker(buildGitLabRunArgs({ id, profile, hostPort: record.hostPort, secretPath: record.secretFile }))
    record.previousProfileId = record.profileId
    record.profileId = profile.id
    await this.save(record)
    return this.status(id)
  }

  async rollback(id: string): Promise<GitLabServerStatus> {
    const record = await this.load(id)
    const previous = record?.previousProfileId ? gitlabProfile(record.previousProfileId) : undefined
    if (!record || !previous) throw new Error('No previous GitLab profile is available for rollback.')
    await this.runDocker(['stop', record.containerName])
    await this.runDocker(['rm', record.containerName])
    await this.runDocker(buildGitLabRunArgs({ id, profile: previous, hostPort: record.hostPort, secretPath: record.secretFile }))
    const current = record.profileId
    record.profileId = previous.id
    record.previousProfileId = current
    await this.save(record)
    return this.status(id)
  }

  async stop(id: string): Promise<GitLabServerStatus> {
    const record = await this.load(id)
    if (!record) return this.emptyStatus(id)
    await this.runDocker(['stop', record.containerName])
    return this.status(id)
  }

  async start(id: string): Promise<GitLabServerStatus> {
    const record = await this.load(id)
    if (!record) throw new Error('Create the GitLab instance before starting it.')
    await this.preflight(record.hostPort)
    await this.runDocker(['start', record.containerName])
    return this.status(id)
  }

  async tunnelHandoff(id: string) {
    const status = await this.status(id)
    if (!status.ready) throw new Error('GitLab must pass its local readiness check before tunnel handoff.')
    return {
      id,
      origin: `http://127.0.0.1:${status.hostPort}`,
      bindAddress: '127.0.0.1' as const,
      port: status.hostPort,
      ready: true as const,
      note: 'The origin is private-first. Continue in the tunnel wizard to choose any external exposure.'
    }
  }

  private async checkReady(port: number): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    try {
      const response = await this.fetchImpl(`http://127.0.0.1:${port}/users/sign_in`, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal
      })
      return response.status >= 200 && response.status < 500
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }
}
