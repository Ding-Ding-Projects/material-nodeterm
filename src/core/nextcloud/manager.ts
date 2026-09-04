import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  DEFAULT_NEXTCLOUD_PROFILE,
  NEXTCLOUD_IMAGES,
  NEXTCLOUD_WEB_IMAGES,
  NEXTCLOUD_PROFILE_ID,
  isNextcloudRelease,
  normalizeNextcloudProfile,
  type NextcloudApi,
  type NextcloudBackupSummary,
  type NextcloudEvent,
  type NextcloudInstallInput,
  type NextcloudLocalBinding,
  type NextcloudManagedProfile,
  type NextcloudPhase,
  type NextcloudRelease,
  type NextcloudServiceName,
  type NextcloudServiceStatus,
  type NextcloudStatus
} from '../../shared/nextcloud'

const execFileAsync = promisify(execFile)
const SAFE_NODE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_BACKUP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export interface NextcloudManagerOptions {
  userDataDir: string
  run?: typeof execFileAsync
  onEvent?: (event: NextcloudEvent) => void
}

type StoredRecord = { profile: NextcloudManagedProfile; binding: NextcloudLocalBinding }

/**
 * Direct, typed Docker lifecycle for the managed no-socket profile. There is intentionally no
 * Compose parser, arbitrary image field, arbitrary command field, or environment editor here.
 * Every executable and argument below is selected by this module.
 */
export class NextcloudManager implements NextcloudApi {
  private readonly root: string
  private readonly run: typeof execFileAsync
  private readonly listeners = new Set<(event: NextcloudEvent) => void>()
  private readonly busy = new Set<string>()
  private readonly operation = new Map<string, NextcloudPhase>()

  constructor(private readonly options: NextcloudManagerOptions) {
    this.root = path.join(options.userDataDir, 'nextcloud-managed')
    this.run = options.run ?? execFileAsync
    if (options.onEvent) this.listeners.add(options.onEvent)
  }

