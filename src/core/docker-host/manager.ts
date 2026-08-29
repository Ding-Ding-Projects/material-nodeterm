import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { renameAtomic, tempNameFor } from '../fs-atomic'
import { buildSshArgs, posixQuote, type SshConnection } from '../../shared/ssh'
import type {
  DockerComposeProfile,
  DockerComposeSummary,
  DockerContainerStats,
  DockerContainerSummary,
  DockerDestructiveKind,
  DockerDestructivePreview,
  DockerExecRequest,
  DockerExecResult,
  DockerHostSnapshot,
  DockerHostTarget,
  DockerHostTransport,
  DockerContextInfo,
  DockerHostVerification,
  DockerImageSummary,
  DockerLogOptions,
  DockerNetworkSummary,
  DockerVolumeSummary
} from '../../shared/docker-host'

const execFileAsync = promisify(execFile)
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_LABEL = /^\S[\s\S]{0,127}$/
const SAFE_CONTEXT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_HOST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_RESOURCE = /^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$/
const SAFE_PROJECT = /^[a-z0-9][a-z0-9_-]{0,62}$/
const SAFE_SERVICE = /^[a-z0-9][a-z0-9_.-]{0,63}$/
const SAFE_SINCE = /^(?:\d+[smhdw]|20\d\d-\d\d-\d\d(?:T[0-9:.+-]+Z?)?)$/
const MAX_OUTPUT = 4 * 1024 * 1024

export interface DockerCommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface DockerCommandTransport {
  run(args: readonly string[], timeoutMs?: number): Promise<DockerCommandResult>
}

export interface DockerCredentialVault {
  /** Resolve an SSH connection from the OS-backed credential/profile store. */
  resolveSshServer(serverId: string): Promise<SshConnection | null> | SshConnection | null
}

export interface DockerHostManagerOptions {
  userDataDir: string
  credentialVault?: DockerCredentialVault
  transportFor?: (target: DockerHostTarget) => Promise<DockerCommandTransport> | DockerCommandTransport
  now?: () => number
}

function rejectUnsafe(value: string, pattern: RegExp, message: string): string {
  const trimmed = value.trim()
  if (!pattern.test(trimmed)) throw new Error(message)
  return trimmed
}

function safeResource(value: string, label: string): string {
  return rejectUnsafe(value, SAFE_RESOURCE, `The selected ${label} is invalid.`)
}

function parseObjectLines<T>(stdout: string): T[] {
  const rows: T[] = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const value: unknown = JSON.parse(line)
      if (value && typeof value === 'object') rows.push(value as T)
    } catch {
      // Inventory output is a machine-readable contract. A malformed non-empty row is a failed
      // read, never an empty inventory that could make a destructive preview look harmless.
      throw new Error('Docker returned malformed inventory data.')
    }
  }
  return rows
}

function labelsOf(value: unknown): Record<string, string> {
  if (typeof value === 'string') {
    const labels: Record<string, string> = {}
    for (const pair of value.split(',')) {
      const index = pair.indexOf('=')
      if (index > 0) labels[pair.slice(0, index)] = pair.slice(index + 1)
    }
    return labels
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const labels: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && key.length <= 256 && entry.length <= 2048) labels[key] = entry
  }
  return labels
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

function bytesFromHuman(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value)
  if (typeof value !== 'string') return null
  const m = /([\d.]+)\s*(B|KB|MB|GB|TB)\b/i.exec(value.trim())
  if (!m) return null
  const units: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }
  const bytes = Number(m[1]) * units[m[2].toUpperCase()]
  return Number.isFinite(bytes) ? Math.round(bytes) : null
}

function stateOf(value: unknown): DockerContainerSummary['state'] {
  const s = typeof value === 'string' ? value.toLowerCase() : ''
  return ['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'].includes(s)
    ? s as DockerContainerSummary['state']
    : 'unknown'
}

function validateIds(ids: string[], label: string): string[] {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 256) throw new Error(`Choose at least one ${label}.`)
  return ids.map((id) => safeResource(id, label))
}

