import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { writeFileAtomic } from '../../core/fs-atomic'
import {
  CLOUDFLARED_CONTAINER_PREFIX,
  CLOUDFLARED_RUNTIME_SCHEMA_VERSION,
  CLOUDFLARED_SERVICE_PREFIX,
  assertCloudflaredId,
  assertCloudflaredName,
  cloudflaredDockerArgs,
  cloudflaredRunArgs,
  cloudflaredWindowsServiceArgs,
  type CloudflaredDockerContext,
  type CloudflaredDockerNetwork,
  type CloudflaredExecutable,
  type CloudflaredRuntimeApi,
  type CloudflaredRuntimeHealth,
  type CloudflaredRuntimeIntent,
  type CloudflaredRuntimeOption,
  type CloudflaredRuntimeProgress,
  type CloudflaredRuntimeRecord,
  type CloudflaredRuntimeSelection,
  type CloudflaredRuntimeState,
  validateCloudflaredIntent,
  validateCloudflaredSelection
} from '../../shared/cloudflared-runtime'

const execFileAsync = promisify(execFile)
const MAX_OUTPUT = 512 * 1024
const MAX_TOKEN = 16 * 1024
const SAFE_TOKEN = /^[^\r\n\0]{1,16384}$/

export interface CloudflaredSafeStorageLike {
  isEncryptionAvailable(): boolean
  getSelectedStorageBackend?(): string
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

interface StoredCredential {
  version: 1
  kind: 'safe-storage' | 'restricted-file'
  value: string
}

interface StoredRecord {
  intent: CloudflaredRuntimeIntent
  binding: CloudflaredRuntimeRecord['binding']
  state: CloudflaredRuntimeState
  reason?: CloudflaredRuntimeRecord['reason']
  detail?: string
  updatedAt: number
}

function outputOf(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, MAX_OUTPUT) : String(error).slice(0, MAX_OUTPUT)
}

function safeToken(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_TOKEN || !SAFE_TOKEN.test(value)) throw new Error('The cloudflared tunnel credential is invalid.')
  return value
}

function safeAbsolutePath(value: string): string {
  const resolved = path.resolve(value)
  if (resolved !== value && !path.isAbsolute(value)) throw new Error('The cloudflared path must be absolute.')
  if (/[\r\n\0,]/.test(resolved)) throw new Error('The cloudflared path contains an unsupported character.')
  return resolved
}

function serviceNameFor(nodeId: string): string {
  return `${CLOUDFLARED_SERVICE_PREFIX}${assertCloudflaredName(nodeId.replace(/[^A-Za-z0-9._-]/g, '-'), 'Cloudflared node id')}`.slice(0, 127)
}

function containerNameFor(nodeId: string): string {
  return `${CLOUDFLARED_CONTAINER_PREFIX}-${assertCloudflaredName(nodeId.replace(/[^A-Za-z0-9._-]/g, '-'), 'Cloudflared node id')}`.slice(0, 127)
}

async function command(command: string, args: string[], timeout = 15_000): Promise<string> {
  const result = await execFileAsync(command, args, { windowsHide: true, timeout, maxBuffer: MAX_OUTPUT })
  return String(result.stdout).slice(0, MAX_OUTPUT)
}

function jsonLines<T>(raw: string, map: (row: Record<string, unknown>) => T | null): T[] {
  return raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      const value = JSON.parse(line) as unknown
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const mapped = map(value as Record<string, unknown>)
      return mapped === null ? [] : [mapped]
    } catch {
      return []
    }
  })
}

function textField(row: Record<string, unknown>, key: string): string {
  return typeof row[key] === 'string' ? String(row[key]) : ''
}

