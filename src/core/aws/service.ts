import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import type {
  AwsCliStatus,
  AwsModelInventory,
  AwsModelSummary
} from '../../shared/aws'
import { AWS_CLI_WINDOWS_X64_MANIFEST } from '../../shared/aws'
import type { CorePlatform } from '../platform'
import { renameAtomic, writeFileAtomic } from '../fs-atomic'
import { bundledInstallerPath } from './manifest'

const REQUEST_TIMEOUT_MS = 30_000
const INSTALL_DIR_NAME = 'aws-cli'
const MODEL_CACHE_NAME = 'models.json'
const MAX_MODEL_CACHE_BYTES = 8 * 1024 * 1024
const MAX_INSTALLER_BYTES = 128 * 1024 * 1024

type StatusListener = (status: AwsCliStatus) => void

interface AwsCliServiceOptions {
  userDataDir: string
  resourcesPath?: string
  now?: () => number
  fetchImpl?: typeof fetch
}

function emptyStatus(state: AwsCliStatus['state'], detail: string | null = null): AwsCliStatus {
  return {
    state,
    expectedVersion: AWS_CLI_WINDOWS_X64_MANIFEST.version,
    installedVersion: null,
    executablePath: null,
    installerSource: null,
    installerSha256: null,
    progress: null,
    detail,
    checkedAt: Date.now()
  }
}

function userInstallPath(): string | null {
  if (process.platform !== 'win32') return null
  const localAppData = process.env.LOCALAPPDATA
  return localAppData ? path.join(localAppData, 'Programs', 'Amazon', 'AWSCLIV2', 'aws.exe') : null
}

function cacheExecutablePath(userDataDir: string): string {
  return path.join(userDataDir, INSTALL_DIR_NAME, AWS_CLI_WINDOWS_X64_MANIFEST.version, 'aws.exe')
}

function cacheDir(userDataDir: string): string {
  return path.join(userDataDir, INSTALL_DIR_NAME, AWS_CLI_WINDOWS_X64_MANIFEST.version)
}

function installerCachePath(userDataDir: string): string {
  return path.join(cacheDir(userDataDir), `AWSCLIV2-User-${AWS_CLI_WINDOWS_X64_MANIFEST.version}.msi`)
}

function parseVersion(output: string): string | null {
  const match = /aws-cli\/(\d+\.\d+\.\d+)/i.exec(output)
  return match?.[1] ?? null
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function cachedModel(value: unknown): AwsModelSummary | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || typeof item.name !== 'string') return null
  const strings = (key: string): string[] =>
    Array.isArray(item[key]) ? item[key].filter((entry): entry is string => typeof entry === 'string').slice(0, 32) : []
  return {
    id: item.id.slice(0, 256),
    name: item.name.slice(0, 256),
    provider: typeof item.provider === 'string' ? item.provider.slice(0, 256) : null,
    inputModalities: strings('inputModalities'),
    outputModalities: strings('outputModalities'),
    responseStreamingSupported: typeof item.responseStreamingSupported === 'boolean' ? item.responseStreamingSupported : null,
    customizationsSupported: strings('customizationsSupported'),
    inferenceTypesSupported: strings('inferenceTypesSupported'),
    source: 'offline-cache'
  }
}

