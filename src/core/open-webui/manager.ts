import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  OPEN_WEBUI_CONTAINER_PORT,
  OPEN_WEBUI_IMAGE,
  OPEN_WEBUI_VOLUME_PREFIX,
  type OpenWebUiBackupSummary,
  type OpenWebUiConfig,
  type OpenWebUiConfigureInput,
  type OpenWebUiPhase,
  type OpenWebUiProvider,
  type OpenWebUiStatus
} from '../../shared/open-webui'

const execFileAsync = promisify(execFile)
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,96}$/
const SAFE_CONTEXT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_CREDENTIAL_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/
const SAFE_PROVIDER_SCHEMES = new Set(['http:', 'https:'])
const FIXED_BACKUP_IMAGE = 'alpine:3.20'

type Exec = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>

export interface OpenWebUiManagerOptions {
  userDataDir: string
  exec?: Exec
  fetchImpl?: typeof fetch
  now?: () => number
  onStatus?: (status: OpenWebUiStatus) => void
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

function validEndpoint(value: string): boolean {
  try {
    const parsed = new URL(value)
    return SAFE_PROVIDER_SCHEMES.has(parsed.protocol) && (parsed.protocol === 'https:' || isLoopback(parsed.hostname)) && !parsed.username && !parsed.password
  } catch {
    return false
  }
}

function validateProvider(provider: OpenWebUiProvider): OpenWebUiProvider {
  if (!provider || !['ollama', 'openai-compatible'].includes(provider.kind)) throw new Error('Choose a supported provider.')
  if (provider.kind === 'openai-compatible' && !provider.endpoint) throw new Error('Enter the OpenAI-compatible HTTPS address.')
  if (provider.endpoint !== undefined && (!validEndpoint(provider.endpoint) || provider.endpoint.length > 2048)) {
    throw new Error('The provider address must use HTTPS, or HTTP on localhost only, without credentials.')
  }
  if (provider.credentialKey !== undefined && !SAFE_CREDENTIAL_KEY.test(provider.credentialKey)) throw new Error('The provider credential reference is invalid.')
  if (provider.model !== undefined && !SAFE_MODEL.test(provider.model)) throw new Error('The provider model name is invalid.')
  return {
    kind: provider.kind,
    ...(provider.endpoint ? { endpoint: provider.endpoint } : {}),
    ...(provider.credentialKey ? { credentialKey: provider.credentialKey } : {}),
    ...(provider.model ? { model: provider.model } : {})
  }
}

function validateInput(input: OpenWebUiConfigureInput): OpenWebUiConfigureInput {
  if (!SAFE_ID.test(input.id)) throw new Error('The Open WebUI node id is invalid.')
  if (input.context && !SAFE_CONTEXT.test(input.context)) throw new Error('Choose a discovered Docker context.')
  if (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) throw new Error('Choose a host port from 1024 through 65535.')
  return { id: input.id, context: input.context, port: input.port, reuseExistingOllama: input.reuseExistingOllama === true, provider: validateProvider(input.provider) }
}

function dockerArgs(context: string, args: string[]): string[] {
  return [...(context ? ['--context', context] : []), ...args]
}

function parseJson<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T } catch { return fallback }
}

export class OpenWebUiManager {
  private readonly userDataDir: string
  private readonly exec: Exec
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly onStatus?: (status: OpenWebUiStatus) => void
  private readonly runtime = new Map<string, { phase: OpenWebUiPhase; message: string | null; error: string | null; progress: number | null }>()