function validateCompose(profile: DockerComposeProfile): DockerComposeProfile {
  if (!profile || typeof profile !== 'object') throw new Error('Choose a Compose profile.')
  const filePath = rejectUnsafe(profile.filePath, /^\S{1,1024}$/, 'The Compose file path is invalid.')
  if (!isAbsolute(filePath)) throw new Error('The Compose file path must be absolute.')
  const projectName = rejectUnsafe(profile.projectName, SAFE_PROJECT, 'The Compose project name is invalid.')
  const services = Array.isArray(profile.services) ? profile.services.map((s) => rejectUnsafe(s, SAFE_SERVICE, 'The Compose service name is invalid.')) : []
  return { ...profile, filePath, projectName, services }
}

class LocalDockerTransport implements DockerCommandTransport {
  constructor(private readonly context: string) {}

  async run(args: readonly string[], timeoutMs = 30_000): Promise<DockerCommandResult> {
    const argv = [...(this.context ? ['--context', this.context] : []), ...args]
    try {
      const result = await execFileAsync('docker', argv, { windowsHide: true, timeout: timeoutMs, maxBuffer: MAX_OUTPUT })
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; code?: unknown; killed?: boolean; message?: string }
      const exitCode = typeof e.code === 'number' ? e.code : e.killed ? 124 : 1
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '', exitCode }
    }
  }
}

class SshDockerTransport implements DockerCommandTransport {
  constructor(private readonly connection: SshConnection) {}

  async run(args: readonly string[], timeoutMs = 30_000): Promise<DockerCommandResult> {
    // ssh accepts one remote command string. Each token is quoted from the typed argv so this is
    // still a Docker operation, never a caller-provided shell program.
    const remote = ['docker', ...args].map((arg) => posixQuote(arg)).join(' ')
    const argv = [...buildSshArgs(this.connection), remote]
    try {
      const result = await execFileAsync('ssh', argv, { windowsHide: true, timeout: timeoutMs, maxBuffer: MAX_OUTPUT })
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; code?: unknown; killed?: boolean; message?: string }
      const exitCode = typeof e.code === 'number' ? e.code : e.killed ? 124 : 1
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '', exitCode }
    }
  }
}

export class DockerHostManager {
  private readonly hostsPath: string
  private readonly now: () => number
  private readonly credentialVault?: DockerCredentialVault
  private readonly transportOverride?: DockerHostManagerOptions['transportFor']
  private hosts: DockerHostTarget[] = []
  private loaded: Promise<void> | null = null

  private static readonly DEFAULT_LOCAL_HOST: DockerHostTarget = {
    id: 'local',
    label: 'Local Docker',
    transport: { kind: 'local' },
    endpoint: 'docker://current',
    configuredAt: 0
  }