function modelInventoryFromPayload(payload: unknown, source: AwsModelInventory['source']): AwsModelInventory {
  const rows = Array.isArray((payload as { modelSummaries?: unknown[] } | null)?.modelSummaries)
    ? (payload as { modelSummaries: unknown[] }).modelSummaries
    : []
  const models: AwsModelSummary[] = rows.flatMap((raw): AwsModelSummary[] => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    if (typeof item.modelId !== 'string' || typeof item.modelName !== 'string') return []
    const list = (key: string): string[] =>
      Array.isArray(item[key])
        ? item[key].filter((x): x is string => typeof x === 'string').slice(0, 32).map((x) => x.slice(0, 128))
        : []
    return [{
      id: item.modelId.slice(0, 256),
      name: item.modelName.slice(0, 256),
      provider: typeof item.providerName === 'string' ? item.providerName.slice(0, 256) : null,
      inputModalities: list('inputModalities'),
      outputModalities: list('outputModalities'),
      responseStreamingSupported:
        typeof item.responseStreamingSupported === 'boolean' ? item.responseStreamingSupported : null,
      customizationsSupported: list('customizationsSupported'),
      inferenceTypesSupported: list('inferenceTypesSupported'),
      source: source === 'offline-cache' ? 'offline-cache' : 'aws-cli'
    }]
  })
  return {
    models,
    source,
    fetchedAt: Date.now(),
    stale: source !== 'aws-cli',
    detail: models.length > 0 ? null : 'AWS CLI returned no parseable foundation-model summaries.'
  }
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function fileExists(filePath: string | null): Promise<boolean> {
  if (!filePath) return false
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export class AwsCliService {
  private readonly now: () => number
  private readonly fetchImpl: typeof fetch
  private readonly listeners = new Set<StatusListener>()
  private installProcess: ChildProcess | null = null
  private downloadAbort: AbortController | null = null
  private currentStatus: AwsCliStatus

  constructor(private readonly options: AwsCliServiceOptions) {
    this.now = options.now ?? Date.now
    this.fetchImpl = options.fetchImpl ?? fetch
    this.currentStatus = this.inspectStatus()
  }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener)
    listener(this.currentStatus)
    return () => this.listeners.delete(listener)
  }

  status(): AwsCliStatus {
    this.currentStatus = this.inspectStatus()
    return this.currentStatus
  }

  private publish(status: AwsCliStatus): AwsCliStatus {
    this.currentStatus = { ...status, checkedAt: this.now() }
    for (const listener of this.listeners) listener(this.currentStatus)
    return this.currentStatus
  }

  private inspectStatus(): AwsCliStatus {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      return emptyStatus('unsupported-platform', 'AWS CLI v2 support is limited to Windows x64.')
    }
    const candidates: Array<{ filePath: string; source: AwsCliStatus['installerSource'] }> = [
      { filePath: cacheExecutablePath(this.options.userDataDir), source: 'verified-fetch' },
      ...(userInstallPath() ? [{ filePath: userInstallPath()!, source: 'user-install' as const }] : [])
    ]
    for (const candidate of candidates) {
      if (!existsSync(candidate.filePath)) continue
      const version = this.readVersionSync(candidate.filePath)
      if (!version) continue
      return {
        state: version === AWS_CLI_WINDOWS_X64_MANIFEST.version ? 'ready' : 'stale',
        expectedVersion: AWS_CLI_WINDOWS_X64_MANIFEST.version,
        installedVersion: version,
        executablePath: candidate.filePath,
        installerSource: candidate.source,
        installerSha256: null,
        progress: 1,
        detail: version === AWS_CLI_WINDOWS_X64_MANIFEST.version ? null : 'A newer or older AWS CLI is present; repair installs the pinned version.',
        checkedAt: this.now()
      }
    }
    return emptyStatus('not-installed', 'The pinned AWS CLI executable was not found in app-owned or official user-local locations.')
  }

  private readVersionSync(executablePath: string): string | null {
    try {
      const result = spawnSync(executablePath, ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 5000 })
      return parseVersion(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
    } catch {
      return null
    }
  }

  private async runAws(executablePath: string, args: string[], signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
    return await new Promise((resolve, reject) => {
      const child = spawn(executablePath, [...args, '--no-cli-pager'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, AWS_PAGER: '' }
      })
      let stdout = ''
      let stderr = ''
      const timeout = setTimeout(() => child.kill(), REQUEST_TIMEOUT_MS)
      const abort = () => child.kill()
      signal?.addEventListener('abort', abort, { once: true })
      child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
      child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
      child.once('error', (error) => {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abort)
        reject(error)
      })
      child.once('close', (code) => {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abort)
        if (signal?.aborted) reject(new Error('AWS CLI operation was cancelled.'))
        else if (code === 0) resolve({ stdout, stderr })
        else reject(new Error(stderr.trim() || `AWS CLI exited with code ${code ?? 'unknown'}.`))
      })
    })
  }

  private async downloadInstaller(destination: string): Promise<string> {
    this.downloadAbort = new AbortController()
    const response = await this.fetchImpl(AWS_CLI_WINDOWS_X64_MANIFEST.url, {
      signal: this.downloadAbort.signal,
      redirect: 'error'
    })
    if (!response.ok || !response.body) throw new Error(`AWS CLI download returned HTTP ${response.status}.`)
    const total = Number(response.headers.get('content-length')) || null
    if (total !== null && total > MAX_INSTALLER_BYTES) throw new Error('AWS CLI installer exceeds the bounded download size.')
    const temporary = `${destination}.part`
    await rm(temporary, { force: true })
    const chunks: Buffer[] = []
    let received = 0
    const reader = response.body.getReader()
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      const chunk = Buffer.from(next.value)
      chunks.push(chunk)
      received += chunk.length
      if (received > MAX_INSTALLER_BYTES) throw new Error('AWS CLI installer exceeded the bounded download size.')
      this.publish({ ...this.currentStatus, state: 'installing', progress: total ? received / total : null, detail: 'Fetching the verified AWS CLI installer from the official AWS endpoint.' })
    }
    await writeFile(temporary, Buffer.concat(chunks))
    const digest = await sha256File(temporary)
    if (digest !== AWS_CLI_WINDOWS_X64_MANIFEST.sha256) {
      await rm(temporary, { force: true })
      throw new Error(`AWS CLI installer SHA-256 mismatch. Expected ${AWS_CLI_WINDOWS_X64_MANIFEST.sha256}, received ${digest}.`)
    }
    await renameAtomic(temporary, destination)
    return digest
  }

  private async chooseInstaller(): Promise<{ path: string; source: AwsCliStatus['installerSource']; digest: string }> {
    await mkdir(cacheDir(this.options.userDataDir), { recursive: true })
    const bundled = bundledInstallerPath(this.options.resourcesPath)
    if (await fileExists(bundled)) {
      const digest = await sha256File(bundled!)
      if (digest === AWS_CLI_WINDOWS_X64_MANIFEST.sha256) return { path: bundled!, source: 'bundled', digest }
    }
    const cached = installerCachePath(this.options.userDataDir)
    if (await fileExists(cached)) {
      const digest = await sha256File(cached)
      if (digest === AWS_CLI_WINDOWS_X64_MANIFEST.sha256) return { path: cached, source: 'verified-fetch', digest }
      await rm(cached, { force: true })
    }
    const digest = await this.downloadInstaller(cached)
    return { path: cached, source: 'verified-fetch', digest }
  }

  private async install(force: boolean): Promise<AwsCliStatus> {
    if (process.platform !== 'win32' || process.arch !== 'x64') return this.publish(emptyStatus('unsupported-platform', 'AWS CLI v2 support is limited to Windows x64.'))
    const before = this.status()
    if (before.state === 'ready' && !force) return before
    if (this.installProcess) return this.publish({ ...before, state: 'installing', detail: 'AWS CLI installation is already in progress.' })
    this.publish({ ...before, state: 'installing', progress: 0, detail: 'Preparing the official AWS CLI v2 installer.' })
    try {
      const installer = await this.chooseInstaller()
      this.publish({ ...this.currentStatus, state: 'installing', progress: 0.6, installerSource: installer.source, installerSha256: installer.digest, detail: 'Installing AWS CLI v2 for the current user.' })
      const child = spawn('msiexec.exe', ['/i', installer.path, '/qn', '/norestart'], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env }
      })
      this.installProcess = child
      await new Promise<void>((resolve, reject) => {
        let stderr = ''
        child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
        child.once('error', reject)
        child.once('close', (code) => code === 0 || code === 1641 || code === 3010 ? resolve() : reject(new Error(stderr.trim() || `msiexec exited with code ${code ?? 'unknown'}.`)))
      })
      this.installProcess = null
      const after = this.status()
      if (after.state !== 'ready') throw new Error('AWS CLI installer completed, but the pinned aws.exe was not found or reported the wrong version.')
      return this.publish({ ...after, installerSource: installer.source, installerSha256: installer.digest, progress: 1 })
    } catch (error) {
      this.installProcess = null
      if (this.downloadAbort?.signal.aborted) return this.publish({ ...this.currentStatus, state: 'offline', progress: null, detail: 'AWS CLI installation was cancelled.' })
      return this.publish({ ...this.currentStatus, state: 'failed', progress: null, detail: error instanceof Error ? error.message : String(error) })
    } finally {
      this.downloadAbort = null
    }
  }

  async ensure(): Promise<AwsCliStatus> {
    return this.install(false)
  }

  async repair(): Promise<AwsCliStatus> {
    await this.cancel()
    return this.install(true)
  }

  async cancel(): Promise<void> {
    this.downloadAbort?.abort()
    this.installProcess?.kill()
    this.installProcess = null
  }

  private modelCachePath(): string {
    return path.join(this.options.userDataDir, INSTALL_DIR_NAME, MODEL_CACHE_NAME)
  }

  private async readModelCache(): Promise<AwsModelInventory | null> {
    try {
      const file = this.modelCachePath()
      const details = await stat(file)
      if (details.size > MAX_MODEL_CACHE_BYTES) return null
      const payload = safeJson(await readFile(file, 'utf8')) as { fetchedAt?: number; models?: unknown[] } | null
      if (!payload || !Array.isArray(payload.models)) return null
      return {
        models: payload.models.flatMap((model) => {
          const normalized = cachedModel(model)
          return normalized ? [normalized] : []
        }),
        source: 'offline-cache',
        fetchedAt: typeof payload.fetchedAt === 'number' ? payload.fetchedAt : null,
        stale: true,
        detail: 'AWS CLI was unavailable. Showing the last locally verified model inventory.'
      }
    } catch {
      return null
    }
  }

  async models(): Promise<AwsModelInventory> {
    return this.refreshModels()
  }

  async refreshModels(): Promise<AwsModelInventory> {
    const status = this.status()
    if (!status.executablePath || status.state !== 'ready') return (await this.readModelCache()) ?? { models: [], source: 'unavailable', fetchedAt: null, stale: false, detail: status.detail ?? 'Install AWS CLI v2 before discovering AWS foundation models.' }
    try {
      const result = await this.runAws(status.executablePath, ['bedrock', 'list-foundation-models', '--output', 'json'])
      const inventory = modelInventoryFromPayload(safeJson(result.stdout), 'aws-cli')
      await mkdir(path.dirname(this.modelCachePath()), { recursive: true })
      await writeFileAtomic(this.modelCachePath(), JSON.stringify({ fetchedAt: this.now(), models: inventory.models }, null, 2))
      return { ...inventory, fetchedAt: this.now() }
    } catch (error) {
      const cached = await this.readModelCache()
      if (cached) return { ...cached, detail: `AWS model discovery failed: ${error instanceof Error ? error.message : String(error)}` }
      return { models: [], source: 'unavailable', fetchedAt: null, stale: false, detail: error instanceof Error ? error.message : String(error) }
    }
  }
}

export function createAwsCliService(platform: CorePlatform): AwsCliService {
  return new AwsCliService({ userDataDir: platform.userDataDir, resourcesPath: platform.resourcesPath })
}