  constructor(options: OpenWebUiManagerOptions) {
    this.userDataDir = options.userDataDir
    this.exec = options.exec ?? (async (file, args) => {
      const result = await execFileAsync(file, args, { windowsHide: true, timeout: 60_000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' })
      return { stdout: String(result.stdout), stderr: String(result.stderr) }
    })
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
    this.onStatus = options.onStatus
  }

  private configPath(id: string): string { return path.join(this.userDataDir, 'open-webui', `${id}.json`) }
  private backupDir(id: string): string { return path.join(this.userDataDir, 'open-webui', 'backups', id) }
  private containerName(id: string): string { return `nodeterm-open-webui-${id}` }
  private volumeName(id: string): string { return `${OPEN_WEBUI_VOLUME_PREFIX}${id}` }

  private async load(id: string): Promise<OpenWebUiConfig | null> {
    if (!SAFE_ID.test(id)) return null
    try {
      const parsed = JSON.parse(await readFile(this.configPath(id), 'utf8')) as Partial<OpenWebUiConfig>
      const input = validateInput(parsed as OpenWebUiConfigureInput)
      if (parsed.schemaVersion !== 1 || parsed.image !== OPEN_WEBUI_IMAGE || parsed.dataVolume !== this.volumeName(id)) return null
      return { ...input, schemaVersion: 1, dataVolume: this.volumeName(id), image: OPEN_WEBUI_IMAGE, createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : this.now(), ...(typeof parsed.previousImage === 'string' ? { previousImage: parsed.previousImage } : {}) }
    } catch { return null }
  }

  private async save(config: OpenWebUiConfig): Promise<void> {
    await mkdir(path.dirname(this.configPath(config.id)), { recursive: true })
    await writeFile(this.configPath(config.id), `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  }

  private runtimeState(id: string): { phase: OpenWebUiPhase; message: string | null; error: string | null; progress: number | null } {
    return this.runtime.get(id) ?? { phase: 'stopped', message: null, error: null, progress: null }
  }

  private async dockerInspect(config: OpenWebUiConfig): Promise<'running' | 'exited' | 'missing' | 'unknown'> {
    try {
      const result = await this.exec('docker', dockerArgs(config.context, ['inspect', '--format', '{{.State.Status}}', this.containerName(config.id)]))
      const state = result.stdout.trim()
      return state === 'running' ? 'running' : state ? 'exited' : 'unknown'
    } catch (error) {
      const code = (error as { code?: string | number }).code
      return code === 1 || code === '1' ? 'missing' : 'unknown'
    }
  }

  private async ollamaReachable(config: OpenWebUiConfig): Promise<boolean> {
    if (!config.reuseExistingOllama) return true
    try {
      const response = await this.fetchImpl('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(2_500) })
      return response.ok
    } catch { return false }
  }

  private async buildStatus(config: OpenWebUiConfig | null, id: string): Promise<OpenWebUiStatus> {
    const runtime = this.runtimeState(id)
    const backups = config ? await this.listBackups(id) : []
    if (!config) return { id, phase: 'unconfigured', context: null, port: null, localUrl: null, image: null, dataVolume: null, containerName: null, containerState: 'missing', health: 'unknown', bootstrap: 'not-created', reusedOllama: false, provider: null, backups, progress: null, message: 'Choose a Docker context and port before creating Open WebUI.', error: null }
    const containerState = await this.dockerInspect(config)
    let health: OpenWebUiStatus['health'] = containerState === 'running' ? 'starting' : containerState === 'missing' ? 'unknown' : 'unreachable'
    if (containerState === 'running') {
      try {
        const response = await this.fetchImpl(`http://127.0.0.1:${config.port}/health`, { signal: AbortSignal.timeout(2_500) })
        health = response.ok ? 'ready' : 'unhealthy'
      } catch { health = 'unreachable' }
    }
    const operationInFlight = ['starting', 'backing-up', 'restoring', 'updating', 'rolling-back'].includes(runtime.phase)
    const phase: OpenWebUiPhase = operationInFlight ? runtime.phase : containerState === 'missing' ? 'stopped' : health === 'ready' ? 'awaiting-first-user' : 'stopped'
    return { id, phase, context: config.context, port: config.port, localUrl: `http://127.0.0.1:${config.port}`, image: config.image, dataVolume: config.dataVolume, containerName: this.containerName(id), containerState, health, bootstrap: health === 'ready' ? 'first-user-required' : 'unknown', reusedOllama: config.reuseExistingOllama, provider: config.provider.kind, backups, progress: runtime.progress, message: runtime.message, error: runtime.error }
  }

  private async emit(config: OpenWebUiConfig | null, id: string): Promise<OpenWebUiStatus> {
    const status = await this.buildStatus(config, id)
    this.onStatus?.(status)
    return status
  }

  async configure(input: OpenWebUiConfigureInput): Promise<OpenWebUiStatus> {
    const safe = validateInput(input)
    const prior = await this.load(safe.id)
    const config: OpenWebUiConfig = { ...safe, schemaVersion: 1, dataVolume: this.volumeName(safe.id), image: OPEN_WEBUI_IMAGE, createdAt: prior?.createdAt ?? this.now(), ...(prior?.previousImage ? { previousImage: prior.previousImage } : {}) }
    await this.save(config)
    return this.emit(config, safe.id)
  }

  async status(id: string): Promise<OpenWebUiStatus> { return this.emit(await this.load(id), id) }

  private async runContainer(config: OpenWebUiConfig): Promise<void> {
    const env = ['WEBUI_AUTH=true', ...(config.reuseExistingOllama ? ['OLLAMA_BASE_URL=http://host.docker.internal:11434'] : []), ...(config.provider.kind === 'openai-compatible' && config.provider.endpoint ? [`OPENAI_API_BASE_URL=${config.provider.endpoint}`] : [])]
    const args = dockerArgs(config.context, ['run', '--detach', '--name', this.containerName(config.id), '--restart', 'unless-stopped', '--publish', `127.0.0.1:${config.port}:${OPEN_WEBUI_CONTAINER_PORT}`, '--volume', `${config.dataVolume}:/app/backend/data`, '--label', 'dev.nodeterm.owner=open-webui', '--label', 'dev.nodeterm.managed=true', '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL', '--pids-limit', '512', '--memory', '2g', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--add-host', 'host.docker.internal:host-gateway', ...env.flatMap((value) => ['--env', value]), config.image])
    await this.exec('docker', args)
  }

  async start(id: string): Promise<OpenWebUiStatus> {
    const config = await this.load(id)
    if (!config) return this.status(id)
    if (!(await this.ollamaReachable(config))) { this.runtime.set(id, { phase: 'ollama-unavailable', message: 'Existing Ollama was selected, but its local API is not reachable.', error: null, progress: null }); return this.emit(config, id) }
    this.runtime.set(id, { phase: 'starting', message: 'Starting the fixed official Open WebUI image with persistent data.', error: null, progress: 0 })
    try {
      const state = await this.dockerInspect(config)
      if (state === 'running') await this.exec('docker', dockerArgs(config.context, ['restart', this.containerName(id)]))
      else if (state === 'exited') await this.exec('docker', dockerArgs(config.context, ['start', this.containerName(id)]))
      else { await this.exec('docker', dockerArgs(config.context, ['volume', 'create', config.dataVolume])); await this.runContainer(config) }
      this.runtime.set(id, { phase: 'awaiting-first-user', message: 'Open WebUI is reachable when health responds. The first person to register becomes the owner; no account is created by nodeterm.', error: null, progress: 100 })
    } catch (error) { this.runtime.set(id, { phase: 'error', message: null, error: error instanceof Error ? error.message : String(error), progress: null }) }
    return this.emit(config, id)
  }

  async stop(id: string): Promise<OpenWebUiStatus> {
    const config = await this.load(id)
    if (config) { await this.exec('docker', dockerArgs(config.context, ['stop', this.containerName(id)])).catch(() => {}); this.runtime.set(id, { phase: 'stopped', message: 'Container stopped. The persistent data volume remains.', error: null, progress: null }) }
    return this.emit(config, id)
  }

  async listBackups(id: string): Promise<OpenWebUiBackupSummary[]> {
    if (!SAFE_ID.test(id)) return []
    const dir = this.backupDir(id)
    try {
      const records = await Promise.all((await readdir(dir)).filter((name) => name.endsWith('.json')).map(async (name) => {
        const raw = parseJson<Partial<OpenWebUiBackupSummary>>(await readFile(path.join(dir, name), 'utf8'), {})
        return typeof raw.id === 'string' && typeof raw.createdAt === 'number' && typeof raw.sizeBytes === 'number' && typeof raw.image === 'string' ? { id: raw.id, createdAt: raw.createdAt, sizeBytes: raw.sizeBytes, image: raw.image, automatic: raw.automatic === true } : null
      }))
      return records.filter((record): record is OpenWebUiBackupSummary => record !== null).sort((a, b) => b.createdAt - a.createdAt)
    } catch { return [] }
  }

  private async snapshot(id: string, automatic: boolean): Promise<OpenWebUiBackupSummary> {
    const config = await this.load(id)
    if (!config) throw new Error('Configure Open WebUI before creating a backup.')
    const dir = this.backupDir(id); await mkdir(dir, { recursive: true })
    const backupId = `${this.now()}-${randomUUID().slice(0, 8)}`; const archive = `${backupId}.tar.gz`; const archivePath = path.join(dir, archive)
    this.runtime.set(id, { phase: 'backing-up', message: 'Creating a consistent copy of the persistent Open WebUI data.', error: null, progress: 10 })
    await this.exec('docker', dockerArgs(config.context, ['run', '--rm', '--mount', `source=${config.dataVolume},target=/data,readonly`, '--mount', `type=bind,source=${dir},target=/backup`, FIXED_BACKUP_IMAGE, 'tar', '-czf', `/backup/${archive}`, '-C', '/data', '.']))
    const sizeBytes = (await stat(archivePath)).size
    const summary: OpenWebUiBackupSummary = { id: backupId, createdAt: this.now(), sizeBytes, image: config.image, automatic }
    await writeFile(path.join(dir, `${backupId}.json`), `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    return summary
  }

  async createBackup(id: string): Promise<OpenWebUiStatus> { const config = await this.load(id); if (config) { try { await this.snapshot(id, false); this.runtime.set(id, { phase: 'stopped', message: 'Backup created. Persistent data was left in place.', error: null, progress: 100 }) } catch (error) { this.runtime.set(id, { phase: 'error', message: null, error: error instanceof Error ? error.message : String(error), progress: null }) } } return this.emit(config, id) }

  async restoreBackup(id: string, backupId: string): Promise<OpenWebUiStatus> {
    const config = await this.load(id); if (!config || !SAFE_ID.test(id) || !/^[0-9-]+-[a-f0-9]{8}$/.test(backupId)) return this.status(id)
    const backupPath = path.join(this.backupDir(id), `${backupId}.tar.gz`)
    try {
      await stat(backupPath); await this.snapshot(id, true); this.runtime.set(id, { phase: 'restoring', message: 'Restoring the selected backup after preserving the current data.', error: null, progress: 20 })
      await this.exec('docker', dockerArgs(config.context, ['stop', this.containerName(id)])).catch(() => {})
      await this.exec('docker', dockerArgs(config.context, ['run', '--rm', '--mount', `source=${config.dataVolume},target=/data`, '--mount', `type=bind,source=${this.backupDir(id)},target=/backup,readonly`, FIXED_BACKUP_IMAGE, 'tar', '-xzf', `/backup/${backupId}.tar.gz`, '-C', '/data', '--no-same-owner']))
      this.runtime.set(id, { phase: 'stopped', message: 'Backup restored. Start Open WebUI to apply it.', error: null, progress: 100 })
    } catch (error) { this.runtime.set(id, { phase: 'error', message: null, error: error instanceof Error ? error.message : String(error), progress: null }) }
    return this.emit(config, id)
  }

  async update(id: string): Promise<OpenWebUiStatus> {
    const config = await this.load(id); if (!config) return this.status(id)
    try { await this.snapshot(id, true); this.runtime.set(id, { phase: 'updating', message: `Pulling the pinned official image ${OPEN_WEBUI_IMAGE}.`, error: null, progress: 20 }); await this.exec('docker', dockerArgs(config.context, ['pull', config.image])); await this.exec('docker', dockerArgs(config.context, ['rm', '--force', this.containerName(id)])).catch(() => {}); await this.runContainer(config); this.runtime.set(id, { phase: 'awaiting-first-user', message: 'Update started with the same persistent data volume. Health is being checked.', error: null, progress: 100 }) } catch (error) { this.runtime.set(id, { phase: 'error', message: 'Update did not complete. The automatic pre-update backup remains available for restore.', error: error instanceof Error ? error.message : String(error), progress: null }) }
    return this.emit(config, id)
  }

  async rollback(id: string): Promise<OpenWebUiStatus> {
    const config = await this.load(id); if (!config) return this.status(id)
    const backups = await this.listBackups(id); const latest = backups.find((backup) => backup.automatic)
    if (!latest) { this.runtime.set(id, { phase: 'error', message: null, error: 'Rollback needs an automatic pre-update backup.', progress: null }); return this.emit(config, id) }
    const result = await this.restoreBackup(id, latest.id)
    return result
  }

  async tunnelHandoff(id: string): Promise<{ ok: boolean; localUrl: string | null; reason: string }> {
    const status = await this.status(id)
    if (status.health !== 'ready' || !status.localUrl) return { ok: false, localUrl: status.localUrl, reason: 'Keep Open WebUI private until the local health check is ready. Tunnel creation is a separate, explicit handoff.' }
    return { ok: true, localUrl: status.localUrl, reason: 'Local health is ready. No tunnel was created; hand this URL to the guided tunnel flow.' }
  }
}