  constructor(options: DockerHostManagerOptions) {
    this.hostsPath = join(options.userDataDir, 'docker-hosts.json')
    this.now = options.now ?? Date.now
    this.credentialVault = options.credentialVault
    this.transportOverride = options.transportFor
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loaded = readFile(this.hostsPath, 'utf8').then((raw) => {
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) throw new Error('Docker host settings are malformed.')
        this.hosts = parsed.map((entry) => {
          if (!this.isTarget(entry)) throw new Error('Docker host settings contain an invalid host entry.')
          return entry
        })
      }).catch((error: unknown) => {
        // Only an absent file means no configured hosts. Corrupt state stays visible to the caller.
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return
        throw error
      })
      this.loaded = this.loaded.then(() => {
        if (this.hosts.length === 0) this.hosts = [{ ...DockerHostManager.DEFAULT_LOCAL_HOST, transport: { kind: 'local' } }]
      })
    }
    return this.loaded
  }

  private isTarget(value: unknown): value is DockerHostTarget {
    if (!value || typeof value !== 'object') return false
    const entry = value as Partial<DockerHostTarget>
    const transport = entry.transport as Partial<DockerHostTransport> | undefined
    const transportOk = transport?.kind === 'local'
      ? (() => { const context = (transport as { context?: unknown }).context; return !context || typeof context === 'string' && SAFE_CONTEXT.test(context) })()
      : transport?.kind === 'ssh' && typeof transport.serverId === 'string' && SAFE_HOST_ID.test(transport.serverId)
    return typeof entry.id === 'string' && SAFE_ID.test(entry.id) && typeof entry.label === 'string' &&
      SAFE_LABEL.test(entry.label) && typeof entry.endpoint === 'string' && typeof entry.configuredAt === 'number' && transportOk
  }

  private async persist(): Promise<void> {
    await mkdir(join(this.hostsPath, '..'), { recursive: true })
    const tmp = tempNameFor(this.hostsPath)
    try {
      await writeFile(tmp, JSON.stringify(this.hosts, null, 2), { encoding: 'utf8', mode: 0o600 })
      await renameAtomic(tmp, this.hostsPath)
    } catch (error) {
      await import('node:fs/promises').then(({ rm }) => rm(tmp, { force: true })).catch(() => {})
      throw error
    }
  }

  async listHosts(): Promise<DockerHostTarget[]> {
    await this.ensureLoaded()
    return this.hosts.map((host) => ({ ...host, transport: { ...host.transport } }))
  }

  async saveHost(input: { id?: string; label: string; transport: DockerHostTransport }): Promise<DockerHostTarget> {
    await this.ensureLoaded()
    const label = rejectUnsafe(input.label, SAFE_LABEL, 'The host label is invalid.')
    const transport = input.transport
    if (!transport || (transport.kind !== 'local' && transport.kind !== 'ssh')) throw new Error('Choose a local or SSH Docker host.')
    if (transport.kind === 'local' && transport.context) rejectUnsafe(transport.context, SAFE_CONTEXT, 'The Docker context is invalid.')
    if (transport.kind === 'ssh') rejectUnsafe(transport.serverId, SAFE_HOST_ID, 'The saved SSH host is invalid.')
    const id = input.id ? rejectUnsafe(input.id, SAFE_ID, 'The Docker host id is invalid.') : `docker-${randomUUID()}`
    const target: DockerHostTarget = {
      id,
      label,
      transport: transport.kind === 'local' ? { kind: 'local', ...(transport.context ? { context: transport.context.trim() } : {}) } : { kind: 'ssh', serverId: transport.serverId.trim() },
      endpoint: transport.kind === 'local' ? `docker://${transport.context?.trim() || 'current'}` : `ssh://${transport.serverId.trim()}`,
      configuredAt: this.now()
    }
    const index = this.hosts.findIndex((host) => host.id === id)
    if (index >= 0) this.hosts[index] = target
    else this.hosts.push(target)
    await this.persist()
    return { ...target, transport: { ...target.transport } }
  }

  async removeHost(id: string, confirmed = false): Promise<void> {
    const safeId = rejectUnsafe(id, SAFE_ID, 'The Docker host id is invalid.')
    if (!confirmed) throw new Error('Removing a configured Docker host requires explicit confirmation.')
    await this.ensureLoaded()
    const next = this.hosts.filter((host) => host.id !== safeId)
    if (next.length === this.hosts.length) throw new Error('The selected Docker host was not found.')
    this.hosts = next
    await this.persist()
  }

  private async target(id: string): Promise<DockerHostTarget> {
    await this.ensureLoaded()
    const target = this.hosts.find((host) => host.id === id)
    if (!target) throw new Error('The selected Docker host was not found.')
    return target
  }

  private async transport(id: string): Promise<{ target: DockerHostTarget; client: DockerCommandTransport }> {
    const target = await this.target(id)
    if (this.transportOverride) return { target, client: await this.transportOverride(target) }
    if (target.transport.kind === 'local') return { target, client: new LocalDockerTransport(target.transport.context?.trim() ?? '') }
    const connection = await this.credentialVault?.resolveSshServer(target.transport.serverId)
    if (!connection) throw new Error('The saved SSH host is unavailable in the machine-local credential vault.')
    return { target, client: new SshDockerTransport(connection) }
  }

  private async run(id: string, args: readonly string[], timeoutMs = 30_000): Promise<{ target: DockerHostTarget; result: DockerCommandResult }> {
    const { target, client } = await this.transport(id)
    const result = await client.run(args, timeoutMs)
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`
      throw new Error(`Docker operation on ${target.label} failed: ${detail.slice(0, 2000)}`)
    }
    return { target, result }
  }

  async verify(hostId: string): Promise<DockerHostVerification> {
    const checkedAt = this.now()
    try {
      const { result } = await this.run(hostId, ['version', '--format', '{{json .}}'], 15_000)
      const value = JSON.parse(result.stdout.trim()) as Record<string, unknown>
      const server = value.Server && typeof value.Server === 'object' ? value.Server as Record<string, unknown> : {}
      const components = Array.isArray(server.Components) ? server.Components : []
      const daemon = components.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).Name === 'Engine') as Record<string, unknown> | undefined
      const info = await this.run(hostId, ['info', '--format', '{{json .}}'], 15_000)
      const infoValue = JSON.parse(info.result.stdout.trim()) as Record<string, unknown>
      return {
        hostId,
        reachable: true,
        serverVersion: typeof daemon?.Version === 'string' ? daemon.Version : typeof server.Version === 'string' ? server.Version : null,
        apiVersion: typeof daemon?.ApiVersion === 'string' ? daemon.ApiVersion : null,
        operatingSystem: typeof infoValue.OSType === 'string' ? infoValue.OSType : null,
        architecture: typeof infoValue.Architecture === 'string' ? infoValue.Architecture : null,
        containers: finiteNumber(infoValue.Containers),
        images: finiteNumber(infoValue.Images),
        checkedAt,
        error: null
      }
    } catch (error) {
      return { hostId, reachable: false, serverVersion: null, apiVersion: null, operatingSystem: null, architecture: null, containers: null, images: null, checkedAt, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async listContexts(hostId: string): Promise<DockerContextInfo[]> {
    const { result } = await this.run(hostId, ['context', 'ls', '--format', '{{json .}}'])
    return parseObjectLines<Record<string, unknown>>(result.stdout).flatMap((row) => {
      const name = typeof row.Name === 'string' ? row.Name : ''
      return name && SAFE_CONTEXT.test(name) ? [{ name, current: row.Current === true || row.Current === '*', endpoint: typeof row.DockerEndpoint === 'string' ? row.DockerEndpoint : '' }] : []
    })
  }

  async listContainers(hostId: string): Promise<DockerContainerSummary[]> {
    const { result } = await this.run(hostId, ['ps', '--all', '--format', '{{json .}}'])
    return parseObjectLines<Record<string, unknown>>(result.stdout).flatMap((row) => {
      const id = typeof row.ID === 'string' ? row.ID : ''
      const name = typeof row.Names === 'string' ? row.Names : ''
      return id && name ? [{ id, name, image: String(row.Image ?? ''), command: String(row.Command ?? ''), createdAt: String(row.CreatedAt ?? ''), status: String(row.Status ?? ''), state: stateOf(row.State), ports: String(row.Ports ?? ''), labels: labelsOf(row.Labels) }] : []
    })
  }

  async listImages(hostId: string): Promise<DockerImageSummary[]> {
    const { result } = await this.run(hostId, ['images', '--all', '--format', '{{json .}}'])
    return parseObjectLines<Record<string, unknown>>(result.stdout).flatMap((row) => {
      const id = typeof row.ID === 'string' ? row.ID : ''
      if (!id) return []
      const repository = String(row.Repository ?? '')
      const tag = String(row.Tag ?? '')
      const digest = typeof row.Digest === 'string' && row.Digest !== '<none>' ? row.Digest : null
      return [{ id, repository, tag, digest, createdAt: String(row.CreatedAt ?? ''), sizeBytes: bytesFromHuman(row.Size) }]
    })
  }

  async listVolumes(hostId: string): Promise<DockerVolumeSummary[]> {
    const { result } = await this.run(hostId, ['volume', 'ls', '--format', '{{json .}}'])
    return parseObjectLines<Record<string, unknown>>(result.stdout).flatMap((row) => {
      const name = typeof row.Name === 'string' ? row.Name : ''
      return name ? [{ name, driver: String(row.Driver ?? ''), mountpoint: String(row.Mountpoint ?? ''), scope: String(row.Scope ?? ''), labels: labelsOf(row.Labels) }] : []
    })
  }

  async listNetworks(hostId: string): Promise<DockerNetworkSummary[]> {
    const { result } = await this.run(hostId, ['network', 'ls', '--format', '{{json .}}'])
    return parseObjectLines<Record<string, unknown>>(result.stdout).flatMap((row) => {
      const id = typeof row.ID === 'string' ? row.ID : ''
      return id ? [{ id, name: String(row.Name ?? ''), driver: String(row.Driver ?? ''), scope: String(row.Scope ?? ''), ipv6: typeof row.IPv6 === 'string' ? row.IPv6.toLowerCase() === 'true' : null, internal: typeof row.Internal === 'string' ? row.Internal.toLowerCase() === 'true' : null, labels: labelsOf(row.Labels) }] : []
    })
  }

  async listCompose(hostId: string, rawProfile: DockerComposeProfile): Promise<DockerComposeSummary[]> {
    const profile = validateCompose(rawProfile)
    const { result } = await this.run(hostId, ['compose', '-f', profile.filePath, '-p', profile.projectName, 'ps', '--all', '--format', '{{json .}}'])
    return parseObjectLines<Record<string, unknown>>(result.stdout).map((row) => ({ service: String(row.Service ?? ''), container: String(row.Name ?? ''), image: String(row.Image ?? ''), state: String(row.State ?? ''), ports: String(row.Publishers ?? row.Ports ?? '') }))
  }

  async inventory(hostId: string): Promise<DockerHostSnapshot> {
    const [verification, containers, images, volumes, networks] = await Promise.all([
      this.verify(hostId), this.listContainers(hostId), this.listImages(hostId), this.listVolumes(hostId), this.listNetworks(hostId)
    ])
    return { host: await this.target(hostId), verification, containers, images, volumes, networks, compose: [], readAt: this.now() }
  }

  private async lifecycle(hostId: string, action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause', id: string, timeoutSeconds?: number): Promise<void> {
    const resource = safeResource(id, 'container')
    const args = [action]
    if (timeoutSeconds !== undefined) {
      if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 600) throw new Error('The timeout must be a whole number from 0 to 600 seconds.')
      args.push('--time', String(timeoutSeconds))
    }
    args.push(resource)
    await this.run(hostId, args)
  }

  startContainer(hostId: string, id: string): Promise<void> { return this.lifecycle(hostId, 'start', id) }
  stopContainer(hostId: string, id: string, timeoutSeconds?: number): Promise<void> { return this.lifecycle(hostId, 'stop', id, timeoutSeconds) }
  restartContainer(hostId: string, id: string, timeoutSeconds?: number): Promise<void> { return this.lifecycle(hostId, 'restart', id, timeoutSeconds) }
  pauseContainer(hostId: string, id: string): Promise<void> { return this.lifecycle(hostId, 'pause', id) }
  unpauseContainer(hostId: string, id: string): Promise<void> { return this.lifecycle(hostId, 'unpause', id) }

  async stats(hostId: string, ids: string[] = []): Promise<DockerContainerStats[]> {
    const safeIds = ids.map((id) => safeResource(id, 'container'))
    const { result } = await this.run(hostId, ['stats', '--no-stream', '--format', '{{json .}}', ...safeIds], 45_000)
    return parseObjectLines<Record<string, unknown>>(result.stdout).flatMap((row) => {
      const containerId = typeof row.ID === 'string' ? row.ID : ''
      return containerId ? [{ containerId, name: String(row.Name ?? ''), cpuPercent: finiteNumber(String(row.CPUPerc ?? '').replace('%', '')), memoryUsageBytes: bytesFromHuman(String(row.MemUsage ?? '').split('/')[0]), memoryLimitBytes: bytesFromHuman(String(row.MemUsage ?? '').split('/')[1]), memoryPercent: finiteNumber(String(row.MemPerc ?? '').replace('%', '')), netInputBytes: bytesFromHuman(String(row.NetIO ?? '').split('/')[0]), netOutputBytes: bytesFromHuman(String(row.NetIO ?? '').split('/')[1]), blockInputBytes: bytesFromHuman(String(row.BlockIO ?? '').split('/')[0]), blockOutputBytes: bytesFromHuman(String(row.BlockIO ?? '').split('/')[1]), pids: finiteNumber(row.PIDs) }] : []
    })
  }

  async logs(hostId: string, options: DockerLogOptions): Promise<string> {
    const id = safeResource(options.containerId, 'container')
    if (!Number.isInteger(options.tail) || options.tail < 1 || options.tail > 50_000) throw new Error('Log lines must be a whole number from 1 to 50000.')
    const args = ['logs', '--tail', String(options.tail)]
    if (options.timestamps) args.push('--timestamps')
    if (options.since !== undefined) args.push('--since', rejectUnsafe(options.since, SAFE_SINCE, 'The log time filter is invalid.'))
    args.push(id)
    const { result } = await this.run(hostId, args, 45_000)
    return result.stdout.slice(0, MAX_OUTPUT)
  }

  async exec(hostId: string, request: DockerExecRequest): Promise<DockerExecResult> {
    const id = safeResource(request.containerId, 'container')
    if (!['sh', 'bash', 'node', 'python', 'env'].includes(request.program)) throw new Error('Choose a supported typed executable.')
    if (!Array.isArray(request.args) || request.args.length > 32) throw new Error('The typed executable accepts at most 32 arguments.')
    const args = request.args.map((arg) => {
      if (typeof arg !== 'string' || arg.length > 512 || /[\0\r\n;&|`$<>]/.test(arg)) throw new Error('An exec argument contains unsupported shell syntax.')
      return arg
    })
    if (args.some((arg) => arg === '-c' || arg === '--command' || arg.startsWith('-c='))) throw new Error('Inline shell programs are not supported. Choose a typed executable and arguments.')
    const { client } = await this.transport(hostId)
    const result = await client.run(['exec', ...(request.tty ? ['--tty'] : []), '--interactive', id, request.program, ...args], 60_000)
    return { exitCode: result.exitCode, stdout: result.stdout.slice(0, MAX_OUTPUT), stderr: result.stderr.slice(0, MAX_OUTPUT), truncated: result.stdout.length > MAX_OUTPUT || result.stderr.length > MAX_OUTPUT }
  }

  async previewDestructive(input: { hostId: string; kind: DockerDestructiveKind; ids: string[] }): Promise<DockerDestructivePreview> {
    const ids = validateIds(input.ids, 'resource')
    const labels: Record<DockerDestructiveKind, string> = { 'container-remove': 'Remove containers', 'image-remove': 'Remove images', 'volume-remove': 'Remove volumes', 'network-remove': 'Remove networks', 'compose-down': 'Stop the Compose project' }
    const kind = input.kind
    if (!(kind in labels)) throw new Error('Choose a supported destructive Docker action.')
    await this.target(input.hostId)
    return { kind, hostId: input.hostId, targetIds: ids, title: labels[kind], detail: `${labels[kind]} for ${ids.length} selected item${ids.length === 1 ? '' : 's'}. This action may be irreversible.`, irreversible: true, requiresConfirmation: true }
  }

  private async remove(hostId: string, command: string[], ids: string[], confirmed: boolean): Promise<void> {
    const safeIds = validateIds(ids, 'resource')
    if (!confirmed) throw new Error('This destructive Docker action requires the reviewed confirmation preview.')
    await this.run(hostId, [...command, ...safeIds])
  }

  removeContainers(hostId: string, ids: string[], confirmed: boolean): Promise<void> { return this.remove(hostId, ['rm'], ids, confirmed) }
  removeImages(hostId: string, ids: string[], confirmed: boolean): Promise<void> { return this.remove(hostId, ['rmi'], ids, confirmed) }
  removeVolumes(hostId: string, ids: string[], confirmed: boolean): Promise<void> { return this.remove(hostId, ['volume', 'rm'], ids, confirmed) }
  removeNetworks(hostId: string, ids: string[], confirmed: boolean): Promise<void> { return this.remove(hostId, ['network', 'rm'], ids, confirmed) }

  async composeUp(hostId: string, rawProfile: DockerComposeProfile, services: string[] = []): Promise<void> {
    const profile = validateCompose(rawProfile)
    const selected = services.length ? services.map((service) => rejectUnsafe(service, SAFE_SERVICE, 'The Compose service name is invalid.')) : profile.services
    await this.run(hostId, ['compose', '-f', profile.filePath, '-p', profile.projectName, 'up', '--detach', ...selected])
  }

  async composeDown(hostId: string, rawProfile: DockerComposeProfile, confirmed: boolean): Promise<void> {
    const profile = validateCompose(rawProfile)
    if (!confirmed) throw new Error('Stopping a Compose project requires the reviewed confirmation preview.')
    await this.run(hostId, ['compose', '-f', profile.filePath, '-p', profile.projectName, 'down'])
  }
}

export { LocalDockerTransport, SshDockerTransport, validateCompose }