async function discoverExecutableCandidates(): Promise<CloudflaredExecutable[]> {
  let locations: string[] = []
  try {
    locations = (await command(process.platform === 'win32' ? 'where.exe' : 'which', ['cloudflared'], 5_000))
      .split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 16)
  } catch {
    locations = []
  }
  const results: CloudflaredExecutable[] = []
  for (const location of locations) {
    try {
      const resolved = safeAbsolutePath(location)
      const versionOutput = await command(resolved, ['--version'], 8_000)
      const version = versionOutput.trim().split(/\s+/).find((item) => /^v?\d+\.\d+\.\d+/.test(item)) ?? 'unknown'
      results.push({ path: resolved, version, source: 'discovered-path' })
    } catch {
      // A stale PATH entry is not a usable executable and is not exposed as a selection.
    }
  }
  return results.filter((item, index, all) => all.findIndex((candidate) => candidate.path === item.path) === index)
}

export async function discoverCloudflaredExecutables(): Promise<CloudflaredExecutable[]> {
  return discoverExecutableCandidates()
}

export async function discoverCloudflaredDockerContexts(): Promise<CloudflaredDockerContext[]> {
  try {
    const raw = await command('docker', ['context', 'ls', '--format', '{{json .}}'], 8_000)
    return jsonLines(raw, (row) => {
      const name = textField(row, 'Name')
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) return null
      const endpoint = textField(row, 'DockerEndpoint')
      return {
        name,
        current: row.Current === true || row.Current === '*',
        endpointLabel: endpoint.startsWith('ssh:') ? 'SSH context' : endpoint.startsWith('npipe:') || endpoint.startsWith('unix:') ? 'Local context' : 'Docker context',
        available: true
      }
    })
  } catch (error) {
    // An unavailable Docker installation is represented by the runtime option catalog. Do not
    // put a synthetic context into the picker, because a disabled row must never be selectable.
    void error
    return []
  }
}

export async function discoverCloudflaredDockerNetworks(context: string): Promise<CloudflaredDockerNetwork[]> {
  const selected = context ? assertCloudflaredName(context, 'Docker context') : ''
  const raw = await command('docker', [...(selected ? ['--context', selected] : []), 'network', 'ls', '--format', '{{json .}}'], 10_000)
  return jsonLines(raw, (row) => {
    const id = textField(row, 'ID')
    const name = textField(row, 'Name')
    if (!id || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(name)) return null
    return { id, name, driver: textField(row, 'Driver'), internal: textField(row, 'Internal') === 'true' }
  }).slice(0, 256)
}

export class ElectronCloudflaredCredentialStore {
  private readonly directory: string

  constructor(private readonly userDataDir: string, private readonly safeStorage: CloudflaredSafeStorageLike) {
    this.directory = path.join(userDataDir, 'cloudflared-credentials')
  }

  private file(ref: string): string {
    return path.join(this.directory, `${assertCloudflaredId(ref, 'Cloudflared credential reference')}.json`)
  }