  onEvent(listener: (event: NextcloudEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async status(id: string): Promise<NextcloudStatus> {
    const record = await this.readRecord(id)
    if (!record) {
      return {
        id,
        phase: 'unconfigured',
        profile: null,
        services: [],
        privateEndpoint: null,
        readiness: { database: false, redis: false, web: false, all: false },
        activeOperation: this.operation.get(id) ?? null,
        error: null,
        lastBackupAt: null,
        tunnelHandoff: 'not-requested'
      }
    }
    const services = await Promise.all((['postgres', 'redis', 'web'] as const).map((name) =>
      this.inspectService(record.binding.containers[name], name, record.profile.release)
    ))
    const readiness = {
      database: services[0].running && services[0].healthy !== false,
      redis: services[1].running && services[1].healthy !== false,
      web: services[2].running && services[2].healthy !== false,
      all: services.every((service) => service.running && service.healthy !== false)
    }
    const lastBackupAt = await this.readLastBackupAt(id)
    const error = services.find((service) => service.reason)?.reason ?? null
    const phase: NextcloudStatus['phase'] = this.operation.get(id)
      ?? (error && !readiness.all
        ? 'error'
        : readiness.all
          ? 'healthy'
          : services.every((service) => !service.running)
            ? 'stopped'
            : 'starting')
    return {
      id,
      phase,
      profile: record.profile,
      services,
      privateEndpoint: `http://127.0.0.1:${record.profile.port}`,
      readiness,
      activeOperation: this.operation.get(id) ?? null,
      error,
      lastBackupAt,
      tunnelHandoff: record.binding.tunnelHandoff
    }
  }

  async install(input: NextcloudInstallInput): Promise<NextcloudStatus> {
    const id = this.assertId(input.id)
    if (this.busy.has(id)) return this.status(id)
    const profile = normalizeNextcloudProfile({
      ...DEFAULT_NEXTCLOUD_PROFILE,
      release: input.release,
      port: input.port
    })
    this.busy.add(id)
    this.operation.set(id, 'installing')
    try {
      const record = await this.createRecord(id, profile)
      await this.ensureNetwork(profile.network)
      await this.createVolume(profile.dataVolume)
      await this.createVolume(profile.databaseVolume)
      await this.createVolume(profile.configVolume)
      await this.writeSecretFiles(record.binding)
      await this.removeContainers(record.binding)
      await this.runDatabase(record)
      await this.waitFor(record.binding.containers.postgres, 'postgres')
      await this.runRedis(record)
      await this.waitFor(record.binding.containers.redis, 'redis')
      await this.runWeb(record)
      await this.waitFor(record.binding.containers.web, 'web')
      return await this.emitStatus(id)
    } catch (error) {
      await this.writeFailure(id, error)
      return this.emitStatus(id)
    } finally {
      this.busy.delete(id)
      this.operation.delete(id)
    }
  }

  async update(id: string, release: NextcloudRelease): Promise<NextcloudStatus> {
    this.assertId(id)
    if (!isNextcloudRelease(release)) throw new Error('The selected Nextcloud release is unavailable.')
    const record = await this.requireRecord(id)
    if (this.busy.has(id)) return this.status(id)
    this.busy.add(id)
    this.operation.set(id, 'updating')
    try {
      await this.backup(id)
      const next: StoredRecord = {
        profile: { ...record.profile, release },
        binding: { ...record.binding, previousRelease: record.binding.currentRelease, currentRelease: release }
      }
      await this.writeRecord(id, next)
      await this.removeContainer(record.binding.containers.web)
      await this.runWeb(next)
      await this.waitFor(next.binding.containers.web, 'web')
      return this.emitStatus(id)
    } catch (error) {
      await this.writeFailure(id, error)
      return this.emitStatus(id)
    } finally {
      this.busy.delete(id)
      this.operation.delete(id)
    }
  }

  async listBackups(id: string): Promise<NextcloudBackupSummary[]> {
    this.assertId(id)
    const dir = path.join(this.root, id, 'backups')
    let names: string[]
    try { names = await readdir(dir) } catch { return [] }
    const out: NextcloudBackupSummary[] = []
    for (const name of names.filter((item) => SAFE_BACKUP_ID.test(item))) {
      const file = path.join(dir, name, 'manifest.json')
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8')) as NextcloudBackupSummary
        if (parsed.id === name && parsed.release && Array.isArray(parsed.includes)) out.push(parsed)
      } catch { /* An incomplete backup is not presented as usable. */ }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  }

  async backup(id: string): Promise<NextcloudBackupSummary> {
    const record = await this.requireRecord(id)
    if (this.busy.has(id) && this.operation.get(id) !== 'updating') throw new Error('Another Nextcloud operation is already in progress.')
    this.busy.add(id)
    this.operation.set(id, 'backing-up')
    const dir = path.join(this.root, id, 'backups', `${Date.now()}-${randomUUID().slice(0, 8)}`)
    try {
      await mkdir(dir, { recursive: true })
      const binding = record.binding
      await this.runDump(record, dir)
      await this.runTar(record, binding.containers.web, binding.containers.web, 'data', path.join(dir, 'data.tar'))
      await this.runTar(record, binding.containers.web, binding.containers.web, 'config', path.join(dir, 'config.tar'))
      const summary: NextcloudBackupSummary = {
        id: path.basename(dir), createdAt: Date.now(), path: dir, sizeBytes: await directorySize(dir),
        release: record.binding.currentRelease, includes: ['database', 'data', 'config']
      }
      await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(summary, null, 2), 'utf8')
      return summary
    } finally {
      this.busy.delete(id)
      this.operation.delete(id)
    }
  }

  async restore(id: string, backupId: string): Promise<NextcloudStatus> {
    this.assertId(id)
    if (!SAFE_BACKUP_ID.test(backupId)) throw new Error('The selected backup id is invalid.')
    const record = await this.requireRecord(id)
    const backupDir = path.join(this.root, id, 'backups', backupId)
    await stat(path.join(backupDir, 'manifest.json'))
    this.busy.add(id)
    this.operation.set(id, 'restoring')
    try {
      await this.removeContainers(record.binding)
      await this.runDatabase(record)
      await this.waitFor(record.binding.containers.postgres, 'postgres')
      await this.runRestoreDump(record, backupDir)
      await this.runExtract(record, backupDir, 'data')
      await this.runExtract(record, backupDir, 'config')
      await this.runRedis(record)
      await this.runWeb(record)
      await this.waitFor(record.binding.containers.web, 'web')
      return this.emitStatus(id)
    } catch (error) {
      await this.writeFailure(id, error)
      return this.emitStatus(id)
    } finally {
      this.busy.delete(id)
      this.operation.delete(id)
    }
  }

  async rollback(id: string): Promise<NextcloudStatus> {
    const record = await this.requireRecord(id)
    if (!record.binding.previousRelease) throw new Error('No previous Nextcloud release is available for rollback.')
    return this.update(id, record.binding.previousRelease)
  }

  async requestTunnelHandoff(id: string): Promise<NextcloudStatus> {
    const record = await this.requireRecord(id)
    const current = await this.status(id)
    if (!current.readiness.all) throw new Error('Tunnel handoff is available only after all private services are healthy.')
    await this.writeRecord(id, { ...record, binding: { ...record.binding, tunnelHandoff: 'eligible' } })
    return this.emitStatus(id)
  }

  async remove(id: string, deleteData: boolean): Promise<void> {
    const record = await this.readRecord(id)
    if (!record) return
    await this.removeContainers(record.binding)
    if (deleteData) {
      for (const volume of [record.profile.dataVolume, record.profile.databaseVolume, record.profile.configVolume]) {
        await this.docker(['volume', 'rm', volume]).catch(() => {})
      }
      await this.docker(['network', 'rm', record.profile.network]).catch(() => {})
      await rm(path.join(this.root, id), { recursive: true, force: true })
    }
  }

  private async createRecord(id: string, profile: NextcloudManagedProfile): Promise<StoredRecord> {
    const dir = path.join(this.root, id)
    const containers = {
      postgres: `nodeterm-nc-${id}-postgres`,
      redis: `nodeterm-nc-${id}-redis`,
      web: `nodeterm-nc-${id}-web`
    } as Record<NextcloudServiceName, string>
    const record: StoredRecord = {
      profile,
      binding: {
        profileId: NEXTCLOUD_PROFILE_ID,
        nodeId: id,
        rootDir: dir,
        secretFiles: {
          databasePassword: path.join(dir, 'secrets', 'postgres-password'),
          adminPassword: path.join(dir, 'secrets', 'admin-password')
        },
        containers,
        previousRelease: null,
        currentRelease: profile.release,
        tunnelHandoff: 'not-requested'
      }
    }
    await this.writeRecord(id, record)
    return record
  }

  private async writeSecretFiles(binding: NextcloudLocalBinding): Promise<void> {
    await mkdir(path.dirname(binding.secretFiles.databasePassword), { recursive: true })
    const databasePassword = randomBytes(32).toString('base64url')
    const adminPassword = randomBytes(32).toString('base64url')
    await writeFile(binding.secretFiles.databasePassword, databasePassword, { mode: 0o600 })
    await writeFile(binding.secretFiles.adminPassword, adminPassword, { mode: 0o600 })
    await writeFile(path.join(binding.rootDir, 'secrets', 'postgres.env'), `POSTGRES_DB=nextcloud\nPOSTGRES_USER=nextcloud\nPOSTGRES_PASSWORD=${databasePassword}\n`, { mode: 0o600 })
    await writeFile(path.join(binding.rootDir, 'secrets', 'web.env'), [
      'POSTGRES_HOST=postgres', 'POSTGRES_DB=nextcloud', 'POSTGRES_USER=nextcloud',
      'POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password', 'REDIS_HOST=redis',
      'NEXTCLOUD_ADMIN_USER=admin', 'NEXTCLOUD_ADMIN_PASSWORD_FILE=/run/secrets/admin_password'
    ].join('\n') + '\n', { mode: 0o600 })
    await chmod(binding.secretFiles.databasePassword, 0o600).catch(() => {})
    await chmod(binding.secretFiles.adminPassword, 0o600).catch(() => {})
  }

  private async runDatabase(record: StoredRecord): Promise<void> {
    await this.docker([
      'run', '--detach', '--name', record.binding.containers.postgres, '--restart', 'unless-stopped',
      '--network', record.profile.network, '--label', 'dev.nodeterm.managed=nextcloud',
      '--health-cmd', 'pg_isready -U nextcloud -d nextcloud', '--health-interval', '5s', '--health-timeout', '3s', '--health-retries', '20',
      '--env-file', path.join(record.binding.rootDir, 'secrets', 'postgres.env'),
      '--mount', `type=volume,source=${record.profile.databaseVolume},target=/var/lib/postgresql/data`,
      NEXTCLOUD_IMAGES.postgres
    ])
  }

  private async runRedis(record: StoredRecord): Promise<void> {
    await this.docker([
      'run', '--detach', '--name', record.binding.containers.redis, '--restart', 'unless-stopped',
      '--network', record.profile.network, '--label', 'dev.nodeterm.managed=nextcloud',
      '--health-cmd', 'redis-cli ping', '--health-interval', '5s', '--health-timeout', '3s', '--health-retries', '20',
      '--mount', `type=volume,source=${record.profile.configVolume},target=/data`, NEXTCLOUD_IMAGES.redis
    ])
  }

  private async runWeb(record: StoredRecord): Promise<void> {
    await this.docker([
      'run', '--detach', '--name', record.binding.containers.web, '--restart', 'unless-stopped',
      '--network', record.profile.network, '--label', 'dev.nodeterm.managed=nextcloud',
      '--publish', `127.0.0.1:${record.profile.port}:80`,
      '--health-cmd', 'curl -f http://127.0.0.1/status.php', '--health-interval', '5s', '--health-timeout', '3s', '--health-retries', '30',
      '--env-file', path.join(record.binding.rootDir, 'secrets', 'web.env'),
      '--mount', `type=volume,source=${record.profile.dataVolume},target=/var/www/html/data`,
      '--mount', `type=volume,source=${record.profile.configVolume},target=/var/www/html/config`,
      '--mount', `type=bind,source=${record.binding.secretFiles.databasePassword},target=/run/secrets/postgres_password,readonly`,
      '--mount', `type=bind,source=${record.binding.secretFiles.adminPassword},target=/run/secrets/admin_password,readonly`,
      imageForRelease(record.profile.release)
    ])
  }

  private async runDump(record: StoredRecord, dir: string): Promise<void> {
    const envPath = path.join(record.binding.rootDir, 'secrets', 'backup.env')
    const dbPassword = (await readFile(record.binding.secretFiles.databasePassword, 'utf8')).trim()
    await writeFile(envPath, `PGPASSWORD=${dbPassword}\n`, { mode: 0o600 })
    await this.docker([
      'run', '--rm', '--network', record.profile.network, '--env-file', envPath,
      '--mount', `type=bind,source=${dir},target=/backup`, NEXTCLOUD_IMAGES.postgres,
      'pg_dump', '-h', record.binding.containers.postgres, '-U', 'nextcloud', '-d', 'nextcloud', '-f', '/backup/database.sql'
    ])
  }

  private async runRestoreDump(record: StoredRecord, dir: string): Promise<void> {
    const envPath = path.join(record.binding.rootDir, 'secrets', 'backup.env')
    const dbPassword = (await readFile(record.binding.secretFiles.databasePassword, 'utf8')).trim()
    await writeFile(envPath, `PGPASSWORD=${dbPassword}\n`, { mode: 0o600 })
    await this.docker([
      'run', '--rm', '--network', record.profile.network, '--env-file', envPath,
      '--mount', `type=bind,source=${dir},target=/backup`, NEXTCLOUD_IMAGES.postgres,
      'psql', '-h', record.binding.containers.postgres, '-U', 'nextcloud', '-d', 'nextcloud', '-f', '/backup/database.sql'
    ])
  }

  private async runTar(record: StoredRecord, _sourceContainer: string, _targetContainer: string, kind: 'data' | 'config', destination: string): Promise<void> {
    const volume = kind === 'data' ? record.profile.dataVolume : record.profile.configVolume
    await this.docker([
      'run', '--rm', '--mount', `type=volume,source=${volume},target=/input,readonly`,
      '--mount', `type=bind,source=${path.dirname(destination)},target=/backup`, imageForRelease(record.profile.release),
      'tar', '-cf', `/backup/${path.basename(destination)}`, '-C', '/input', '.'
    ])
  }

  private async runExtract(record: StoredRecord, dir: string, kind: 'data' | 'config'): Promise<void> {
    const volume = kind === 'data' ? record.profile.dataVolume : record.profile.configVolume
    await this.docker([
      'run', '--rm', '--mount', `type=volume,source=${volume},target=/output`,
      '--mount', `type=bind,source=${dir},target=/backup,readonly`, imageForRelease(record.profile.release),
      'tar', '-xf', `/backup/${kind}.tar`, '-C', '/output'
    ])
  }

  private async waitFor(container: string, service: NextcloudServiceName): Promise<void> {
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      const status = await this.inspectService(container, service)
      if (status.running && status.healthy !== false) return
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    throw new Error(`${service} did not become ready before the bounded readiness deadline.`)
  }

  private async inspectService(container: string, name: NextcloudServiceName, release: NextcloudRelease = DEFAULT_NEXTCLOUD_PROFILE.release): Promise<NextcloudServiceStatus> {
    try {
      const { stdout } = await this.docker(['inspect', container])
      const [row] = JSON.parse(stdout) as Array<{ State?: { Running?: boolean; Health?: { Status?: string; Log?: Array<{ Output?: string }> } } }>
      const state = row?.State
      const health = state?.Health?.Status
      return {
        name,
        containerName: container,
        image: name === 'web' ? imageForRelease(release) : name === 'postgres' ? NEXTCLOUD_IMAGES.postgres : NEXTCLOUD_IMAGES.redis,
        running: state?.Running === true,
        healthy: health ? health === 'healthy' : null,
        reason: state?.Running === false ? 'The managed container is stopped.' : health === 'unhealthy' ? state?.Health?.Log?.at(-1)?.Output ?? 'The readiness probe reported unhealthy.' : null
      }
    } catch {
      return { name, containerName: container, image: name === 'web' ? imageForRelease(release) : name === 'postgres' ? NEXTCLOUD_IMAGES.postgres : NEXTCLOUD_IMAGES.redis, running: false, healthy: false, reason: 'The managed container is not present.' }
    }
  }

  private async ensureNetwork(network: string): Promise<void> {
    if (!/^[a-z0-9][a-z0-9_.-]{0,62}$/.test(network)) throw new Error('The managed network name is invalid.')
    if ((await this.docker(['network', 'inspect', network]).catch(() => null)) === null) await this.docker(['network', 'create', '--label', 'dev.nodeterm.managed=nextcloud', network])
  }

  private async createVolume(volume: string): Promise<void> {
    if (!/^[a-z0-9][a-z0-9_.-]{0,62}$/.test(volume)) throw new Error('The managed volume name is invalid.')
    await this.docker(['volume', 'create', '--label', 'dev.nodeterm.managed=nextcloud', volume])
  }

  private async removeContainers(binding: NextcloudLocalBinding): Promise<void> {
    await Promise.all(Object.values(binding.containers).map((container) => this.removeContainer(container)))
  }

  private async removeContainer(container: string): Promise<void> {
    await this.docker(['rm', '--force', container]).catch(() => {})
  }

  private async docker(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return this.run('docker', args, { windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 })
  }

  private async readRecord(id: string): Promise<StoredRecord | null> {
    try {
      const parsed = JSON.parse(await readFile(path.join(this.root, id, 'binding.json'), 'utf8')) as StoredRecord
      if (parsed.binding?.profileId !== NEXTCLOUD_PROFILE_ID || parsed.binding.nodeId !== id) return null
      const expectedRoot = path.join(this.root, id)
      const expectedContainers = {
        postgres: `nodeterm-nc-${id}-postgres`,
        redis: `nodeterm-nc-${id}-redis`,
        web: `nodeterm-nc-${id}-web`
      }
      const binding = parsed.binding
      if (binding.rootDir !== expectedRoot ||
          binding.secretFiles?.databasePassword !== path.join(expectedRoot, 'secrets', 'postgres-password') ||
          binding.secretFiles?.adminPassword !== path.join(expectedRoot, 'secrets', 'admin-password') ||
          binding.containers?.postgres !== expectedContainers.postgres ||
          binding.containers?.redis !== expectedContainers.redis ||
          binding.containers?.web !== expectedContainers.web ||
          !isNextcloudRelease(binding.currentRelease) ||
          (binding.previousRelease !== null && !isNextcloudRelease(binding.previousRelease)) ||
          !['not-requested', 'eligible', 'handed-off'].includes(binding.tunnelHandoff)) return null
      return { profile: normalizeNextcloudProfile(parsed.profile), binding }
    } catch { return null }
  }

  private async requireRecord(id: string): Promise<StoredRecord> {
    const record = await this.readRecord(id)
    if (!record) throw new Error('This Nextcloud profile has not been installed yet.')
    return record
  }

  private async writeRecord(id: string, record: StoredRecord): Promise<void> {
    await mkdir(path.join(this.root, id), { recursive: true })
    await writeFile(path.join(this.root, id, 'binding.json'), JSON.stringify(record, null, 2), { mode: 0o600 })
  }

  private async writeFailure(id: string, error: unknown): Promise<void> {
    const record = await this.readRecord(id)
    if (!record) return
    await writeFile(path.join(record.binding.rootDir, 'last-error.txt'), error instanceof Error ? error.message : String(error), { mode: 0o600 }).catch(() => {})
  }

  private async readLastBackupAt(id: string): Promise<number | null> {
    const backups = await this.listBackups(id)
    return backups[0]?.createdAt ?? null
  }

  private async emitStatus(id: string): Promise<NextcloudStatus> {
    const status = await this.status(id)
    const event: NextcloudEvent = { kind: 'status', id, status }
    for (const listener of this.listeners) listener(event)
    return status
  }

  private assertId(id: string): string {
    if (!SAFE_NODE_ID.test(id)) throw new Error('The Nextcloud node id is invalid.')
    return id
  }
}

function imageForRelease(release: NextcloudRelease): string {
  return isNextcloudRelease(release) ? NEXTCLOUD_WEB_IMAGES[release] : NEXTCLOUD_IMAGES.web
}

async function directorySize(dir: string): Promise<number> {
  let total = 0
  for (const name of await readdir(dir)) {
    const entry = path.join(dir, name)
    const info = await stat(entry)
    total += info.isDirectory() ? await directorySize(entry) : info.size
  }
  return total
}