  private canEncrypt(): boolean {
    if (!this.safeStorage.isEncryptionAvailable()) return false
    try { return this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text' } catch { return false }
  }

  async save(ref: string, token: string): Promise<void> {
    const value = safeToken(token)
    await fs.mkdir(this.directory, { recursive: true })
    const document: StoredCredential = this.canEncrypt()
      ? { version: 1, kind: 'safe-storage', value: this.safeStorage.encryptString(value).toString('base64') }
      : { version: 1, kind: 'restricted-file', value }
    await writeFileAtomic(this.file(ref), JSON.stringify(document), { mode: 0o600 })
    await fs.chmod(this.file(ref), 0o600)
  }

  async read(ref: string): Promise<string | null> {
    let raw: string
    try { raw = await fs.readFile(this.file(ref), 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null
      throw error
    }
    let value: unknown
    try { value = JSON.parse(raw) } catch { throw new Error('The stored cloudflared credential is corrupt.') }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The stored cloudflared credential is corrupt.')
    const document = value as Partial<StoredCredential>
    if (document.version !== 1 || typeof document.value !== 'string' || !['safe-storage', 'restricted-file'].includes(String(document.kind))) throw new Error('The stored cloudflared credential is unsupported.')
    if (document.kind === 'safe-storage') {
      if (!this.canEncrypt()) throw new Error('The operating-system credential store is unavailable. Unlock it and retry.')
      try { return safeToken(this.safeStorage.decryptString(Buffer.from(document.value, 'base64'))) } catch { throw new Error('The stored cloudflared credential could not be decrypted.') }
    }
    return safeToken(document.value)
  }

  async clear(ref: string): Promise<void> {
    await fs.rm(this.file(ref), { force: true })
  }
}

export interface CloudflaredRuntimeManagerOptions {
  userDataDir: string
  safeStorage: CloudflaredSafeStorageLike
  platform?: NodeJS.Platform
}

/**
 * Main-process owner for connector lifecycles. Only this class may materialize a token file or
 * invoke cloudflared, Docker, or the Windows service controller. All invocations use fixed argv.
 */
export class CloudflaredRuntimeManager implements CloudflaredRuntimeApi {
  private readonly recordsFile: string
  private readonly tokenRoot: string
  private readonly credentialStore: ElectronCloudflaredCredentialStore
  private readonly processes = new Map<string, ChildProcess>()
  private readonly operations = new Map<string, { nodeId: string; process?: ChildProcess; cancelled: boolean }>()
  private readonly listeners = new Set<(progress: CloudflaredRuntimeProgress) => void>()
  private readonly recordMap = new Map<string, StoredRecord>()
  private loaded = false
  private readonly platform: NodeJS.Platform

  constructor(private readonly optionsConfig: CloudflaredRuntimeManagerOptions) {
    this.recordsFile = path.join(optionsConfig.userDataDir, 'cloudflared-runtime-records.json')
    this.tokenRoot = path.join(optionsConfig.userDataDir, 'cloudflared-runtimes')
    this.credentialStore = new ElectronCloudflaredCredentialStore(optionsConfig.userDataDir, optionsConfig.safeStorage)
    this.platform = optionsConfig.platform ?? process.platform
  }

  private emit(progress: CloudflaredRuntimeProgress): void {
    for (const listener of this.listeners) listener(progress)
  }

  onProgress(listener: (progress: CloudflaredRuntimeProgress) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = await fs.readFile(this.recordsFile, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return
      for (const item of parsed) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue
        try {
          const record = item as StoredRecord
          const intent = validateCloudflaredIntent(record.intent)
          this.recordMap.set(intent.nodeId, {
            intent,
            binding: record.binding ?? null,
            state: ['unconfigured', 'disabled', 'starting', 'running', 'stopping', 'stopped', 'failed'].includes(record.state) ? record.state : 'stopped',
            reason: record.reason,
            detail: typeof record.detail === 'string' ? record.detail.slice(0, 2048) : undefined,
            updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now()
          })
        } catch {
          // An invalid local row is not a reason to drop the other connector intents.
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw new Error(`Cloudflared runtime state could not be read: ${outputOf(error)}`)
    }
  }

  private async persistRecords(): Promise<void> {
    await fs.mkdir(path.dirname(this.recordsFile), { recursive: true })
    await writeFileAtomic(this.recordsFile, JSON.stringify([...this.recordMap.values()]), { mode: 0o600 })
    await fs.chmod(this.recordsFile, 0o600)
  }

  async options(): Promise<CloudflaredRuntimeOption[]> {
    const executables = await discoverExecutableCandidates()
    const dockerContexts = await discoverCloudflaredDockerContexts()
    const dockerAvailable = dockerContexts.some((context) => context.available)
    return [
      {
        runtime: 'user-process',
        available: executables.length > 0,
        label: 'Per-user process',
        reason: executables.length > 0 ? undefined : 'executable-missing',
        detail: executables.length > 0 ? undefined : 'Select a discovered cloudflared executable or use the documented per-user installation flow.',
        requiresElevation: false,
        portable: true
      },
      {
        runtime: 'windows-service',
        available: this.platform === 'win32' && executables.length > 0,
        label: 'Windows service',
        reason: this.platform !== 'win32' ? 'platform-unsupported' : executables.length > 0 ? undefined : 'executable-missing',
        detail: this.platform !== 'win32' ? 'Windows service control is only available on Windows.' : executables.length > 0 ? 'Service creation may require administrator approval.' : 'A discovered cloudflared executable is required.',
        requiresElevation: true,
        portable: false
      },
      {
        runtime: 'docker',
        available: dockerAvailable,
        label: 'Docker connector',
        reason: dockerAvailable ? undefined : 'docker-unavailable',
        detail: dockerAvailable ? undefined : 'Start Docker and configure at least one available context before selecting this runtime.',
        requiresElevation: false,
        portable: true
      }
    ]
  }

  async executables(): Promise<CloudflaredExecutable[]> { return discoverExecutableCandidates() }
  async dockerContexts(): Promise<CloudflaredDockerContext[]> { return discoverCloudflaredDockerContexts() }
  async dockerNetworks(context: string): Promise<CloudflaredDockerNetwork[]> { return discoverCloudflaredDockerNetworks(context) }

  async records(): Promise<CloudflaredRuntimeRecord[]> {
    await this.ensureLoaded()
    return [...this.recordMap.values()].map((record) => ({ ...record, intent: { ...record.intent }, binding: record.binding ? { ...record.binding } : null }))
  }

  async saveIntent(value: CloudflaredRuntimeIntent): Promise<CloudflaredRuntimeRecord> {
    await this.ensureLoaded()
    const intent = validateCloudflaredIntent(value)
    const previous = this.recordMap.get(intent.nodeId)
    const record: StoredRecord = {
      intent,
      binding: previous?.binding ?? null,
      state: previous?.state ?? 'unconfigured',
      reason: previous?.reason,
      detail: previous?.detail,
      updatedAt: Date.now()
    }
    this.recordMap.set(intent.nodeId, record)
    await this.persistRecords()
    return { ...record, intent: { ...record.intent }, binding: record.binding ? { ...record.binding } : null }
  }

  async saveCredential(credentialRef: string, token: string): Promise<void> {
    await this.credentialStore.save(credentialRef, token)
  }

  async clearCredential(credentialRef: string): Promise<void> {
    await this.credentialStore.clear(credentialRef)
  }

  async credentialStatus(credentialRef: string): Promise<{ available: boolean; reason?: 'missing' | 'unavailable' | 'corrupt' }> {
    try {
      const value = await this.credentialStore.read(credentialRef)
      return value ? { available: true } : { available: false, reason: 'missing' }
    } catch (error) {
      const detail = outputOf(error)
      return { available: false, reason: /unavailable|unlock|keychain|credential store/i.test(detail) ? 'unavailable' : 'corrupt' }
    }
  }

  private async update(record: StoredRecord, state: CloudflaredRuntimeState, detail?: string, reason?: StoredRecord['reason']): Promise<void> {
    record.state = state
    record.detail = detail?.slice(0, 2048)
    record.reason = reason
    record.updatedAt = Date.now()
    await this.persistRecords()
  }

  private async tokenFile(ref: string, nodeId: string): Promise<string> {
    const token = await this.credentialStore.read(ref)
    if (!token) throw new Error('The cloudflared tunnel credential is missing. Save it in local credential storage before starting.')
    const directory = path.join(this.tokenRoot, assertCloudflaredId(nodeId, 'Cloudflared node id'))
    await fs.mkdir(directory, { recursive: true })
    const target = path.join(directory, 'token')
    await writeFileAtomic(target, token, { mode: 0o600 })
    await fs.chmod(target, 0o600)
    return target
  }

  private async checkSelection(selection: CloudflaredRuntimeSelection): Promise<{ selection: CloudflaredRuntimeSelection; executable?: string; serviceName?: string; containerName?: string }> {
    const normalized = validateCloudflaredSelection(selection)
    if (normalized.runtime === 'user-process' || normalized.runtime === 'windows-service') {
      const executable = normalized.executablePath ? safeAbsolutePath(normalized.executablePath) : (await discoverExecutableCandidates())[0]?.path
      if (!executable) throw new Error('Choose a discovered cloudflared executable before starting.')
      if (normalized.runtime === 'windows-service' && this.platform !== 'win32') throw new Error('Windows service runtime is unavailable on this platform.')
      return { selection: normalized, executable, serviceName: normalized.serviceName ?? serviceNameFor(normalized.nodeId) }
    }
    const contexts = await discoverCloudflaredDockerContexts()
    const context = normalized.dockerContext ?? contexts.find((item) => item.current && item.available)?.name ?? ''
    const available = contexts.find((item) => item.name === context && item.available)
    if (!available) throw new Error('Choose an available Docker context and retry.')
    const network = normalized.dockerNetwork ?? 'none'
    if (network !== 'none') {
      const networks = await discoverCloudflaredDockerNetworks(context)
      if (!networks.some((item) => item.name === network)) throw new Error('The selected Docker network is no longer available. Refresh and choose it again.')
    }
    return { selection: { ...normalized, dockerContext: context, dockerNetwork: network }, containerName: containerNameFor(normalized.nodeId) }
  }

  async start(input: CloudflaredRuntimeSelection): Promise<{ operationId: string }> {
    await this.ensureLoaded()
    const checked = await this.checkSelection(input)
    const { selection } = checked
    const record = this.recordMap.get(selection.nodeId)
    if (!record) throw new Error('Configure the cloudflared runtime intent before starting it.')
    const tokenFile = await this.tokenFile(selection.credentialRef, selection.nodeId)
    const operationId = randomUUID()
    const operation: { nodeId: string; process?: ChildProcess; cancelled: boolean } = { nodeId: selection.nodeId, cancelled: false }
    this.operations.set(operationId, operation)
    const binding: NonNullable<CloudflaredRuntimeRecord['binding']> = {
      nodeId: selection.nodeId,
      runtime: selection.runtime,
      tunnelRef: selection.tunnelRef,
      credentialRef: selection.credentialRef,
      owner: 'current-user',
      ...(checked.executable ? { executablePath: checked.executable } : {}),
      ...(checked.serviceName ? { serviceName: checked.serviceName } : {}),
      ...(selection.dockerContext ? { dockerContext: selection.dockerContext } : {}),
      ...(selection.dockerNetwork ? { dockerNetwork: selection.dockerNetwork } : {}),
      tokenFile,
      ...(checked.containerName ? { containerName: checked.containerName } : {})
    }
    record.binding = binding
    await this.update(record, 'starting')
    this.emit({ nodeId: selection.nodeId, operationId, runtime: selection.runtime, phase: 'queued', completedSteps: 0, totalSteps: 4, message: 'Queued cloudflared runtime start.' })
    try {
      this.emit({ nodeId: selection.nodeId, operationId, runtime: selection.runtime, phase: 'starting', completedSteps: 1, totalSteps: 4, message: 'Starting the selected connector runtime.' })
      if (operation.cancelled) throw new Error('Cloudflared runtime start was cancelled.')
      if (selection.runtime === 'user-process') {
        const child = spawn(checked.executable!, cloudflaredRunArgs(selection.tunnelRef, tokenFile), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        operation.process = child
        this.processes.set(selection.nodeId, child)
        child.stdout?.on('data', () => undefined)
        child.stderr?.on('data', () => undefined)
        child.once('error', (error) => { void this.failProcess(selection.nodeId, operationId, outputOf(error)) })
        child.once('close', (code, signal) => {
          this.processes.delete(selection.nodeId)
          void fs.rm(path.join(this.tokenRoot, selection.nodeId), { recursive: true, force: true })
          if (!operation.cancelled && record.state === 'running') void this.update(record, 'failed', signal ? `cloudflared stopped by ${signal}.` : `cloudflared exited with code ${code ?? 'unknown'}.`)
        })
      } else if (selection.runtime === 'windows-service') {
        await command('sc.exe', cloudflaredWindowsServiceArgs(checked.serviceName!, checked.executable!, selection.tunnelRef, tokenFile), 30_000)
        await command('sc.exe', ['start', checked.serviceName!], 30_000)
      } else {
        await command('docker', cloudflaredDockerArgs(selection.dockerContext ?? '', selection.dockerNetwork ?? 'none', checked.containerName!, tokenFile, selection.tunnelRef), 60_000)
      }
      this.emit({ nodeId: selection.nodeId, operationId, runtime: selection.runtime, phase: 'health-check', completedSteps: 2, totalSteps: 4, message: 'Checking connector health.' })
      const health = await this.healthFor(record)
      if (health.state === 'failed' || health.state === 'stopped') throw new Error(health.detail)
      await this.update(record, 'running', health.detail)
      this.emit({ nodeId: selection.nodeId, operationId, runtime: selection.runtime, phase: 'running', completedSteps: 3, totalSteps: 4, message: 'Cloudflared connector is running.', detail: health.detail })
      this.emit({ nodeId: selection.nodeId, operationId, runtime: selection.runtime, phase: 'completed', completedSteps: 4, totalSteps: 4, message: 'Cloudflared connector start completed.' })
      return { operationId }
    } catch (error) {
      const detail = outputOf(error)
      const reason = /access|administrator|permission|elevation/i.test(detail) ? 'service-permission-required' : undefined
      await fs.rm(path.join(this.tokenRoot, selection.nodeId), { recursive: true, force: true })
      await this.update(record, operation.cancelled ? 'stopped' : 'failed', detail, reason)
      this.emit({ nodeId: selection.nodeId, operationId, runtime: selection.runtime, phase: operation.cancelled ? 'cancelled' : 'failed', completedSteps: 0, totalSteps: 4, message: detail })
      throw error
    } finally {
      this.operations.delete(operationId)
    }
  }

  private async failProcess(nodeId: string, operationId: string, detail: string): Promise<void> {
    const record = this.recordMap.get(nodeId)
    if (!record) return
    await this.update(record, 'failed', detail)
    this.emit({ nodeId, operationId, runtime: record.intent.runtime, phase: 'failed', completedSteps: 0, totalSteps: 4, message: detail })
  }

  async stop(nodeId: string): Promise<{ operationId: string }> {
    await this.ensureLoaded()
    const id = assertCloudflaredId(nodeId, 'Cloudflared node id')
    const record = this.recordMap.get(id)
    if (!record?.binding) throw new Error('The cloudflared runtime is not configured on this node.')
    const operationId = randomUUID()
    const binding = record.binding
    await this.update(record, 'stopping')
    this.emit({ nodeId: id, operationId, runtime: binding.runtime, phase: 'stopping', completedSteps: 0, totalSteps: 2, message: 'Stopping cloudflared.' })
    try {
      if (binding.runtime === 'user-process') this.processes.get(id)?.kill()
      else if (binding.runtime === 'windows-service') await command('sc.exe', ['stop', assertCloudflaredName(binding.serviceName, 'Cloudflared service name')], 30_000)
      else await command('docker', [...(binding.dockerContext ? ['--context', assertCloudflaredName(binding.dockerContext, 'Docker context')] : []), 'rm', '--force', assertCloudflaredName(binding.containerName, 'Cloudflared container name')], 30_000)
      await fs.rm(path.join(this.tokenRoot, id), { recursive: true, force: true })
      await this.update(record, 'stopped', 'Cloudflared connector stopped.')
      this.emit({ nodeId: id, operationId, runtime: binding.runtime, phase: 'completed', completedSteps: 2, totalSteps: 2, message: 'Cloudflared connector stopped.' })
      return { operationId }
    } catch (error) {
      const detail = outputOf(error)
      await this.update(record, 'failed', detail)
      this.emit({ nodeId: id, operationId, runtime: binding.runtime, phase: 'failed', completedSteps: 0, totalSteps: 2, message: detail })
      throw error
    }
  }

  async restart(nodeId: string): Promise<{ operationId: string }> {
    await this.ensureLoaded()
    const id = assertCloudflaredId(nodeId, 'Cloudflared node id')
    const record = this.recordMap.get(id)
    if (!record?.binding) throw new Error('The cloudflared runtime is not configured on this node.')
    await this.stop(id).catch(() => undefined)
    return this.start(record.binding)
  }

  private async healthFor(record: StoredRecord): Promise<CloudflaredRuntimeHealth> {
    const binding = record.binding
    if (!binding) return { state: 'unknown', detail: 'Cloudflared runtime is not configured.', checkedAt: Date.now() }
    try {
      if (binding.runtime === 'user-process') {
        const child = this.processes.get(binding.nodeId)
        return child && child.exitCode === null ? { state: 'healthy', detail: 'Per-user cloudflared process is alive.', checkedAt: Date.now() } : { state: 'stopped', detail: 'The per-user cloudflared process is not running.', checkedAt: Date.now() }
      }
      if (binding.runtime === 'windows-service') {
        if (this.platform !== 'win32') return { state: 'unknown', detail: 'Windows service runtime is unavailable on this platform.', checkedAt: Date.now() }
        const output = await command('sc.exe', ['query', assertCloudflaredName(binding.serviceName, 'Cloudflared service name')], 10_000)
        if (/STATE\s+:\s+\d+\s+RUNNING/i.test(output)) return { state: 'healthy', detail: 'The owned Windows service reports RUNNING.', checkedAt: Date.now() }
        if (/START_PENDING|STOP_PENDING/i.test(output)) return { state: 'starting', detail: 'The owned Windows service is changing state.', checkedAt: Date.now() }
        if (/STOPPED/i.test(output)) return { state: 'stopped', detail: 'The owned Windows service reports STOPPED.', checkedAt: Date.now() }
        return { state: 'unknown', detail: 'The Windows service returned an unrecognised state.', checkedAt: Date.now() }
      }
      const output = await command('docker', [...(binding.dockerContext ? ['--context', assertCloudflaredName(binding.dockerContext, 'Docker context')] : []), 'inspect', '--format', '{{.State.Status}}', assertCloudflaredName(binding.containerName, 'Cloudflared container name')], 10_000)
      const status = output.trim().toLowerCase()
      if (status === 'running') return { state: 'healthy', detail: 'The owned Docker connector reports running.', checkedAt: Date.now() }
      if (status === 'created' || status === 'restarting') return { state: 'starting', detail: `The owned Docker connector reports ${status}.`, checkedAt: Date.now() }
      if (status === 'exited' || status === 'dead') return { state: 'stopped', detail: `The owned Docker connector reports ${status}.`, checkedAt: Date.now() }
      return { state: 'unknown', detail: 'Docker returned an unrecognised connector state.', checkedAt: Date.now() }
    } catch (error) {
      return { state: 'failed', detail: outputOf(error), checkedAt: Date.now() }
    }
  }

  async health(nodeId: string): Promise<CloudflaredRuntimeHealth> {
    await this.ensureLoaded()
    const record = this.recordMap.get(assertCloudflaredId(nodeId, 'Cloudflared node id'))
    if (!record) return { state: 'unknown', detail: 'No cloudflared runtime intent is configured.', checkedAt: Date.now() }
    return this.healthFor(record)
  }

  cancel(operationId: string): void {
    const operation = this.operations.get(operationId)
    if (!operation) return
    operation.cancelled = true
    operation.process?.kill()
  }

  dispose(): void {
    for (const child of this.processes.values()) child.kill()
    this.processes.clear()
    this.operations.clear()
    this.listeners.clear()
  }
}

export function createCloudflaredRuntimeManager(options: CloudflaredRuntimeManagerOptions): CloudflaredRuntimeManager {
  return new CloudflaredRuntimeManager(options)
}

export const CLOUD_FLARED_RUNTIME_RECORD_SCHEMA = CLOUDFLARED_RUNTIME_SCHEMA_VERSION
